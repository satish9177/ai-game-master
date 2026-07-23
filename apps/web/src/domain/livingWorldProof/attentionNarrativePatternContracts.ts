/**
 * Stage B / B2 exact proof-local NarrativePatternInstance contracts.
 *
 * Instances are immutable, derived, and non-authoritative. Supporting evidence
 * is accepted only as accessor-minted A-prime views and is validated but never
 * retained on the derived instance.
 */
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
  ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
  ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
  ATTENTION_PUBLIC_CONFLICT_ESCALATION_EXPIRY_LSN_DELTA,
  ATTENTION_RECIPROCAL_PUBLIC_AID_EXPIRY_LSN_DELTA,
  deriveAttentionNarrativePatternAnnotation,
} from './attentionCandidatePolicy'
import type {
  AttentionNarrativePatternDerivedAnnotation,
} from './attentionCandidatePolicy'
import {
  ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
} from './attentionPatternEvidenceContracts'
import type {
  AttentionReadablePatternEvidenceView,
} from './attentionPatternEvidenceContracts'
import {
  isAttentionReadablePatternEvidenceViewFromAccessor,
} from './attentionPatternEvidenceAccessor'
import {
  NARRATIVE_PATTERN_BINDING_ROLES,
  NARRATIVE_PATTERN_SUPPORTING_ROLES,
  NARRATIVE_PATTERN_TYPES,
  canonicalizeNarrativePatternBindings,
  canonicalizeNarrativePatternSupportingRecords,
  computeNarrativePatternInstanceId,
} from './attentionNarrativePatternIdentity'
import type {
  NarrativePatternBinding,
  NarrativePatternBindingRole,
  NarrativePatternSupportingRecordIdentity,
  NarrativePatternSupportingRole,
  NarrativePatternType,
} from './attentionNarrativePatternIdentity'

export {
  NARRATIVE_PATTERN_BINDING_ROLES,
  NARRATIVE_PATTERN_SUPPORTING_ROLES,
  NARRATIVE_PATTERN_TYPES,
  canonicalizeNarrativePatternBindings,
  canonicalizeNarrativePatternSupportingRecords,
}
export type {
  NarrativePatternBinding,
  NarrativePatternBindingRole,
  NarrativePatternSupportingRecordIdentity,
  NarrativePatternSupportingRole,
  NarrativePatternType,
}

export type NarrativePatternMonitorVerdict = 'inconclusive' | 'satisfied' | 'violated'
export type NarrativePatternAnnotation = AttentionNarrativePatternDerivedAnnotation

export interface NarrativePatternEvidenceSequenceEntry {
  readonly stepIndex: number
  readonly recordId: string
  readonly commitLsn: number
  readonly worldTimeTick: number
}

export interface NarrativePatternCreationProvenance {
  readonly startRecordId: string
  readonly startCommitLsn: number
  readonly patternSemanticVersion: number
  readonly monitorRuleVersion: string
}

export type NarrativePatternDirectEvidenceAssertionInput =
  | {
      readonly assertionKind: 'public_aid'
      readonly sourceRecordId: string
      readonly visibilityProvenanceId: string
      readonly actorId: string
      readonly targetId: string
    }
  | {
      readonly assertionKind: 'public_harm_severity'
      readonly sourceRecordId: string
      readonly visibilityProvenanceId: string
      readonly actorId: string
      readonly targetId: string
      readonly publicSeverityBand: 'minor' | 'moderate' | 'major'
    }
  | {
      readonly assertionKind: 'public_commitment'
      readonly sourceRecordId: string
      readonly visibilityProvenanceId: string
      readonly speakerId: string
      readonly recipientId: string
      readonly commitmentKey: string
    }
  | {
      readonly assertionKind: 'public_fulfillment_record'
      readonly sourceRecordId: string
      readonly visibilityProvenanceId: string
      readonly actorId: string
      readonly targetId: string
      readonly commitmentKey: string
    }

