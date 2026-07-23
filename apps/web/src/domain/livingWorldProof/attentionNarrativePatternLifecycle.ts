/** Stage B / B2 pure coordinate-based NarrativePatternInstance lifecycle. */
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
  ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
  ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
  ATTENTION_NARRATIVE_PATTERN_STALL_LSN_DELTA,
  ATTENTION_PUBLIC_CONFLICT_ESCALATION_EXPIRY_LSN_DELTA,
  ATTENTION_RECIPROCAL_PUBLIC_AID_EXPIRY_LSN_DELTA,
  deriveAttentionNarrativePatternAnnotation,
} from './attentionCandidatePolicy'
import {
  NARRATIVE_PATTERN_TOTAL_STEPS,
  createNarrativePatternInstanceContract,
} from './attentionNarrativePatternContracts'
import type {
  NarrativePatternAnnotation,
  NarrativePatternBinding,
  NarrativePatternDirectEvidenceAssertionInput,
  NarrativePatternEvidenceSequenceEntry,
  NarrativePatternInstance,
  NarrativePatternSupportingRecordIdentity,
  NarrativePatternSupportingRole,
  NarrativePatternType,
} from './attentionNarrativePatternContracts'
import {
  canonicalizeNarrativePatternBindings,
  canonicalizeNarrativePatternSupportingRecords,
  computeNarrativePatternInstanceId,
} from './attentionNarrativePatternIdentity'
import {
  ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
} from './attentionPatternEvidenceContracts'
import type {
  AttentionReadablePatternEvidenceView,
} from './attentionPatternEvidenceContracts'
import {
  isAttentionReadablePatternEvidenceViewFromAccessor,
} from './attentionPatternEvidenceAccessor'

export const NARRATIVE_PATTERN_STALL_LSN_DELTA =
  ATTENTION_NARRATIVE_PATTERN_STALL_LSN_DELTA
export const RECIPROCAL_PUBLIC_AID_EXPIRY_LSN_DELTA =
  ATTENTION_RECIPROCAL_PUBLIC_AID_EXPIRY_LSN_DELTA
export const PUBLIC_CONFLICT_ESCALATION_EXPIRY_LSN_DELTA =
  ATTENTION_PUBLIC_CONFLICT_ESCALATION_EXPIRY_LSN_DELTA

export type NarrativePatternLifecycleRefusal =
  | 'input-not-accessor-minted'
  | 'invalid-lifecycle-coordinate'
  | 'invalid-lifecycle-transition'
  | 'evidence-after-expiry-deadline'
  | 'retired-pattern-instance'
  | 'invalid-instance-contract'

export type NarrativePatternLifecycleResult =
  | { readonly kind: 'ok'; readonly instance: NarrativePatternInstance }
  | { readonly kind: 'refused'; readonly reason: NarrativePatternLifecycleRefusal }

export interface NarrativePatternRetirementMarker {
  readonly patternInstanceId: string
  readonly retiredAtLsn: number
  readonly identitySchemaVersion: string
}

export interface NarrativePatternCreationInput {
  readonly patternType: NarrativePatternType
  readonly patternContentHash: string
  readonly evaluationSnapshotLsn: number
  readonly bindingMap: readonly NarrativePatternBinding[]
  readonly startEvidence: AttentionReadablePatternEvidenceView
  readonly startSemanticRole: NarrativePatternSupportingRole
  readonly directAssertionInput: NarrativePatternDirectEvidenceAssertionInput
}

export interface NarrativePatternEvidenceTransitionInput {
  readonly instance: NarrativePatternInstance
  readonly supportingEvidenceViews: readonly AttentionReadablePatternEvidenceView[]
  readonly evidence: AttentionReadablePatternEvidenceView
  readonly semanticRole: NarrativePatternSupportingRole
  readonly evaluationSnapshotLsn: number
  readonly directAssertionInput?: NarrativePatternDirectEvidenceAssertionInput
  readonly retirementMarker?: NarrativePatternRetirementMarker
}

function isCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function supportingIdentity(
  evidence: AttentionReadablePatternEvidenceView,
  semanticRole: NarrativePatternSupportingRole,
): NarrativePatternSupportingRecordIdentity {
  return Object.freeze({
    semanticRole,
    recordKind: evidence.recordKind,
    recordId: evidence.recordId,
    visibilityProvenanceId: evidence.visibilityProvenanceId,
    commitLsn: evidence.commitLsn,
  })
}

function sequenceEntry(
  evidence: AttentionReadablePatternEvidenceView,
  stepIndex: number,
): NarrativePatternEvidenceSequenceEntry {
  return Object.freeze({
    stepIndex,
    recordId: evidence.recordId,
    commitLsn: evidence.commitLsn,
    worldTimeTick: evidence.worldTimeTick,
  })
}

function refusal(reason: NarrativePatternLifecycleRefusal): NarrativePatternLifecycleResult {
  return Object.freeze({ kind: 'refused', reason })
}

type NarrativePatternContractFields = {
  readonly patternType: NarrativePatternType
  readonly patternSemanticVersion: number
  readonly patternContentHash: string
  readonly monitorRuleVersion: string
  readonly canonicalizationVersion: string
  readonly identitySchemaVersion: string
  readonly bindingMap: readonly NarrativePatternBinding[]
  readonly supportingRecordIdentityTuple: readonly NarrativePatternSupportingRecordIdentity[]
  readonly [key: string]: unknown
}

function finish(
  value: NarrativePatternContractFields,
  supportingEvidenceViews: readonly AttentionReadablePatternEvidenceView[],
): NarrativePatternLifecycleResult {
  let bindingMap: readonly NarrativePatternBinding[]
  let support: readonly NarrativePatternSupportingRecordIdentity[]
  try {
    bindingMap = canonicalizeNarrativePatternBindings(value.patternType, value.bindingMap)
    support = canonicalizeNarrativePatternSupportingRecords(
      value.patternType,
      value.supportingRecordIdentityTuple,
    )
  } catch {
    return refusal('invalid-instance-contract')
  }
  const patternInstanceId = computeNarrativePatternInstanceId({
    patternType: value.patternType,
    patternSemanticVersion: value.patternSemanticVersion,
    patternContentHash: value.patternContentHash,
    monitorRuleVersion: value.monitorRuleVersion,
    canonicalizationVersion: value.canonicalizationVersion,
    identitySchemaVersion: value.identitySchemaVersion,
    bindingMap,
    supportingRecordIdentityTuple: support,
  })
  const result = createNarrativePatternInstanceContract({
    ...value,
    patternInstanceId,
    bindingMap,
    supportingRecordIdentityTuple: support,
  }, supportingEvidenceViews)
  return result.kind === 'ok'
    ? Object.freeze({ kind: 'ok', instance: result.instance })
    : refusal('invalid-instance-contract')
}

export function createNarrativePatternInstance(
  input: NarrativePatternCreationInput,
): NarrativePatternLifecycleResult {
  if (!isAttentionReadablePatternEvidenceViewFromAccessor(input.startEvidence)) {
    return refusal('input-not-accessor-minted')
  }
  if (
    !isCoordinate(input.evaluationSnapshotLsn)
    || input.startEvidence.commitLsn > input.evaluationSnapshotLsn
    || input.directAssertionInput.sourceRecordId !== input.startEvidence.recordId
    || input.directAssertionInput.visibilityProvenanceId !== input.startEvidence.visibilityProvenanceId
  ) return refusal('invalid-lifecycle-coordinate')
  const support = Object.freeze([supportingIdentity(input.startEvidence, input.startSemanticRole)])
  return finish({
    sourceKind: 'narrative_pattern_instance',
    sourceAuthority: 'derived',
    patternType: input.patternType,
    patternSemanticVersion: ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
    patternContentHash: input.patternContentHash,
    monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
    evaluationSnapshotLsn: input.evaluationSnapshotLsn,
    bindingMap: input.bindingMap,
    evidenceSequence: Object.freeze([sequenceEntry(input.startEvidence, 1)]),
    supportingRecordIdentityTuple: support,
    creationProvenance: Object.freeze({
      startRecordId: input.startEvidence.recordId,
      startCommitLsn: input.startEvidence.commitLsn,
      patternSemanticVersion: ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
      monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
    }),
    firstRelevantWorldTime: input.startEvidence.worldTimeTick,
    lastProgressWorldTime: input.startEvidence.worldTimeTick,
    lastProgressLsn: input.startEvidence.commitLsn,
    progressStep: 1,
    totalSteps: NARRATIVE_PATTERN_TOTAL_STEPS[input.patternType],
    monitorVerdict: 'inconclusive',
    narrativeAnnotation: 'active',
    directEvidenceAssertionInputs: Object.freeze([Object.freeze({ ...input.directAssertionInput })]),
  }, Object.freeze([input.startEvidence]))
}

