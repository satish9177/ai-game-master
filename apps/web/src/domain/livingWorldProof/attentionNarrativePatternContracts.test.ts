import { describe, expect, it } from 'vitest'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
  ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
  ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
} from './attentionCandidatePolicy'
import {
  canonicalizeNarrativePatternBindings,
  canonicalizeNarrativePatternSupportingRecords,
  createNarrativePatternInstanceContract,
} from './attentionNarrativePatternContracts'
import type {
  NarrativePatternBinding,
  NarrativePatternDirectEvidenceAssertionInput,
  NarrativePatternMonitorVerdict,
  NarrativePatternSupportingRecordIdentity,
  NarrativePatternSupportingRole,
} from './attentionNarrativePatternContracts'
import { computeNarrativePatternInstanceId } from './attentionNarrativePatternIdentity'
import {
  ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
  createProofPatternEvidenceRecord,
  createProofPatternEvidenceSnapshot,
} from './attentionPatternEvidenceContracts'
import type {
  AttentionReadablePatternEvidenceView,
  ProofPatternEvidenceRecordInput,
} from './attentionPatternEvidenceContracts'
import { readAttentionReadablePatternEvidenceViews } from './attentionPatternEvidenceAccessor'

function mintMany(
  inputs: readonly ProofPatternEvidenceRecordInput[],
): readonly AttentionReadablePatternEvidenceView[] {
  const snapshot = createProofPatternEvidenceSnapshot({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    records: inputs.map((input) => createProofPatternEvidenceRecord(input)),
  })
  const result = readAttentionReadablePatternEvidenceViews(snapshot, {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
  })
  if (result.kind !== 'ok') throw new Error(`fixture mint failed: ${result.reason}`)
  return result.views
}

function aidRecord(
  recordId: string,
  commitLsn: number,
  actorId: string,
  targetId: string,
): ProofPatternEvidenceRecordInput {
  return {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordKind: 'observable_action',
    actionCode: 'aid',
    recordId,
    commitLsn,
    worldTimeTick: 100 + commitLsn,
    visibilityProvenance: { visibility: 'public', provenanceId: `public-${recordId}` },
    actorId,
    targetId,
  }
}

function harmRecord(
  recordId: string,
  commitLsn: number,
  actorId: string,
  targetId: string,
): ProofPatternEvidenceRecordInput {
  return {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordKind: 'observable_action',
    actionCode: 'harm',
    recordId,
    commitLsn,
    worldTimeTick: 100 + commitLsn,
    visibilityProvenance: { visibility: 'public', provenanceId: `public-${recordId}` },
    actorId,
    targetId,
    publicSeverityBand: 'major',
  }
}

function availabilityRecord(
  recordId: string,
  commitLsn: number,
  entityId: string,
): ProofPatternEvidenceRecordInput {
  return {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordKind: 'world_observable_availability',
    availabilityCode: 'departed',
    recordId,
    commitLsn,
    worldTimeTick: 100 + commitLsn,
    visibilityProvenance: { visibility: 'public', provenanceId: `public-${recordId}` },
    entityId,
  }
}

const AID_BINDINGS: readonly NarrativePatternBinding[] = Object.freeze([
  Object.freeze({ role: 'initiator', entityId: 'npc-a' }),
  Object.freeze({ role: 'counterparty', entityId: 'npc-b' }),
])

function support(
  view: AttentionReadablePatternEvidenceView,
  semanticRole: NarrativePatternSupportingRole,
): NarrativePatternSupportingRecordIdentity {
  return {
    semanticRole,
    recordKind: view.recordKind,
    recordId: view.recordId,
    visibilityProvenanceId: view.visibilityProvenanceId,
    commitLsn: view.commitLsn,
  }
}

function aidAssertion(
  view: AttentionReadablePatternEvidenceView,
): NarrativePatternDirectEvidenceAssertionInput {
  if (view.recordKind !== 'observable_action' || view.actionCode !== 'aid') throw new Error('not aid')
  return {
    assertionKind: 'public_aid',
    sourceRecordId: view.recordId,
    visibilityProvenanceId: view.visibilityProvenanceId,
    actorId: view.actorId,
    targetId: view.targetId,
  }
}

function deriveId(value: Record<string, unknown>): string {
  return computeNarrativePatternInstanceId({
    patternType: value.patternType as 'reciprocal_public_aid',
    patternSemanticVersion: value.patternSemanticVersion as number,
    patternContentHash: value.patternContentHash as string,
    monitorRuleVersion: value.monitorRuleVersion as string,
    canonicalizationVersion: value.canonicalizationVersion as string,
    identitySchemaVersion: value.identitySchemaVersion as string,
    bindingMap: value.bindingMap as readonly NarrativePatternBinding[],
    supportingRecordIdentityTuple:
      value.supportingRecordIdentityTuple as readonly NarrativePatternSupportingRecordIdentity[],
  })
}