interface NarrativePatternInstanceCommon {
  readonly sourceKind: 'narrative_pattern_instance'
  readonly sourceAuthority: 'derived'
  readonly patternInstanceId: string
  readonly patternType: NarrativePatternType
  readonly patternSemanticVersion: number
  readonly patternContentHash: string
  readonly monitorRuleVersion: string
  readonly evidenceViewContractVersion: string
  readonly canonicalizationVersion: string
  readonly identitySchemaVersion: string
  readonly evaluationSnapshotLsn: number
  readonly bindingMap: readonly NarrativePatternBinding[]
  readonly evidenceSequence: readonly NarrativePatternEvidenceSequenceEntry[]
  readonly supportingRecordIdentityTuple: readonly NarrativePatternSupportingRecordIdentity[]
  readonly creationProvenance: NarrativePatternCreationProvenance
  readonly firstRelevantWorldTime: number
  readonly lastProgressWorldTime: number
  readonly lastProgressLsn: number
  readonly progressStep: number
  readonly totalSteps: number
  readonly directEvidenceAssertionInputs: readonly NarrativePatternDirectEvidenceAssertionInput[]
}

export type NarrativePatternInstance =
  | (NarrativePatternInstanceCommon & {
      readonly monitorVerdict: 'satisfied' | 'violated'
    })
  | (NarrativePatternInstanceCommon & {
      readonly monitorVerdict: 'inconclusive'
      readonly narrativeAnnotation: NarrativePatternAnnotation
    })

export type NarrativePatternContractRefusal =
  | 'invalid-instance-shape'
  | 'unsupported-version'
  | 'invalid-coordinate'
  | 'invalid-binding-map'
  | 'invalid-evidence-sequence'
  | 'invalid-supporting-record-identity'
  | 'invalid-supporting-evidence'
  | 'invalid-progress'
  | 'invalid-verdict-annotation'
  | 'invalid-direct-assertion-input'
  | 'invalid-pattern-instance-id'

export type NarrativePatternContractResult =
  | { readonly kind: 'ok'; readonly instance: NarrativePatternInstance }
  | { readonly kind: 'refused'; readonly reason: NarrativePatternContractRefusal }

const COMMON_KEYS = Object.freeze([
  'sourceKind',
  'sourceAuthority',
  'patternInstanceId',
  'patternType',
  'patternSemanticVersion',
  'patternContentHash',
  'monitorRuleVersion',
  'evidenceViewContractVersion',
  'canonicalizationVersion',
  'identitySchemaVersion',
  'evaluationSnapshotLsn',
  'bindingMap',
  'evidenceSequence',
  'supportingRecordIdentityTuple',
  'creationProvenance',
  'firstRelevantWorldTime',
  'lastProgressWorldTime',
  'lastProgressLsn',
  'progressStep',
  'totalSteps',
  'monitorVerdict',
  'directEvidenceAssertionInputs',
])

export const NARRATIVE_PATTERN_TOTAL_STEPS: Readonly<Record<NarrativePatternType, number>> =
  Object.freeze({
    reciprocal_public_aid: 2,
    public_conflict_escalation: 3,
    public_commitment_fulfilled: 2,
  })

export const NARRATIVE_PATTERN_ADVANCEMENT_ROLES: Readonly<
  Record<NarrativePatternType, readonly NarrativePatternSupportingRole[]>
> = Object.freeze({
  reciprocal_public_aid: Object.freeze(['aid-start', 'aid-return'] as const),
  public_conflict_escalation: Object.freeze([
    'harm-start',
    'harm-reply',
    'harm-escalation',
  ] as const),
  public_commitment_fulfilled: Object.freeze(['commitment-start', 'fulfillment'] as const),
})

const VIOLATION_ROLE: Readonly<Record<NarrativePatternType, NarrativePatternSupportingRole>> =
  Object.freeze({
    reciprocal_public_aid: 'aid-invalidation',
    public_conflict_escalation: 'reconciliation-terminal',
    public_commitment_fulfilled: 'retraction-or-refusal-terminal',
  })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const names = Object.getOwnPropertyNames(value)
  if (
    names.length !== keys.length
    || names.some((name) => !keys.includes(name))
    || keys.some((name) => !names.includes(name))
    || Object.getOwnPropertySymbols(value).length !== 0
  ) return false
  return names.every((name) => Object.getOwnPropertyDescriptor(value, name)?.enumerable === true)
    && names.every((name) => (value as Record<string, unknown>)[name] !== undefined)
}