function validateCurrentInstance(
  input: NarrativePatternEvidenceTransitionInput,
): NarrativePatternLifecycleRefusal | null {
  if (
    !Array.isArray(input.supportingEvidenceViews)
    || input.supportingEvidenceViews.some((view) => (
      !isAttentionReadablePatternEvidenceViewFromAccessor(view)
    ))
    || createNarrativePatternInstanceContract(input.instance, input.supportingEvidenceViews).kind !== 'ok'
  ) return 'invalid-instance-contract'
  return null
}

function validTransitionInput(
  input: NarrativePatternEvidenceTransitionInput,
): NarrativePatternLifecycleRefusal | null {
  const invalidCurrent = validateCurrentInstance(input)
  if (invalidCurrent !== null) return invalidCurrent
  if (!isAttentionReadablePatternEvidenceViewFromAccessor(input.evidence)) {
    return 'input-not-accessor-minted'
  }
  if (input.retirementMarker?.patternInstanceId === input.instance.patternInstanceId) {
    return 'retired-pattern-instance'
  }
  if (input.instance.monitorVerdict !== 'inconclusive') return 'invalid-lifecycle-transition'
  if (
    input.instance.narrativeAnnotation === 'expired'
    || input.instance.narrativeAnnotation === 'abandoned'
  ) return 'invalid-lifecycle-transition'
  if (
    !isCoordinate(input.evaluationSnapshotLsn)
    || input.evaluationSnapshotLsn < input.instance.evaluationSnapshotLsn
    || input.evidence.commitLsn > input.evaluationSnapshotLsn
    || input.evidence.commitLsn <= input.instance.lastProgressLsn
    || input.instance.supportingRecordIdentityTuple.some((entry) => (
      entry.recordId === input.evidence.recordId
    ))
  ) return 'invalid-lifecycle-coordinate'
  return null
}

function startEvidence(
  instance: NarrativePatternInstance,
  supportingEvidenceViews: readonly AttentionReadablePatternEvidenceView[],
): AttentionReadablePatternEvidenceView | undefined {
  return supportingEvidenceViews.find((view) => (
    view.recordId === instance.creationProvenance.startRecordId
    && view.commitLsn === instance.creationProvenance.startCommitLsn
  ))
}

function expiryDeadlineForInstance(
  instance: NarrativePatternInstance,
  supportingEvidenceViews: readonly AttentionReadablePatternEvidenceView[],
): number | null {
  const start = startEvidence(instance, supportingEvidenceViews)
  if (start === undefined) return null
  if (instance.patternType === 'public_commitment_fulfilled') {
    if (
      start.recordKind !== 'validated_public_communication'
      || start.communicationCode !== 'commitment'
    ) return null
    return start.publicDeadlineLsn
  }
  return narrativePatternExpiryDeadlineLsn(instance.patternType, start.commitLsn)
}

