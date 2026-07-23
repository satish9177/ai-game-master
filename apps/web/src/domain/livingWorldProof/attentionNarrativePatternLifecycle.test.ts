import { describe, expect, it } from 'vitest'
import {
  abandonNarrativePatternInstance,
  advanceNarrativePatternInstance,
  canReopenExactNarrativePatternInstanceId,
  completeNarrativePatternInstance,
  createNarrativePatternInstance,
  invalidateNarrativePatternInstance,
  narrativePatternExpiryDeadlineLsn,
  refreshNarrativePatternAnnotation,
  resolveNarrativePatternAnnotation,
  retireNarrativePatternInstance,
} from './attentionNarrativePatternLifecycle'
import type {
  NarrativePatternBinding,
  NarrativePatternDirectEvidenceAssertionInput,
  NarrativePatternInstance,
  NarrativePatternSupportingRole,
  NarrativePatternType,
} from './attentionNarrativePatternContracts'
import { createNarrativePatternInstanceContract } from './attentionNarrativePatternContracts'
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

function mint(input: ProofPatternEvidenceRecordInput): AttentionReadablePatternEvidenceView {
  const record = createProofPatternEvidenceRecord(input)
  const snapshot = createProofPatternEvidenceSnapshot({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    records: [record],
  })
  const result = readAttentionReadablePatternEvidenceViews(snapshot, {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
  })
  if (result.kind !== 'ok' || result.views.length !== 1) throw new Error('fixture mint failed')
  return result.views[0]!
}

function aid(
  recordId: string,
  commitLsn: number,
  actorId = 'npc-a',
  targetId = 'npc-b',
): AttentionReadablePatternEvidenceView {
  return mint({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordKind: 'observable_action',
    actionCode: 'aid',
    recordId,
    commitLsn,
    worldTimeTick: 100 + commitLsn,
    visibilityProvenance: { visibility: 'public', provenanceId: `public-${recordId}` },
    actorId,
    targetId,
  })
}

function harm(
  recordId: string,
  commitLsn: number,
  actorId: string,
  targetId: string,
): AttentionReadablePatternEvidenceView {
  return mint({
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
  })
}

function reconcileAction(recordId: string, commitLsn: number, actorId = 'npc-a', targetId = 'npc-b') {
  return mint({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordKind: 'observable_action',
    actionCode: 'reconcile',
    recordId,
    commitLsn,
    worldTimeTick: 100 + commitLsn,
    visibilityProvenance: { visibility: 'public', provenanceId: `public-${recordId}` },
    actorId,
    targetId,
  })
}

function reconcileCommunication(
  recordId: string,
  commitLsn: number,
  speakerId = 'npc-b',
  recipientId = 'npc-a',
) {
  return mint({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordKind: 'validated_public_communication',
    communicationCode: 'reconciliation',
    recordId,
    commitLsn,
    worldTimeTick: 100 + commitLsn,
    visibilityProvenance: { visibility: 'public', provenanceId: `public-${recordId}` },
    speakerId,
    recipientId,
  })
}

function commitment(recordId: string, commitLsn: number, deadline = 21) {
  return mint({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordKind: 'validated_public_communication',
    communicationCode: 'commitment',
    recordId,
    commitLsn,
    worldTimeTick: 100 + commitLsn,
    visibilityProvenance: { visibility: 'public', provenanceId: `public-${recordId}` },
    speakerId: 'npc-a',
    recipientId: 'npc-b',
    commitmentKey: 'bring-medicine',
    publicDeadlineLsn: deadline,
  })
}

function fulfillment(recordId: string, commitLsn: number, key = 'bring-medicine') {
  return mint({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordKind: 'observable_action',
    actionCode: 'fulfill_commitment',
    recordId,
    commitLsn,
    worldTimeTick: 100 + commitLsn,
    visibilityProvenance: { visibility: 'public', provenanceId: `public-${recordId}` },
    actorId: 'npc-a',
    targetId: 'npc-b',
    commitmentKey: key,
  })
}