function sameSupport(
  left: NarrativePatternSupportingRecordIdentity,
  right: NarrativePatternSupportingRecordIdentity | undefined,
): boolean {
  return right !== undefined
    && left.semanticRole === right.semanticRole
    && left.recordKind === right.recordKind
    && left.recordId === right.recordId
    && left.visibilityProvenanceId === right.visibilityProvenanceId
    && left.commitLsn === right.commitLsn
}

function bindingEntity(
  bindings: readonly NarrativePatternBinding[],
  role: NarrativePatternBindingRole,
): string {
  return bindings.find((binding) => binding.role === role)!.entityId
}

function participantsArePair(
  left: string,
  right: string,
  first: string,
  second: string,
): boolean {
  return (left === first && right === second) || (left === second && right === first)
}

function evidenceMatchesSupportingIdentity(
  view: AttentionReadablePatternEvidenceView,
  support: NarrativePatternSupportingRecordIdentity,
): boolean {
  return view.recordKind === support.recordKind
    && view.recordId === support.recordId
    && view.visibilityProvenanceId === support.visibilityProvenanceId
    && view.commitLsn === support.commitLsn
}

function validEvidenceSemantics(
  patternType: NarrativePatternType,
  semanticRole: NarrativePatternSupportingRole,
  view: AttentionReadablePatternEvidenceView,
  startView: AttentionReadablePatternEvidenceView,
  bindings: readonly NarrativePatternBinding[],
): boolean {
  if (patternType === 'public_commitment_fulfilled') {
    const committer = bindingEntity(bindings, 'committer')
    const recipient = bindingEntity(bindings, 'recipient')
    if (
      startView.recordKind !== 'validated_public_communication'
      || startView.communicationCode !== 'commitment'
    ) return false
    const startCommitmentKey = startView.commitmentKey
    switch (semanticRole) {
      case 'commitment-start':
        return view.recordKind === 'validated_public_communication'
          && view.communicationCode === 'commitment'
          && view.speakerId === committer
          && view.recipientId === recipient
          && isNonEmptyString(view.commitmentKey)
          && isCoordinate(view.publicDeadlineLsn)
          && view.publicDeadlineLsn >= view.commitLsn
      case 'fulfillment':
        return view.recordKind === 'observable_action'
          && view.actionCode === 'fulfill_commitment'
          && view.actorId === committer
          && view.targetId === recipient
          && view.commitmentKey === startCommitmentKey
      case 'retraction-or-refusal-terminal':
        return view.recordKind === 'validated_public_communication'
          && (
            view.communicationCode === 'retract_commitment'
            || view.communicationCode === 'explicit_refusal'
          )
          && view.speakerId === committer
          && view.recipientId === recipient
          && view.commitmentKey === startCommitmentKey
      case 'availability-terminal':
        return view.recordKind === 'world_observable_availability'
          && (view.entityId === committer || view.entityId === recipient)
      default:
        return false
    }
  }

  const initiator = bindingEntity(bindings, 'initiator')
  const counterparty = bindingEntity(bindings, 'counterparty')
  if (patternType === 'reciprocal_public_aid') {
    switch (semanticRole) {
      case 'aid-start':
        return view.recordKind === 'observable_action'
          && view.actionCode === 'aid'
          && view.actorId === initiator
          && view.targetId === counterparty
      case 'aid-return':
        return view.recordKind === 'observable_action'
          && view.actionCode === 'aid'
          && view.actorId === counterparty
          && view.targetId === initiator
      case 'aid-invalidation':
        return view.recordKind === 'observable_action'
          && view.actionCode === 'harm'
          && view.actorId === counterparty
          && view.targetId === initiator
      case 'availability-terminal':
        return view.recordKind === 'world_observable_availability'
          && (view.entityId === initiator || view.entityId === counterparty)
      default:
        return false
    }
  }

  switch (semanticRole) {
    case 'harm-start':
      return view.recordKind === 'observable_action'
        && view.actionCode === 'harm'
        && view.actorId === initiator
        && view.targetId === counterparty
    case 'harm-reply':
      return view.recordKind === 'observable_action'
        && view.actionCode === 'harm'
        && view.actorId === counterparty
        && view.targetId === initiator
    case 'harm-escalation':
      return view.recordKind === 'observable_action'
        && view.actionCode === 'harm'
        && view.actorId === initiator
        && view.targetId === counterparty
    case 'reconciliation-terminal':
      return (
        view.recordKind === 'observable_action'
        && view.actionCode === 'reconcile'
        && participantsArePair(view.actorId, view.targetId, initiator, counterparty)
      ) || (
        view.recordKind === 'validated_public_communication'
        && view.communicationCode === 'reconciliation'
        && participantsArePair(view.speakerId, view.recipientId, initiator, counterparty)
      )
    case 'availability-terminal':
      return view.recordKind === 'world_observable_availability'
        && (view.entityId === initiator || view.entityId === counterparty)
    default:
      return false
  }
}