function transition(
  input: NarrativePatternEvidenceTransitionInput,
  outcome: 'advance' | 'satisfied' | 'violated' | 'abandoned',
): NarrativePatternLifecycleResult {
  const invalid = validTransitionInput(input)
  if (invalid !== null) return refusal(invalid)
  const advancing = outcome === 'advance' || outcome === 'satisfied'
  if (
    advancing
    && (
      input.directAssertionInput === undefined
      || input.directAssertionInput.sourceRecordId !== input.evidence.recordId
      || input.directAssertionInput.visibilityProvenanceId !== input.evidence.visibilityProvenanceId
    )
  ) return refusal('invalid-lifecycle-transition')
  if (!advancing && input.directAssertionInput !== undefined) {
    return refusal('invalid-lifecycle-transition')
  }
  const expiryDeadlineLsn = expiryDeadlineForInstance(
    input.instance,
    input.supportingEvidenceViews,
  )
  if (expiryDeadlineLsn === null) return refusal('invalid-instance-contract')
  if (outcome !== 'abandoned' && input.evidence.commitLsn > expiryDeadlineLsn) {
    return refusal('evidence-after-expiry-deadline')
  }

  const support = Object.freeze([
    ...input.instance.supportingRecordIdentityTuple,
    supportingIdentity(input.evidence, input.semanticRole),
  ])
  const sequence = Object.freeze([
    ...input.instance.evidenceSequence,
    sequenceEntry(input.evidence, input.instance.evidenceSequence.length + 1),
  ])
  const evidenceViews = Object.freeze([
    ...input.supportingEvidenceViews,
    input.evidence,
  ])
  const assertions = advancing
    ? Object.freeze([
        ...input.instance.directEvidenceAssertionInputs,
        Object.freeze({ ...input.directAssertionInput }) as NarrativePatternDirectEvidenceAssertionInput,
      ])
    : input.instance.directEvidenceAssertionInputs
  const progressStep = advancing ? input.instance.progressStep + 1 : input.instance.progressStep
  const {
    patternInstanceId,
    narrativeAnnotation,
    ...commonInstance
  } = input.instance as Extract<
    NarrativePatternInstance,
    { readonly monitorVerdict: 'inconclusive' }
  >
  void patternInstanceId
  void narrativeAnnotation
  const nextLastProgressLsn = advancing
    ? input.evidence.commitLsn
    : input.instance.lastProgressLsn
  const inconclusiveAnnotation = deriveAttentionNarrativePatternAnnotation(
    input.evaluationSnapshotLsn,
    nextLastProgressLsn,
    expiryDeadlineLsn,
    outcome === 'abandoned',
  )
  const verdictFields = outcome === 'satisfied'
    ? { monitorVerdict: 'satisfied' as const }
    : outcome === 'violated'
      ? { monitorVerdict: 'violated' as const }
      : { monitorVerdict: 'inconclusive' as const, narrativeAnnotation: inconclusiveAnnotation }
  return finish({
    ...commonInstance,
    ...verdictFields,
    evaluationSnapshotLsn: input.evaluationSnapshotLsn,
    evidenceSequence: sequence,
    supportingRecordIdentityTuple: support,
    lastProgressWorldTime: advancing
      ? input.evidence.worldTimeTick
      : input.instance.lastProgressWorldTime,
    lastProgressLsn: nextLastProgressLsn,
    progressStep,
    directEvidenceAssertionInputs: assertions,
  }, evidenceViews)
}

export function advanceNarrativePatternInstance(
  input: NarrativePatternEvidenceTransitionInput,
): NarrativePatternLifecycleResult {
  return transition(input, 'advance')
}

export function completeNarrativePatternInstance(
  input: NarrativePatternEvidenceTransitionInput,
): NarrativePatternLifecycleResult {
  if (input.instance.progressStep + 1 !== input.instance.totalSteps) {
    return refusal('invalid-lifecycle-transition')
  }
  return transition(input, 'satisfied')
}

export function invalidateNarrativePatternInstance(
  input: NarrativePatternEvidenceTransitionInput,
): NarrativePatternLifecycleResult {
  return transition(input, 'violated')
}

export function abandonNarrativePatternInstance(
  input: NarrativePatternEvidenceTransitionInput,
): NarrativePatternLifecycleResult {
  return transition(input, 'abandoned')
}

