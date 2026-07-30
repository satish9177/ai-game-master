import { describe, expect, it } from 'vitest'
import { createAttentionRevealScope, revalidateAttentionRevealScope } from './attentionRevealScope'
import { createAttentionLedger } from './attentionLedger'
import { ATTENTION_LEDGER_POLICY_VERSION } from './attentionCandidatePolicy'
import { runAttentionMixedFamilyEvaluation } from './attentionReplay'
import { buildB6PatternOnlyEvaluationInput } from './attentionReplayScenario'
import { ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION } from './attentionCommunicationAuthorityContracts'
import { readAttentionReadableCommunicationAuthorityViews } from './attentionCommunicationAuthorityAccessor'
import { buildAttentionDirectEvidenceAssertions } from './attentionDirectEvidenceAssertion'
import { canonicalSerialize } from './canonicalSerialization'
import { createAttentionReplayAuthoritativeResources } from './attentionReplayResources'
import { ATTENTION_CHANNEL_POLICY_HASH } from './attentionChannelRegistry'

function authorityViews(records: readonly object[]) {
  const result = readAttentionReadableCommunicationAuthorityViews(
    Object.freeze({ authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION, records: Object.freeze(records) }) as never,
    { authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION },
  )
  if (result.kind !== 'ok') throw new Error(result.reason)
  return result.views
}

function publicKnowledge(entityId: string, propositionKey: string) {
  return Object.freeze({
    authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION,
    visibility: 'public' as const,
    authorityKind: 'public_knowledge' as const,
    entityId,
    revealerClass: 'individual' as const,
    propositionKey,
    groundingRecordId: `grounding-${propositionKey}`,
    visibilityProvenanceId: `public-${propositionKey}`,
    commitLsn: 1,
  })
}