function expiryDeadlineForValidatedStartEvidence(
  patternType: NarrativePatternType,
  startView: AttentionReadablePatternEvidenceView,
): number | null {
  if (patternType === 'public_commitment_fulfilled') {
    return startView.recordKind === 'validated_public_communication'
      && startView.communicationCode === 'commitment'
      ? startView.publicDeadlineLsn
      : null
  }
  const delta = patternType === 'reciprocal_public_aid'
    ? ATTENTION_RECIPROCAL_PUBLIC_AID_EXPIRY_LSN_DELTA
    : ATTENTION_PUBLIC_CONFLICT_ESCALATION_EXPIRY_LSN_DELTA
  const deadline = startView.commitLsn + delta
  return isCoordinate(deadline) ? deadline : null
}

function validDirectAssertionShape(value: unknown): value is NarrativePatternDirectEvidenceAssertionInput {
  if (!isRecord(value)) return false
  const common = ['assertionKind', 'sourceRecordId', 'visibilityProvenanceId']
  if (!isNonEmptyString(value.sourceRecordId) || !isNonEmptyString(value.visibilityProvenanceId)) {
    return false
  }
  switch (value.assertionKind) {
    case 'public_aid':
      return exactKeys(value, [...common, 'actorId', 'targetId'])
        && isNonEmptyString(value.actorId) && isNonEmptyString(value.targetId)
    case 'public_harm_severity':
      return exactKeys(value, [...common, 'actorId', 'targetId', 'publicSeverityBand'])
        && isNonEmptyString(value.actorId) && isNonEmptyString(value.targetId)
        && ['minor', 'moderate', 'major'].includes(value.publicSeverityBand as string)
    case 'public_commitment':
      return exactKeys(value, [...common, 'speakerId', 'recipientId', 'commitmentKey'])
        && isNonEmptyString(value.speakerId) && isNonEmptyString(value.recipientId)
        && isNonEmptyString(value.commitmentKey)
    case 'public_fulfillment_record':
      return exactKeys(value, [...common, 'actorId', 'targetId', 'commitmentKey'])
        && isNonEmptyString(value.actorId) && isNonEmptyString(value.targetId)
        && isNonEmptyString(value.commitmentKey)
    default:
      return false
  }
}