export function narrativePatternExpiryDeadlineLsn(
  patternType: NarrativePatternType,
  startLsn: number,
  publicDeadlineLsn?: number,
): number {
  if (!isCoordinate(startLsn)) {
    throw new Error('attentionNarrativePatternLifecycle: invalid start LSN')
  }
  if (patternType === 'public_commitment_fulfilled') {
    if (
      publicDeadlineLsn === undefined
      || !isCoordinate(publicDeadlineLsn)
      || publicDeadlineLsn < startLsn
    ) throw new Error('attentionNarrativePatternLifecycle: invalid public deadline')
    return publicDeadlineLsn
  }
  const delta = patternType === 'reciprocal_public_aid'
    ? RECIPROCAL_PUBLIC_AID_EXPIRY_LSN_DELTA
    : PUBLIC_CONFLICT_ESCALATION_EXPIRY_LSN_DELTA
  const deadline = startLsn + delta
  if (!Number.isSafeInteger(deadline)) {
    throw new Error('attentionNarrativePatternLifecycle: expiry coordinate overflow')
  }
  return deadline
}

export function resolveNarrativePatternAnnotation(
  evaluationSnapshotLsn: number,
  lastProgressLsn: number,
  expiryDeadlineLsn: number,
  structurallyAbandoned: boolean,
): NarrativePatternAnnotation {
  if (
    !isCoordinate(evaluationSnapshotLsn)
    || !isCoordinate(lastProgressLsn)
    || !isCoordinate(expiryDeadlineLsn)
    || lastProgressLsn > evaluationSnapshotLsn
  ) throw new Error('attentionNarrativePatternLifecycle: invalid annotation coordinate')
  return deriveAttentionNarrativePatternAnnotation(
    evaluationSnapshotLsn,
    lastProgressLsn,
    expiryDeadlineLsn,
    structurallyAbandoned,
  )
}

export function refreshNarrativePatternAnnotation(
  instance: NarrativePatternInstance,
  supportingEvidenceViews: readonly AttentionReadablePatternEvidenceView[],
  evaluationSnapshotLsn: number,
  expiryDeadlineLsn: number,
  retirementMarker?: NarrativePatternRetirementMarker,
): NarrativePatternLifecycleResult {
  if (retirementMarker?.patternInstanceId === instance.patternInstanceId) {
    return refusal('retired-pattern-instance')
  }
  if (
    createNarrativePatternInstanceContract(instance, supportingEvidenceViews).kind !== 'ok'
    || instance.monitorVerdict !== 'inconclusive'
    || instance.narrativeAnnotation === 'expired'
    || instance.narrativeAnnotation === 'abandoned'
    || evaluationSnapshotLsn < instance.evaluationSnapshotLsn
  ) return refusal('invalid-lifecycle-transition')
  const expectedDeadline = expiryDeadlineForInstance(instance, supportingEvidenceViews)
  if (expectedDeadline === null || expiryDeadlineLsn !== expectedDeadline) {
    return refusal('invalid-lifecycle-coordinate')
  }
  let narrativeAnnotation: NarrativePatternAnnotation
  try {
    narrativeAnnotation = resolveNarrativePatternAnnotation(
      evaluationSnapshotLsn,
      instance.lastProgressLsn,
      expiryDeadlineLsn,
      false,
    )
  } catch {
    return refusal('invalid-lifecycle-coordinate')
  }
  const { patternInstanceId, ...withoutIdentity } = instance
  void patternInstanceId
  return finish({
    ...withoutIdentity,
    evaluationSnapshotLsn,
    monitorVerdict: 'inconclusive',
    narrativeAnnotation,
  }, supportingEvidenceViews)
}

export function retireNarrativePatternInstance(
  instance: NarrativePatternInstance,
  retiredAtLsn: number,
): NarrativePatternRetirementMarker {
  if (!isCoordinate(retiredAtLsn) || retiredAtLsn < instance.evaluationSnapshotLsn) {
    throw new Error('attentionNarrativePatternLifecycle: invalid retirement coordinate')
  }
  return Object.freeze({
    patternInstanceId: instance.patternInstanceId,
    retiredAtLsn,
    identitySchemaVersion: ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
  })
}

/** Every already-minted exact instance ID is one-shot; new evidence mints a new ID. */
export function canReopenExactNarrativePatternInstanceId(
  instance: NarrativePatternInstance,
): false {
  void instance
  return false
}