function retract(recordId: string, commitLsn: number, key = 'bring-medicine') {
  return mint({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordKind: 'validated_public_communication',
    communicationCode: 'retract_commitment',
    recordId,
    commitLsn,
    worldTimeTick: 100 + commitLsn,
    visibilityProvenance: { visibility: 'public', provenanceId: `public-${recordId}` },
    speakerId: 'npc-a',
    recipientId: 'npc-b',
    commitmentKey: key,
  })
}

function availability(recordId: string, commitLsn: number, entityId = 'npc-b') {
  return mint({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordKind: 'world_observable_availability',
    availabilityCode: 'departed',
    recordId,
    commitLsn,
    worldTimeTick: 100 + commitLsn,
    visibilityProvenance: { visibility: 'public', provenanceId: `public-${recordId}` },
    entityId,
  })
}

function assertion(view: AttentionReadablePatternEvidenceView): NarrativePatternDirectEvidenceAssertionInput {
  if (view.recordKind === 'observable_action' && view.actionCode === 'aid') {
    return {
      assertionKind: 'public_aid',
      sourceRecordId: view.recordId,
      visibilityProvenanceId: view.visibilityProvenanceId,
      actorId: view.actorId,
      targetId: view.targetId,
    }
  }
  if (view.recordKind === 'observable_action' && view.actionCode === 'harm') {
    return {
      assertionKind: 'public_harm_severity',
      sourceRecordId: view.recordId,
      visibilityProvenanceId: view.visibilityProvenanceId,
      actorId: view.actorId,
      targetId: view.targetId,
      publicSeverityBand: view.publicSeverityBand,
    }
  }
  if (
    view.recordKind === 'validated_public_communication'
    && view.communicationCode === 'commitment'
  ) {
    return {
      assertionKind: 'public_commitment',
      sourceRecordId: view.recordId,
      visibilityProvenanceId: view.visibilityProvenanceId,
      speakerId: view.speakerId,
      recipientId: view.recipientId,
      commitmentKey: view.commitmentKey,
    }
  }
  if (
    view.recordKind === 'observable_action'
    && view.actionCode === 'fulfill_commitment'
  ) {
    return {
      assertionKind: 'public_fulfillment_record',
      sourceRecordId: view.recordId,
      visibilityProvenanceId: view.visibilityProvenanceId,
      actorId: view.actorId,
      targetId: view.targetId,
      commitmentKey: view.commitmentKey,
    }
  }
  throw new Error('no direct assertion for terminal evidence')
}

interface ActiveFixture {
  readonly instance: NarrativePatternInstance
  readonly evidenceViews: readonly AttentionReadablePatternEvidenceView[]
}

function bindings(patternType: NarrativePatternType): readonly NarrativePatternBinding[] {
  return patternType === 'public_commitment_fulfilled'
    ? [
        { role: 'committer', entityId: 'npc-a' },
        { role: 'recipient', entityId: 'npc-b' },
      ]
    : [
        { role: 'initiator', entityId: 'npc-a' },
        { role: 'counterparty', entityId: 'npc-b' },
      ]
}

function createActive(
  patternType: NarrativePatternType = 'reciprocal_public_aid',
  evaluationSnapshotLsn = 7,
  commitmentDeadlineLsn = 21,
): ActiveFixture {
  const start = patternType === 'public_conflict_escalation'
    ? harm('harm-1', 7, 'npc-a', 'npc-b')
    : patternType === 'public_commitment_fulfilled'
      ? commitment('commitment-1', 7, commitmentDeadlineLsn)
      : aid('aid-1', 7)
  const startRole: NarrativePatternSupportingRole = patternType === 'public_conflict_escalation'
    ? 'harm-start'
    : patternType === 'public_commitment_fulfilled'
      ? 'commitment-start'
      : 'aid-start'
  const result = createNarrativePatternInstance({
    patternType,
    patternContentHash: `content-${patternType}-v1`,
    evaluationSnapshotLsn,
    bindingMap: bindings(patternType),
    startEvidence: start,
    startSemanticRole: startRole,
    directAssertionInput: assertion(start),
  })
  if (result.kind !== 'ok') throw new Error(`creation failed: ${result.reason}`)
  return { instance: result.instance, evidenceViews: Object.freeze([start]) }
}