function assertionMatchesEvidence(
  assertion: NarrativePatternDirectEvidenceAssertionInput,
  view: AttentionReadablePatternEvidenceView,
): boolean {
  if (
    assertion.sourceRecordId !== view.recordId
    || assertion.visibilityProvenanceId !== view.visibilityProvenanceId
  ) return false
  switch (assertion.assertionKind) {
    case 'public_aid':
      return view.recordKind === 'observable_action'
        && view.actionCode === 'aid'
        && assertion.actorId === view.actorId
        && assertion.targetId === view.targetId
    case 'public_harm_severity':
      return view.recordKind === 'observable_action'
        && view.actionCode === 'harm'
        && assertion.actorId === view.actorId
        && assertion.targetId === view.targetId
        && assertion.publicSeverityBand === view.publicSeverityBand
    case 'public_commitment':
      return view.recordKind === 'validated_public_communication'
        && view.communicationCode === 'commitment'
        && assertion.speakerId === view.speakerId
        && assertion.recipientId === view.recipientId
        && assertion.commitmentKey === view.commitmentKey
    case 'public_fulfillment_record':
      return view.recordKind === 'observable_action'
        && view.actionCode === 'fulfill_commitment'
        && assertion.actorId === view.actorId
        && assertion.targetId === view.targetId
        && assertion.commitmentKey === view.commitmentKey
  }
}

function validStateSupport(
  patternType: NarrativePatternType,
  verdict: NarrativePatternMonitorVerdict,
  annotation: NarrativePatternAnnotation | undefined,
  progressStep: number,
  totalSteps: number,
  support: readonly NarrativePatternSupportingRecordIdentity[],
): boolean {
  const advancing = NARRATIVE_PATTERN_ADVANCEMENT_ROLES[patternType]
  const prefix = advancing.slice(0, progressStep)
  const roles = support.map((entry) => entry.semanticRole)
  if (verdict === 'satisfied') {
    return progressStep === totalSteps
      && roles.length === advancing.length
      && roles.every((role, index) => role === advancing[index])
  }
  if (progressStep >= totalSteps) return false
  if (verdict === 'violated') {
    return roles.length === prefix.length + 1
      && prefix.every((role, index) => roles[index] === role)
      && roles.at(-1) === VIOLATION_ROLE[patternType]
  }
  if (annotation === 'abandoned') {
    return roles.length === prefix.length + 1
      && prefix.every((role, index) => roles[index] === role)
      && roles.at(-1) === 'availability-terminal'
  }
  return roles.length === prefix.length
    && roles.every((role, index) => role === prefix[index])
}

function refusal(reason: NarrativePatternContractRefusal): NarrativePatternContractResult {
  return Object.freeze({ kind: 'refused', reason })
}