describe('C4 reveal scope', () => {
  const approved = createAttentionRevealScope(['assertion-a'], { kind: 'direct_recipient', recipientId: 'recipient-a' })
  it('is closed and byte-exact through revalidation', () => {
    if (typeof approved === 'string') throw new Error(approved)
    expect(revalidateAttentionRevealScope(approved, approved)).toBe('still-legal')
    const shrunken = createAttentionRevealScope(['assertion-a'], { kind: 'direct_recipient', recipientId: 'recipient-b' })
    expect(typeof shrunken === 'string' ? shrunken : revalidateAttentionRevealScope(approved, shrunken)).toBe('no_legal_channel')
    const expanded = createAttentionRevealScope(['assertion-a', 'assertion-b'], { kind: 'direct_recipient', recipientId: 'recipient-a' })
    expect(typeof expanded === 'string' ? expanded : revalidateAttentionRevealScope(approved, expanded)).toBe('reveal_scope_expansion_attempt')
  })

  it('routes recipient legality before ranking, refuses a shrunken scope locally, and fails a widened scope closed', () => {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (ledger.kind !== 'ok') throw new Error('expected empty ledger')
    const base = buildB6PatternOnlyEvaluationInput('c4-scope-pipeline', ledger.ledger)
    const candidateId = base.patternPresentationInputs[0]!.candidateId
    const direct = { kind: 'direct_recipient' as const, recipientId: 'recipient-a' }
    const changedRecipient = { kind: 'direct_recipient' as const, recipientId: 'recipient-b' }
    const raw = (
      scope: typeof direct,
      assertionIds: readonly string[] = ['assertion-a'],
      views = authorityViews([publicKnowledge('speaker', 'aid')]),
      channelAvailable = true,
    ) => Object.freeze({
      authorityRequest: Object.freeze({
        policyRef: 'communication-legality-c3-v1' as const,
        candidateId: 'fixture-candidate',
        channelId: 'diegetic-direct-communication-v1' as const,
        propositionKey: 'aid',
        sourcePropositionKeys: Object.freeze([]),
        aggregateRuleLicensed: false,
        authorityViews: views,
        availabilityEvidence: Object.freeze([]),
        declaredChannelAvailability: Object.freeze([{ channelId: 'diegetic-direct-communication-v1' as const, available: channelAvailable, validatorIntakeAvailable: true }]),
      }),
      recipientScope: scope,
      authorizedRecipientIds: Object.freeze(['recipient-a', 'recipient-b']),
      unavailableRecipientIds: Object.freeze([]),
      assertionIds: Object.freeze([...assertionIds]),
    })
    const withC4 = (ranking = raw(direct), revalidation = raw(direct), delivery?: object) => ({
      ...base,
      patternPresentationInputs: Object.freeze(base.patternPresentationInputs.map((entry) => entry.candidateId === candidateId
        ? Object.freeze({ ...entry, c4Eligibility: Object.freeze({ ranking, revalidation, ...(delivery === undefined ? {} : { delivery }) }) })
        : entry)),
    })

    const stillLegal = runAttentionMixedFamilyEvaluation(withC4())
    expect(stillLegal.kind).toBe('ok')
    if (stillLegal.kind !== 'ok') throw new Error('expected C4 legal tuple to reach the real package and renderer pipeline')
    expect(stillLegal.result.presentation?.candidateId).toBe(candidateId)
    expect(stillLegal.result.trace.communicationAuthorityMaterial).toEqual([expect.objectContaining({
      candidateId, channelId: 'diegetic-direct-communication-v1', revealerId: 'speaker', route: 'authoritatively-knows',
    })])
    expect(stillLegal.result.trace.revealScopeMaterial).toEqual([expect.objectContaining({
      candidateId, approvedRevealScope: expect.objectContaining({ approvedRecipientScope: direct }), revalidationOutcome: 'still-legal',
    })])
    expect(stillLegal.result.trace.playerObservable).not.toHaveProperty('communicationAuthorityMaterial')

    const rankingRefusal = runAttentionMixedFamilyEvaluation(withC4(raw(direct, ['assertion-a'], authorityViews([]))))
    expect(rankingRefusal.kind).toBe('ok')
    if (rankingRefusal.kind !== 'ok') throw new Error('expected C4 ranking refusal to remain an evaluation result')
    expect(rankingRefusal.result.orderedCandidates).toEqual([])
    expect(rankingRefusal.result.retainedCandidates).toEqual([])
    expect(rankingRefusal.result.arbitrationAttempts).toEqual([])
    expect(rankingRefusal.result.ledger.records).toEqual([])

    const illegalChannel = runAttentionMixedFamilyEvaluation(withC4(raw(direct, ['assertion-a'], undefined, false)))
    expect(illegalChannel.kind).toBe('ok')
    if (illegalChannel.kind !== 'ok') throw new Error('expected C3 illegal channel to remain an evaluation result')
    expect(illegalChannel.result.orderedCandidates).toEqual([])
    expect(illegalChannel.result.ledger.records).toEqual([])

    const shrinkRefusal = runAttentionMixedFamilyEvaluation(withC4(raw(direct), raw(changedRecipient)))
    expect(shrinkRefusal.kind).toBe('ok')
    if (shrinkRefusal.kind !== 'ok') throw new Error('expected local C4 revalidation refusal')
    expect(shrinkRefusal.result.arbitrationAttempts[0]).toMatchObject({ outcome: 'revalidation-refused', refusalReason: 'no_legal_channel', continued: true })
    expect(shrinkRefusal.result.ledger.records).toEqual([])
    expect(shrinkRefusal.result.trace.revealScopeMaterial).toEqual([expect.objectContaining({ candidateId, revalidationOutcome: 'no_legal_channel' })])
    expect(shrinkRefusal.result.trace.playerObservable).not.toHaveProperty('revealScopeMaterial')

    const revalidationChannelRefusal = runAttentionMixedFamilyEvaluation(withC4(raw(direct), raw(direct, ['assertion-a'], undefined, false)))
    expect(revalidationChannelRefusal.kind).toBe('ok')
    if (revalidationChannelRefusal.kind !== 'ok') throw new Error('expected raw C3 revalidation to run again')
    expect(revalidationChannelRefusal.result.arbitrationAttempts[0])
      .toMatchObject({ outcome: 'revalidation-refused', refusalReason: 'no_legal_channel', continued: true })
    expect(revalidationChannelRefusal.result.ledger.records).toEqual([])

    expect(runAttentionMixedFamilyEvaluation(withC4(raw(direct), raw(direct, ['assertion-a', 'assertion-b'])))).toEqual({ kind: 'refused', refusal: {
      stage: 'reveal-scope', candidateId, reason: 'reveal_scope_expansion_attempt',
    } })
  })

  it('composes C3/C4 and C6 through the real evaluator, package, renderer, validator, ledger, and observable trace v2', () => {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (ledger.kind !== 'ok') throw new Error('expected empty ledger')
    const base = buildB6PatternOnlyEvaluationInput('c6-real-evaluator', ledger.ledger)
    const entry = base.patternPresentationInputs[0]!
    const assertions = buildAttentionDirectEvidenceAssertions(entry.directEvidenceAssertionInputs)
    if (assertions.kind !== 'ok') throw new Error('expected direct assertions')
    const scope = { kind: 'direct_recipient' as const, recipientId: 'recipient-a' }
    const revealScope = Object.freeze({ approvedAssertionIds: Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId).sort()), approvedRecipientScope: scope })
    const authority = authorityViews([publicKnowledge('speaker', 'aid')])
    const legality = Object.freeze({
      authorityRequest: Object.freeze({ policyRef: 'communication-legality-c3-v1' as const, candidateId: 'fixture-candidate', channelId: 'diegetic-direct-communication-v1' as const,
        propositionKey: 'aid', sourcePropositionKeys: Object.freeze([]), aggregateRuleLicensed: false, authorityViews: authority, availabilityEvidence: Object.freeze([]),
        declaredChannelAvailability: Object.freeze([{ channelId: 'diegetic-direct-communication-v1' as const, available: true, validatorIntakeAvailable: true }]) }),
      recipientScope: scope,
      authorizedRecipientIds: Object.freeze(['recipient-a']),
      unavailableRecipientIds: Object.freeze([]),
      assertionIds: revealScope.approvedAssertionIds,
    })
    const resources = createAttentionReplayAuthoritativeResources(13)
    const result = runAttentionMixedFamilyEvaluation({
      ...base,
      patternPresentationInputs: Object.freeze([{ ...entry, c4Eligibility: Object.freeze({
        ranking: legality,
        revalidation: legality,
        delivery: Object.freeze({ resources, wallClockInput: 17, authoritativePayloads: Object.freeze([Object.freeze({
          communicationKey: 'c6-real-evaluator',
          assertionContent: Object.freeze(assertions.assertions.map((assertion) => assertion.assertionId)),
          assertionProvenance: Object.freeze(assertions.assertions.map((assertion) => canonicalSerialize(assertion))),
          channelId: 'diegetic-direct-communication-v1', revealerId: 'speaker', recipientScope: scope, revealScope,
          policyIdentities: Object.freeze([
            'communication-legality-c4-v1',
            'communication-legality-c4-v1:declared-individual-speaker-policy-and-recipient-scope',
            'attention-channel-policy-c3-v1',
            ATTENTION_CHANNEL_POLICY_HASH,
          ]),
          available: true,
        })]) }),
      }) }]),
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected composed C6 result')
    expect(result.result.authoritativeResources?.log.commits).toHaveLength(1)
    expect(result.result.ledger.records).toHaveLength(1)
    expect(result.result.presentation).toMatchObject({ channelId: 'diegetic-direct-communication-v1', revealerId: 'speaker' })
    expect(result.result.trace.observableTraceSchemaVersion).toBe('attention-observable-trace-schema-v2')
    expect(result.result.trace.playerObservable.presentations[0]).toMatchObject({ channelId: 'diegetic-direct-communication-v1', revealerId: 'speaker' })
  })
})