function aidInstance(
  state: 'active' | 'stalled' | 'expired' | 'abandoned' | 'satisfied' | 'violated',
): { readonly input: Record<string, unknown>; readonly views: readonly AttentionReadablePatternEvidenceView[] } {
  const records: ProofPatternEvidenceRecordInput[] = [aidRecord('aid-1', 7, 'npc-a', 'npc-b')]
  if (state === 'satisfied') records.push(aidRecord('aid-2', 12, 'npc-b', 'npc-a'))
  if (state === 'violated') records.push(harmRecord('harm-1', 11, 'npc-b', 'npc-a'))
  if (state === 'abandoned') records.push(availabilityRecord('departed-1', 11, 'npc-b'))
  const views = mintMany(records)
  const start = views.find((view) => view.recordId === 'aid-1')!
  const terminal = views.find((view) => view.recordId !== 'aid-1')
  const roles: NarrativePatternSupportingRole[] = ['aid-start']
  if (state === 'satisfied') roles.push('aid-return')
  if (state === 'violated') roles.push('aid-invalidation')
  if (state === 'abandoned') roles.push('availability-terminal')
  const supportTuple = [
    support(start, roles[0]!),
    ...(terminal === undefined ? [] : [support(terminal, roles[1]!)]),
  ]
  const advancementViews = state === 'satisfied' ? [start, terminal!] : [start]
  const verdict: NarrativePatternMonitorVerdict = state === 'satisfied'
    ? 'satisfied'
    : state === 'violated'
      ? 'violated'
      : 'inconclusive'
  const evaluationSnapshotLsn = state === 'stalled'
    ? 11
    : state === 'expired'
      ? 20
      : terminal?.commitLsn ?? 10
  const input: Record<string, unknown> = {
    sourceKind: 'narrative_pattern_instance',
    sourceAuthority: 'derived',
    patternInstanceId: '',
    patternType: 'reciprocal_public_aid',
    patternSemanticVersion: ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
    patternContentHash: 'pattern-content-aid-v1',
    monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
    evaluationSnapshotLsn,
    bindingMap: AID_BINDINGS.map((entry) => ({ ...entry })),
    evidenceSequence: [start, ...(terminal === undefined ? [] : [terminal])].map((view, index) => ({
      stepIndex: index + 1,
      recordId: view.recordId,
      commitLsn: view.commitLsn,
      worldTimeTick: view.worldTimeTick,
    })),
    supportingRecordIdentityTuple: supportTuple,
    creationProvenance: {
      startRecordId: start.recordId,
      startCommitLsn: start.commitLsn,
      patternSemanticVersion: ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
      monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
    },
    firstRelevantWorldTime: start.worldTimeTick,
    lastProgressWorldTime: advancementViews.at(-1)!.worldTimeTick,
    lastProgressLsn: advancementViews.at(-1)!.commitLsn,
    progressStep: advancementViews.length,
    totalSteps: 2,
    monitorVerdict: verdict,
    directEvidenceAssertionInputs: advancementViews.map(aidAssertion),
  }
  if (verdict === 'inconclusive') input.narrativeAnnotation = state
  input.patternInstanceId = deriveId(input)
  return { input, views }
}