function transitionInput(
  fixture: ActiveFixture,
  evidence: AttentionReadablePatternEvidenceView,
  semanticRole: NarrativePatternSupportingRole,
  directAssertionInput?: NarrativePatternDirectEvidenceAssertionInput,
  evaluationSnapshotLsn = evidence.commitLsn,
) {
  return {
    instance: fixture.instance,
    supportingEvidenceViews: fixture.evidenceViews,
    evidence,
    semanticRole,
    evaluationSnapshotLsn,
    ...(directAssertionInput === undefined ? {} : { directAssertionInput }),
  }
}

function nextFixture(
  prior: ActiveFixture,
  result: ReturnType<typeof advanceNarrativePatternInstance>,
  evidence: AttentionReadablePatternEvidenceView,
): ActiveFixture {
  if (result.kind !== 'ok') throw new Error(`transition failed: ${result.reason}`)
  return {
    instance: result.instance,
    evidenceViews: Object.freeze([...prior.evidenceViews, evidence]),
  }
}

function contractKindWithAnnotation(
  fixture: ActiveFixture,
  evaluationSnapshotLsn: number,
  narrativeAnnotation: 'active' | 'stalled' | 'expired' | 'abandoned',
): 'ok' | 'refused' {
  if (fixture.instance.monitorVerdict !== 'inconclusive') {
    throw new Error('fixture is not inconclusive')
  }
  return createNarrativePatternInstanceContract({
    ...fixture.instance,
    evaluationSnapshotLsn,
    narrativeAnnotation,
  }, fixture.evidenceViews).kind
}