export function createNarrativePatternInstanceContract(
  input: unknown,
  supportingEvidenceViews: readonly AttentionReadablePatternEvidenceView[],
): NarrativePatternContractResult {
  if (!isRecord(input)) return refusal('invalid-instance-shape')
  const verdict = input.monitorVerdict
  const keys = verdict === 'inconclusive' ? [...COMMON_KEYS, 'narrativeAnnotation'] : COMMON_KEYS
  if (!exactKeys(input, keys)) return refusal('invalid-instance-shape')
  if (
    input.sourceKind !== 'narrative_pattern_instance'
    || input.sourceAuthority !== 'derived'
    || !isNonEmptyString(input.patternInstanceId)
    || !NARRATIVE_PATTERN_TYPES.includes(input.patternType as NarrativePatternType)
    || !isNonEmptyString(input.patternContentHash)
  ) return refusal('invalid-instance-shape')
  if (
    input.patternSemanticVersion !== ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION
    || input.monitorRuleVersion !== ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION
    || input.evidenceViewContractVersion !== ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION
    || input.canonicalizationVersion !== ATTENTION_CANDIDATE_CANONICALIZATION_VERSION
    || input.identitySchemaVersion !== ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION
  ) return refusal('unsupported-version')
  if (
    !['inconclusive', 'satisfied', 'violated'].includes(verdict as string)
    || (
      verdict === 'inconclusive'
      && !['active', 'stalled', 'expired', 'abandoned'].includes(input.narrativeAnnotation as string)
    )
  ) return refusal('invalid-verdict-annotation')
  if (
    !isCoordinate(input.evaluationSnapshotLsn)
    || !isCoordinate(input.firstRelevantWorldTime)
    || !isCoordinate(input.lastProgressWorldTime)
    || !isCoordinate(input.lastProgressLsn)
    || input.lastProgressLsn > input.evaluationSnapshotLsn
  ) return refusal('invalid-coordinate')

  const patternType = input.patternType as NarrativePatternType
  let bindingMap: readonly NarrativePatternBinding[]
  let support: readonly NarrativePatternSupportingRecordIdentity[]
  try {
    bindingMap = canonicalizeNarrativePatternBindings(
      patternType,
      input.bindingMap as readonly NarrativePatternBinding[],
    )
  } catch {
    return refusal('invalid-binding-map')
  }
  try {
    support = canonicalizeNarrativePatternSupportingRecords(
      patternType,
      input.supportingRecordIdentityTuple as readonly NarrativePatternSupportingRecordIdentity[],
    )
  } catch {
    return refusal('invalid-supporting-record-identity')
  }
  if (
    !Array.isArray(input.supportingRecordIdentityTuple)
    || support.some((entry, index) => !sameSupport(
      entry,
      (input.supportingRecordIdentityTuple as readonly NarrativePatternSupportingRecordIdentity[])[index],
    ))
    || support.some((entry) => entry.commitLsn > (input.evaluationSnapshotLsn as number))
  ) return refusal('invalid-supporting-record-identity')

  if (
    !isCoordinate(input.progressStep)
    || input.totalSteps !== NARRATIVE_PATTERN_TOTAL_STEPS[patternType]
    || (input.progressStep as number) < 1
    || (input.progressStep as number) > (input.totalSteps as number)
    || !validStateSupport(
      patternType,
      verdict as NarrativePatternMonitorVerdict,
      input.narrativeAnnotation as NarrativePatternAnnotation | undefined,
      input.progressStep as number,
      input.totalSteps as number,
      support,
    )
  ) return refusal('invalid-progress')

  if (
    !Array.isArray(supportingEvidenceViews)
    || supportingEvidenceViews.length !== support.length
    || supportingEvidenceViews.some((view) => !isAttentionReadablePatternEvidenceViewFromAccessor(view))
  ) return refusal('invalid-supporting-evidence')
  const evidenceById = new Map<string, AttentionReadablePatternEvidenceView>()
  for (const view of supportingEvidenceViews) {
    if (evidenceById.has(view.recordId)) return refusal('invalid-supporting-evidence')
    evidenceById.set(view.recordId, view)
  }
  const orderedViews: AttentionReadablePatternEvidenceView[] = []
  for (const entry of support) {
    const view = evidenceById.get(entry.recordId)
    if (view === undefined || !evidenceMatchesSupportingIdentity(view, entry)) {
      return refusal('invalid-supporting-evidence')
    }
    orderedViews.push(view)
  }
  const startView = orderedViews[0]
  if (startView === undefined) return refusal('invalid-supporting-evidence')
  if (support.some((entry, index) => (
    !validEvidenceSemantics(patternType, entry.semanticRole, orderedViews[index]!, startView, bindingMap)
  ))) return refusal('invalid-supporting-evidence')

  if (verdict === 'inconclusive') {
    const expiryDeadlineLsn = expiryDeadlineForValidatedStartEvidence(patternType, startView)
    if (expiryDeadlineLsn === null) return refusal('invalid-coordinate')
    const expectedAnnotation = deriveAttentionNarrativePatternAnnotation(
      input.evaluationSnapshotLsn as number,
      input.lastProgressLsn as number,
      expiryDeadlineLsn,
      support.some((entry) => entry.semanticRole === 'availability-terminal'),
    )
    if (input.narrativeAnnotation !== expectedAnnotation) {
      return refusal('invalid-verdict-annotation')
    }
  }

  if (!Array.isArray(input.evidenceSequence) || input.evidenceSequence.length !== support.length) {
    return refusal('invalid-evidence-sequence')
  }
  const evidenceSequence = input.evidenceSequence as readonly NarrativePatternEvidenceSequenceEntry[]
  for (let index = 0; index < evidenceSequence.length; index += 1) {
    const evidence = evidenceSequence[index]
    const view = orderedViews[index]
    if (
      !isRecord(evidence)
      || !exactKeys(evidence, ['stepIndex', 'recordId', 'commitLsn', 'worldTimeTick'])
      || evidence.stepIndex !== index + 1
      || evidence.recordId !== view?.recordId
      || evidence.commitLsn !== view.commitLsn
      || evidence.worldTimeTick !== view.worldTimeTick
    ) return refusal('invalid-evidence-sequence')
  }

  const advancementRoles = NARRATIVE_PATTERN_ADVANCEMENT_ROLES[patternType]
  const advancementViews = support
    .map((entry, index) => ({ entry, view: orderedViews[index]! }))
    .filter(({ entry }) => advancementRoles.includes(entry.semanticRole))
    .map(({ view }) => view)
  if (
    advancementViews.length !== input.progressStep
    || advancementViews.some((view, index) => (
      index > 0 && view.commitLsn <= advancementViews[index - 1]!.commitLsn
    ))
  ) return refusal('invalid-evidence-sequence')
  const finalAdvancement = advancementViews.at(-1)!
  const terminalView = orderedViews.length > advancementViews.length ? orderedViews.at(-1) : undefined
  if (terminalView !== undefined && terminalView.commitLsn <= finalAdvancement.commitLsn) {
    return refusal('invalid-evidence-sequence')
  }

  if (
    !isRecord(input.creationProvenance)
    || !exactKeys(
      input.creationProvenance,
      ['startRecordId', 'startCommitLsn', 'patternSemanticVersion', 'monitorRuleVersion'],
    )
    || input.creationProvenance.startRecordId !== startView.recordId
    || input.creationProvenance.startCommitLsn !== startView.commitLsn
    || input.creationProvenance.patternSemanticVersion !== ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION
    || input.creationProvenance.monitorRuleVersion !== ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION
    || input.firstRelevantWorldTime !== startView.worldTimeTick
    || input.lastProgressLsn !== finalAdvancement.commitLsn
    || input.lastProgressWorldTime !== finalAdvancement.worldTimeTick
  ) return refusal('invalid-coordinate')

  if (
    !Array.isArray(input.directEvidenceAssertionInputs)
    || input.directEvidenceAssertionInputs.length !== advancementViews.length
  ) return refusal('invalid-direct-assertion-input')
  const assertions = input.directEvidenceAssertionInputs as readonly NarrativePatternDirectEvidenceAssertionInput[]
  if (assertions.some((assertion, index) => (
    !validDirectAssertionShape(assertion)
    || !assertionMatchesEvidence(assertion, advancementViews[index]!)
  ))) return refusal('invalid-direct-assertion-input')

  const expectedId = computeNarrativePatternInstanceId({
    patternType,
    patternSemanticVersion: input.patternSemanticVersion as number,
    patternContentHash: input.patternContentHash as string,
    monitorRuleVersion: input.monitorRuleVersion as string,
    canonicalizationVersion: input.canonicalizationVersion as string,
    identitySchemaVersion: input.identitySchemaVersion as string,
    bindingMap,
    supportingRecordIdentityTuple: support,
  })
  if (input.patternInstanceId !== expectedId) return refusal('invalid-pattern-instance-id')

  const frozenSequence = evidenceSequence.map((entry) => Object.freeze({ ...entry }))
  const frozenAssertions = assertions.map((entry) => (
    Object.freeze({ ...entry }) as NarrativePatternDirectEvidenceAssertionInput
  ))
  const creationProvenance: NarrativePatternCreationProvenance = Object.freeze({
    startRecordId: input.creationProvenance.startRecordId as string,
    startCommitLsn: input.creationProvenance.startCommitLsn as number,
    patternSemanticVersion: input.creationProvenance.patternSemanticVersion as number,
    monitorRuleVersion: input.creationProvenance.monitorRuleVersion as string,
  })
  const instance = {
    ...input,
    bindingMap,
    evidenceSequence: Object.freeze(frozenSequence),
    supportingRecordIdentityTuple: support,
    creationProvenance,
    directEvidenceAssertionInputs: Object.freeze(frozenAssertions),
  } as NarrativePatternInstance
  return Object.freeze({ kind: 'ok', instance: Object.freeze(instance) })
}