describe('B2 NarrativePatternInstance exact contract', () => {
  it('returns a deeply immutable defensive copy of the derived non-authoritative instance', () => {
    const fixture = aidInstance('active')
    const callerBindings = fixture.input.bindingMap as NarrativePatternBinding[]
    const result = createNarrativePatternInstanceContract(fixture.input, fixture.views)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    callerBindings[0] = { role: 'initiator', entityId: 'mutated' }
    expect(result.instance.sourceKind).toBe('narrative_pattern_instance')
    expect(result.instance.sourceAuthority).toBe('derived')
    expect(result.instance.bindingMap[0]?.entityId).toBe('npc-a')
    expect([
      result.instance,
      result.instance.bindingMap,
      ...result.instance.bindingMap,
      result.instance.evidenceSequence,
      ...result.instance.evidenceSequence,
      result.instance.supportingRecordIdentityTuple,
      ...result.instance.supportingRecordIdentityTuple,
      result.instance.creationProvenance,
      result.instance.directEvidenceAssertionInputs,
      ...result.instance.directEvidenceAssertionInputs,
    ].every(Object.isFrozen)).toBe(true)
  })

  it('accepts only the six RN019-legal verdict/annotation combinations over the full Cartesian product', () => {
    const verdicts = ['satisfied', 'violated', 'inconclusive'] as const
    const annotations = [undefined, 'active', 'stalled', 'expired', 'abandoned'] as const
    for (const verdict of verdicts) {
      for (const annotation of annotations) {
        const state = verdict === 'satisfied'
          ? 'satisfied'
          : verdict === 'violated'
            ? 'violated'
            : annotation === 'abandoned'
              ? 'abandoned'
              : annotation ?? 'active'
        const fixture = aidInstance(state)
        fixture.input.monitorVerdict = verdict
        if (annotation === undefined) delete fixture.input.narrativeAnnotation
        else fixture.input.narrativeAnnotation = annotation
        const legal = (verdict === 'satisfied' || verdict === 'violated')
          ? annotation === undefined
          : annotation !== undefined
        expect({
          verdict,
          annotation: annotation ?? 'absent',
          kind: createNarrativePatternInstanceContract(fixture.input, fixture.views).kind,
        }).toEqual({
          verdict,
          annotation: annotation ?? 'absent',
          kind: legal ? 'ok' : 'refused',
        })
      }
    }
  })

  it('accepts only active for the exact start 7 / progress 7 / evaluation 10 regression case', () => {
    for (const [annotation, expectedKind] of [
      ['active', 'ok'],
      ['stalled', 'refused'],
      ['expired', 'refused'],
    ] as const) {
      const fixture = aidInstance('active')
      fixture.input.narrativeAnnotation = annotation
      expect(createNarrativePatternInstanceContract(fixture.input, fixture.views).kind)
        .toBe(expectedKind)
    }
  })

  it('pins exact pattern-specific binding roles, authored order, and distinct entities', () => {
    expect(canonicalizeNarrativePatternBindings('reciprocal_public_aid', [
      { role: 'counterparty', entityId: 'npc-b' },
      { role: 'initiator', entityId: 'npc-a' },
    ])).toEqual(AID_BINDINGS)
    for (const invalid of [
      [{ role: 'initiator', entityId: 'npc-a' }],
      [
        { role: 'initiator', entityId: 'npc-a' },
        { role: 'initiator', entityId: 'npc-b' },
      ],
      [
        { role: 'initiator', entityId: 'npc-a' },
        { role: 'committer', entityId: 'npc-b' },
      ],
      [
        { role: 'initiator', entityId: 'same' },
        { role: 'counterparty', entityId: 'same' },
      ],
      [
        { role: 'initiator', entityId: 'npc-a' },
        { role: 'counterparty', entityId: 'npc-b' },
        { role: 'recipient', entityId: 'npc-c' },
      ],
    ]) {
      expect(() => canonicalizeNarrativePatternBindings(
        'reciprocal_public_aid',
        invalid as readonly NarrativePatternBinding[],
      )).toThrow()
    }
  })

  it('orders authored support roles, then same-role commitLsn and recordId', () => {
    expect(canonicalizeNarrativePatternSupportingRecords('public_conflict_escalation', [
      {
        semanticRole: 'harm-reply',
        recordKind: 'observable_action',
        recordId: 'reply',
        visibilityProvenanceId: 'p3',
        commitLsn: 9,
      },
      {
        semanticRole: 'harm-start',
        recordKind: 'observable_action',
        recordId: 'start-z',
        visibilityProvenanceId: 'p2',
        commitLsn: 8,
      },
      {
        semanticRole: 'harm-start',
        recordKind: 'observable_action',
        recordId: 'start-a',
        visibilityProvenanceId: 'p1',
        commitLsn: 8,
      },
    ]).map((entry) => entry.recordId)).toEqual(['start-a', 'start-z', 'reply'])
  })

  it('refuses aid as aid-invalidation and requires the exact public harm semantics', () => {
    const fixture = aidInstance('violated')
    const wrongViews = mintMany([
      aidRecord('aid-1', 7, 'npc-a', 'npc-b'),
      aidRecord('harm-1', 11, 'npc-b', 'npc-a'),
    ])
    expect(createNarrativePatternInstanceContract(fixture.input, wrongViews))
      .toEqual({ kind: 'refused', reason: 'invalid-supporting-evidence' })
    expect(createNarrativePatternInstanceContract(fixture.input, fixture.views).kind).toBe('ok')
  })

  it('enforces complete state-specific advancement and terminal evidence', () => {
    const satisfied = aidInstance('satisfied')
    const violated = aidInstance('violated')
    const abandoned = aidInstance('abandoned')
    const active = aidInstance('active')
    const cases: Record<string, unknown>[] = []

    const incompleteSatisfied: Record<string, unknown> = {
      ...active.input,
      monitorVerdict: 'satisfied',
    }
    delete incompleteSatisfied.narrativeAnnotation
    cases.push(incompleteSatisfied)

    const violatedWithoutTerminal: Record<string, unknown> = {
      ...active.input,
      monitorVerdict: 'violated',
    }
    delete violatedWithoutTerminal.narrativeAnnotation
    cases.push(violatedWithoutTerminal)

    const abandonedWithoutTerminal = { ...active.input, narrativeAnnotation: 'abandoned' }
    cases.push(abandonedWithoutTerminal)

    const activeWithTerminal = { ...violated.input, monitorVerdict: 'inconclusive', narrativeAnnotation: 'active' }
    cases.push(activeWithTerminal)

    for (const input of cases) {
      input.patternInstanceId = deriveId(input)
      const views = input === activeWithTerminal ? violated.views : active.views
      expect(createNarrativePatternInstanceContract(input, views).kind).toBe('refused')
    }
    expect(createNarrativePatternInstanceContract(satisfied.input, satisfied.views).kind).toBe('ok')
    expect(createNarrativePatternInstanceContract(abandoned.input, abandoned.views).kind).toBe('ok')
  })

  it.each([
    ['progress below one', 0, 2],
    ['progress above total', 3, 2],
    ['wrong total steps', 1, 3],
  ])('refuses %s', (_label, progressStep, totalSteps) => {
    const fixture = aidInstance('active')
    fixture.input.progressStep = progressStep
    fixture.input.totalSteps = totalSteps
    expect(createNarrativePatternInstanceContract(fixture.input, fixture.views).kind).toBe('refused')
  })

  it('reconciles creation, progress, support, evidence, and snapshot coordinates', () => {
    const violated = aidInstance('violated')
    const future = structuredClone(violated.input)
    future.evaluationSnapshotLsn = 10
    expect(createNarrativePatternInstanceContract(future, violated.views))
      .toEqual({ kind: 'refused', reason: 'invalid-supporting-record-identity' })

    for (const mutate of [
      (value: Record<string, unknown>) => {
        (value.creationProvenance as Record<string, unknown>).startRecordId = 'other'
      },
      (value: Record<string, unknown>) => { value.firstRelevantWorldTime = 999 },
      (value: Record<string, unknown>) => { value.lastProgressLsn = 8 },
      (value: Record<string, unknown>) => { value.lastProgressWorldTime = 999 },
      (value: Record<string, unknown>) => {
        (value.evidenceSequence as Record<string, unknown>[])[0]!.worldTimeTick = 999
      },
    ]) {
      const fixture = aidInstance('active')
      mutate(fixture.input)
      expect(createNarrativePatternInstanceContract(fixture.input, fixture.views).kind).toBe('refused')
    }
  })

  it('derives and verifies patternInstanceId and refuses a caller-supplied mismatch', () => {
    const fixture = aidInstance('active')
    expect(createNarrativePatternInstanceContract(fixture.input, fixture.views).kind).toBe('ok')
    fixture.input.patternInstanceId = `${fixture.input.patternInstanceId}-forged`
    expect(createNarrativePatternInstanceContract(fixture.input, fixture.views))
      .toEqual({ kind: 'refused', reason: 'invalid-pattern-instance-id' })
  })

  it.each([
    ['unknown field', (value: Record<string, unknown>) => { value.rawRecord = {} }],
    ['present undefined', (value: Record<string, unknown>) => { value.patternContentHash = undefined }],
    ['unsupported pattern version', (value: Record<string, unknown>) => { value.patternSemanticVersion = 2 }],
    ['unsupported monitor version', (value: Record<string, unknown>) => { value.monitorRuleVersion = 'later' }],
    ['unsafe top-level coordinate', (value: Record<string, unknown>) => {
      value.evaluationSnapshotLsn = Number.MAX_SAFE_INTEGER + 1
    }],
    ['unsafe nested coordinate', (value: Record<string, unknown>) => {
      (value.evidenceSequence as Record<string, unknown>[])[0]!.commitLsn = Number.MAX_SAFE_INTEGER + 1
    }],
    ['malformed nested record', (value: Record<string, unknown>) => {
      (value.creationProvenance as Record<string, unknown>).extra = true
    }],
  ])('refuses %s', (_label, mutate) => {
    const fixture = aidInstance('active')
    mutate(fixture.input)
    expect(createNarrativePatternInstanceContract(fixture.input, fixture.views).kind).toBe('refused')
  })

  it('stalled and expired states contain only actual advancement evidence', () => {
    for (const state of ['stalled', 'expired'] as const) {
      const fixture = aidInstance(state)
      const result = createNarrativePatternInstanceContract(fixture.input, fixture.views)
      expect(result.kind).toBe('ok')
      if (result.kind === 'ok') {
        expect(result.instance.supportingRecordIdentityTuple.map((entry) => entry.semanticRole))
          .toEqual(['aid-start'])
        expect(result.instance.evidenceSequence).toHaveLength(1)
      }
    }
  })
})