describe('B2 NarrativePatternInstance lifecycle', () => {
  it.each([
    'reciprocal_public_aid',
    'public_conflict_escalation',
    'public_commitment_fulfilled',
  ] as const)('creates %s as inconclusive active with exactly one legal start record', (patternType) => {
    const fixture = createActive(patternType)
    expect(fixture.instance.monitorVerdict).toBe('inconclusive')
    expect(
      fixture.instance.monitorVerdict === 'inconclusive'
        && fixture.instance.narrativeAnnotation,
    ).toBe('active')
    expect(fixture.instance.progressStep).toBe(1)
    expect(fixture.instance.evidenceSequence).toHaveLength(1)
  })

  it.each([
    'reciprocal_public_aid',
    'public_conflict_escalation',
    'public_commitment_fulfilled',
  ] as const)(
    'derives the only legal active/stalled/expired/abandoned annotation for %s',
    (patternType) => {
      const fixture = createActive(patternType)
      const deadline = patternType === 'public_commitment_fulfilled'
        ? 21
        : narrativePatternExpiryDeadlineLsn(patternType, 7)

      expect(contractKindWithAnnotation(fixture, 7, 'active')).toBe('ok')
      expect(contractKindWithAnnotation(fixture, 10, 'active')).toBe('ok')
      expect(contractKindWithAnnotation(fixture, 11, 'stalled')).toBe('ok')
      expect(contractKindWithAnnotation(fixture, 12, 'stalled')).toBe('ok')
      expect(contractKindWithAnnotation(fixture, deadline + 1, 'expired')).toBe('ok')

      expect(contractKindWithAnnotation(fixture, 11, 'active')).toBe('refused')
      expect(contractKindWithAnnotation(fixture, deadline + 1, 'active')).toBe('refused')
      expect(contractKindWithAnnotation(fixture, 10, 'stalled')).toBe('refused')
      expect(contractKindWithAnnotation(fixture, deadline + 1, 'stalled')).toBe('refused')
      expect(contractKindWithAnnotation(fixture, deadline, 'expired')).toBe('refused')
      expect(contractKindWithAnnotation(fixture, deadline - 1, 'expired')).toBe('refused')
      expect(contractKindWithAnnotation(fixture, 7, 'abandoned')).toBe('refused')

      const departed = availability(`${patternType}-late-departure`, deadline + 1)
      const abandoned = abandonNarrativePatternInstance(
        transitionInput(fixture, departed, 'availability-terminal'),
      )
      expect(abandoned.kind).toBe('ok')
      if (abandoned.kind !== 'ok') return
      const abandonedFixture = {
        instance: abandoned.instance,
        evidenceViews: Object.freeze([...fixture.evidenceViews, departed]),
      }
      expect(contractKindWithAnnotation(
        abandonedFixture,
        deadline + 1,
        'abandoned',
      )).toBe('ok')
      for (const wrong of ['active', 'stalled', 'expired'] as const) {
        expect(contractKindWithAnnotation(abandonedFixture, deadline + 1, wrong))
          .toBe('refused')
      }
    },
  )

  it('allows active at the exact deadline when the last progress delta is below four', () => {
    const commitmentFixture = createActive('public_commitment_fulfilled', 7, 10)
    expect(contractKindWithAnnotation(commitmentFixture, 10, 'active')).toBe('ok')

    const conflictFixture = createActive('public_conflict_escalation')
    const reply = harm('near-deadline-reply', 21, 'npc-b', 'npc-a')
    const advanced = advanceNarrativePatternInstance(
      transitionInput(conflictFixture, reply, 'harm-reply', assertion(reply)),
    )
    const child = nextFixture(conflictFixture, advanced, reply)
    expect(contractKindWithAnnotation(child, 23, 'active')).toBe('ok')
  })

  it('advances conflict using real evidence coordinates and mints a new identity', () => {
    const fixture = createActive('public_conflict_escalation')
    const reply = harm('harm-2', 9, 'npc-b', 'npc-a')
    const result = advanceNarrativePatternInstance(
      transitionInput(fixture, reply, 'harm-reply', assertion(reply)),
    )
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.instance.progressStep).toBe(2)
    expect(result.instance.lastProgressLsn).toBe(9)
    expect(result.instance.patternInstanceId).not.toBe(fixture.instance.patternInstanceId)
  })

  it('derives intermediate transition annotations from the new progress and evaluation coordinates', () => {
    const stalledFixture = createActive('public_conflict_escalation')
    const stalledReply = harm('stalled-reply', 9, 'npc-b', 'npc-a')
    const stalled = advanceNarrativePatternInstance(
      transitionInput(
        stalledFixture,
        stalledReply,
        'harm-reply',
        assertion(stalledReply),
        13,
      ),
    )
    expect(stalled.kind).toBe('ok')
    if (stalled.kind === 'ok') {
      expect(
        stalled.instance.monitorVerdict === 'inconclusive'
          && stalled.instance.narrativeAnnotation,
      ).toBe('stalled')
    }

    const expiredFixture = createActive('public_conflict_escalation')
    const boundaryReply = harm('boundary-reply', 23, 'npc-b', 'npc-a')
    const expired = advanceNarrativePatternInstance(
      transitionInput(
        expiredFixture,
        boundaryReply,
        'harm-reply',
        assertion(boundaryReply),
        24,
      ),
    )
    expect(expired.kind).toBe('ok')
    if (expired.kind === 'ok') {
      expect(
        expired.instance.monitorVerdict === 'inconclusive'
          && expired.instance.narrativeAnnotation,
      ).toBe('expired')
    }
  })

  it.each([
    [18, 'ok'],
    [19, 'ok'],
    [20, 'evidence-after-expiry-deadline'],
  ] as const)('aid completion at LSN %i has result %s', (commitLsn, expected) => {
    const fixture = createActive()
    const returned = aid(`aid-return-${commitLsn}`, commitLsn, 'npc-b', 'npc-a')
    const result = completeNarrativePatternInstance(
      transitionInput(fixture, returned, 'aid-return', assertion(returned)),
    )
    expect(result.kind === 'ok' ? 'ok' : result.reason).toBe(expected)
  })

  it.each([
    [19, 'ok'],
    [20, 'evidence-after-expiry-deadline'],
  ] as const)('aid invalidation at LSN %i has result %s', (commitLsn, expected) => {
    const fixture = createActive()
    const invalidation = harm(`harm-${commitLsn}`, commitLsn, 'npc-b', 'npc-a')
    const result = invalidateNarrativePatternInstance(
      transitionInput(fixture, invalidation, 'aid-invalidation'),
    )
    expect(result.kind === 'ok' ? 'ok' : result.reason).toBe(expected)
  })

  it('refuses an aid record as aid-invalidation', () => {
    const fixture = createActive()
    const wrong = aid('not-an-invalidation', 9, 'npc-b', 'npc-a')
    expect(invalidateNarrativePatternInstance(
      transitionInput(fixture, wrong, 'aid-invalidation'),
    )).toEqual({ kind: 'refused', reason: 'invalid-instance-contract' })
  })

  it.each([
    [23, 'ok'],
    [24, 'evidence-after-expiry-deadline'],
  ] as const)('conflict completion at LSN %i has result %s', (commitLsn, expected) => {
    const start = createActive('public_conflict_escalation')
    const reply = harm('harm-reply', 9, 'npc-b', 'npc-a')
    const advanced = advanceNarrativePatternInstance(
      transitionInput(start, reply, 'harm-reply', assertion(reply)),
    )
    const child = nextFixture(start, advanced, reply)
    const escalation = harm(`harm-escalation-${commitLsn}`, commitLsn, 'npc-a', 'npc-b')
    const result = completeNarrativePatternInstance(
      transitionInput(child, escalation, 'harm-escalation', assertion(escalation)),
    )
    expect(result.kind === 'ok' ? 'ok' : result.reason).toBe(expected)
  })

  it.each([
    ['action', reconcileAction('reconcile-action', 23)],
    ['communication', reconcileCommunication('reconcile-communication', 23)],
  ])('accepts %s reconciliation in either participant direction at the boundary', (_kind, evidence) => {
    const fixture = createActive('public_conflict_escalation')
    expect(invalidateNarrativePatternInstance(
      transitionInput(fixture, evidence, 'reconciliation-terminal'),
    ).kind).toBe('ok')
  })

  it('refuses reconciliation invalidation after the conflict deadline', () => {
    const fixture = createActive('public_conflict_escalation')
    const evidence = reconcileAction('late-reconciliation', 24)
    expect(invalidateNarrativePatternInstance(
      transitionInput(fixture, evidence, 'reconciliation-terminal'),
    )).toEqual({ kind: 'refused', reason: 'evidence-after-expiry-deadline' })
  })

  it.each([
    [21, 'ok'],
    [22, 'evidence-after-expiry-deadline'],
  ] as const)('commitment fulfillment at LSN %i has result %s', (commitLsn, expected) => {
    const fixture = createActive('public_commitment_fulfilled')
    const evidence = fulfillment(`fulfillment-${commitLsn}`, commitLsn)
    const result = completeNarrativePatternInstance(
      transitionInput(fixture, evidence, 'fulfillment', assertion(evidence)),
    )
    expect(result.kind === 'ok' ? 'ok' : result.reason).toBe(expected)
  })

  it.each([
    [21, 'ok'],
    [22, 'evidence-after-expiry-deadline'],
  ] as const)('commitment retraction at LSN %i has result %s', (commitLsn, expected) => {
    const fixture = createActive('public_commitment_fulfilled')
    const evidence = retract(`retract-${commitLsn}`, commitLsn)
    const result = invalidateNarrativePatternInstance(
      transitionInput(fixture, evidence, 'retraction-or-refusal-terminal'),
    )
    expect(result.kind === 'ok' ? 'ok' : result.reason).toBe(expected)
  })

  it('refuses mismatched commitment keys and non-reconciliation conflict evidence', () => {
    const commitmentFixture = createActive('public_commitment_fulfilled')
    const wrongKey = fulfillment('wrong-key', 10, 'different-key')
    expect(completeNarrativePatternInstance(
      transitionInput(commitmentFixture, wrongKey, 'fulfillment', assertion(wrongKey)),
    )).toEqual({ kind: 'refused', reason: 'invalid-instance-contract' })

    const conflictFixture = createActive('public_conflict_escalation')
    const wrongTerminal = harm('not-reconciliation', 10, 'npc-a', 'npc-b')
    expect(invalidateNarrativePatternInstance(
      transitionInput(conflictFixture, wrongTerminal, 'reconciliation-terminal'),
    )).toEqual({ kind: 'refused', reason: 'invalid-instance-contract' })
  })

  it.each([
    'reciprocal_public_aid',
    'public_conflict_escalation',
    'public_commitment_fulfilled',
  ] as const)('abandons %s only for a required bound participant', (patternType) => {
    const fixture = createActive(patternType)
    const participant = availability(`${patternType}-departed`, 9, 'npc-b')
    expect(abandonNarrativePatternInstance(
      transitionInput(fixture, participant, 'availability-terminal'),
    ).kind).toBe('ok')
    const outsider = availability(`${patternType}-outsider`, 9, 'npc-z')
    expect(abandonNarrativePatternInstance(
      transitionInput(fixture, outsider, 'availability-terminal'),
    )).toEqual({ kind: 'refused', reason: 'invalid-instance-contract' })
  })

  it('uses strict expiry and independent stall equality with total annotation precedence', () => {
    expect(resolveNarrativePatternAnnotation(10, 7, 19, false)).toBe('active')
    expect(resolveNarrativePatternAnnotation(11, 7, 19, false)).toBe('stalled')
    expect(resolveNarrativePatternAnnotation(18, 7, 19, false)).toBe('stalled')
    expect(resolveNarrativePatternAnnotation(19, 7, 19, false)).toBe('stalled')
    expect(resolveNarrativePatternAnnotation(20, 7, 19, false)).toBe('expired')
    expect(resolveNarrativePatternAnnotation(20, 7, 19, true)).toBe('abandoned')
  })

  it('pins the exact 12/16/public-deadline horizons and refuses overflow', () => {
    expect(narrativePatternExpiryDeadlineLsn('reciprocal_public_aid', 7)).toBe(19)
    expect(narrativePatternExpiryDeadlineLsn('public_conflict_escalation', 7)).toBe(23)
    expect(narrativePatternExpiryDeadlineLsn('public_commitment_fulfilled', 7, 21)).toBe(21)
    expect(() => narrativePatternExpiryDeadlineLsn(
      'reciprocal_public_aid',
      Number.MAX_SAFE_INTEGER,
    )).toThrow(/overflow/)
  })

  it('refreshes deadline - 1, deadline, and deadline + 1 without synthetic evidence', () => {
    for (const [snapshot, annotation] of [[18, 'stalled'], [19, 'stalled'], [20, 'expired']] as const) {
      const fixture = createActive()
      const result = refreshNarrativePatternAnnotation(
        fixture.instance,
        fixture.evidenceViews,
        snapshot,
        19,
      )
      expect(result.kind).toBe('ok')
      if (result.kind === 'ok') {
        expect(result.instance.evidenceSequence).toEqual(fixture.instance.evidenceSequence)
        expect(result.instance.supportingRecordIdentityTuple)
          .toEqual(fixture.instance.supportingRecordIdentityTuple)
        expect(
          result.instance.monitorVerdict === 'inconclusive'
            && result.instance.narrativeAnnotation,
        ).toBe(annotation)
      }
    }
  })

  it('processes completion, invalidation, and abandonment at the exact boundary before annotation', () => {
    const completionFixture = createActive()
    const returned = aid('at-deadline-return', 19, 'npc-b', 'npc-a')
    expect(completeNarrativePatternInstance(
      transitionInput(completionFixture, returned, 'aid-return', assertion(returned)),
    ).kind).toBe('ok')

    const invalidationFixture = createActive()
    const invalidation = harm('at-deadline-harm', 19, 'npc-b', 'npc-a')
    expect(invalidateNarrativePatternInstance(
      transitionInput(invalidationFixture, invalidation, 'aid-invalidation'),
    ).kind).toBe('ok')

    const abandonmentFixture = createActive()
    const departed = availability('at-deadline-departed', 19)
    const abandoned = abandonNarrativePatternInstance(
      transitionInput(abandonmentFixture, departed, 'availability-terminal'),
    )
    expect(abandoned.kind).toBe('ok')
    if (abandoned.kind === 'ok') {
      expect(
        abandoned.instance.monitorVerdict === 'inconclusive'
          && abandoned.instance.narrativeAnnotation,
      ).toBe('abandoned')
    }
  })

  it('refuses future evidence and snapshot rewind independently', () => {
    const fixture = createActive()
    const future = aid('future', 9, 'npc-b', 'npc-a')
    expect(completeNarrativePatternInstance(
      transitionInput(fixture, future, 'aid-return', assertion(future), 8),
    )).toEqual({ kind: 'refused', reason: 'invalid-lifecycle-coordinate' })

    const refreshed = refreshNarrativePatternAnnotation(
      fixture.instance,
      fixture.evidenceViews,
      10,
      19,
    )
    if (refreshed.kind !== 'ok') throw new Error('refresh failed')
    const rewoundFixture = { instance: refreshed.instance, evidenceViews: fixture.evidenceViews }
    const evidence = aid('rewind', 8, 'npc-b', 'npc-a')
    expect(completeNarrativePatternInstance(
      transitionInput(rewoundFixture, evidence, 'aid-return', assertion(evidence), 9),
    )).toEqual({ kind: 'refused', reason: 'invalid-lifecycle-coordinate' })
  })

  it('never reopens exact terminal, expired, abandoned, or retired IDs', () => {
    const active = createActive()
    const marker = retireNarrativePatternInstance(active.instance, 8)
    const next = aid('aid-2', 9, 'npc-b', 'npc-a')
    expect(canReopenExactNarrativePatternInstanceId(active.instance)).toBe(false)
    expect(completeNarrativePatternInstance({
      ...transitionInput(active, next, 'aid-return', assertion(next)),
      retirementMarker: marker,
    })).toEqual({ kind: 'refused', reason: 'retired-pattern-instance' })

    const expired = refreshNarrativePatternAnnotation(
      active.instance,
      active.evidenceViews,
      20,
      19,
    )
    if (expired.kind !== 'ok') throw new Error('expiry failed')
    expect(completeNarrativePatternInstance(
      transitionInput(
        { instance: expired.instance, evidenceViews: active.evidenceViews },
        next,
        'aid-return',
        assertion(next),
        20,
      ),
    )).toEqual({ kind: 'refused', reason: 'invalid-lifecycle-transition' })
  })

  it('accepts only accessor-minted evidence and rejects a shape-identical forgery', () => {
    const real = aid('aid-real', 7)
    const forged = Object.freeze({ ...real }) as AttentionReadablePatternEvidenceView
    const result = createNarrativePatternInstance({
      patternType: 'reciprocal_public_aid',
      patternContentHash: 'aid-v1',
      evaluationSnapshotLsn: 7,
      bindingMap: bindings('reciprocal_public_aid'),
      startEvidence: forged,
      startSemanticRole: 'aid-start',
      directAssertionInput: assertion(real),
    })
    expect(result).toEqual({ kind: 'refused', reason: 'input-not-accessor-minted' })
  })
})
