import { describe, expect, it } from 'vitest'
import { createAttentionRevealScope, revalidateAttentionRevealScope } from './attentionRevealScope'
import { createAttentionLedger } from './attentionLedger'
import { ATTENTION_LEDGER_POLICY_VERSION } from './attentionCandidatePolicy'
import { runAttentionMixedFamilyEvaluation } from './attentionReplay'
import { buildB6PatternOnlyEvaluationInput } from './attentionReplayScenario'

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
    const direct = createAttentionRevealScope(['assertion-a'], { kind: 'direct_recipient', recipientId: 'recipient-a' })
    const changedRecipient = createAttentionRevealScope(['assertion-a'], { kind: 'direct_recipient', recipientId: 'recipient-b' })
    const expanded = createAttentionRevealScope(['assertion-a', 'assertion-b'], { kind: 'direct_recipient', recipientId: 'recipient-a' })
    if (typeof direct === 'string' || typeof changedRecipient === 'string' || typeof expanded === 'string') throw new Error('expected valid scopes')
    const legal = Object.freeze({ kind: 'legal' as const, candidateId, channelId: 'diegetic-direct-communication-v1', revealerId: 'speaker', recipientScope: direct.approvedRecipientScope })
    const authority = Object.freeze({ candidateId, channelId: 'diegetic-direct-communication-v1' as const, revealerId: 'speaker', route: 'authoritatively-knows' as const,
      communicationLegalityPolicyVersion: 'communication-legality-c4-v1', communicationLegalityPolicyHash: 'communication-legality-c4-v1:declared-individual-speaker-policy-and-recipient-scope', channelPolicyVersion: 'attention-channel-policy-c3-v1', channelPolicyHash: 'channel-hash' })
    const withC4 = (rankingVerdict: typeof legal | { readonly kind: 'refused'; readonly reason: 'no_legal_channel' }, revalidationRevealScope = direct) => ({
      ...base,
      patternPresentationInputs: Object.freeze(base.patternPresentationInputs.map((entry) => entry.candidateId === candidateId
        ? Object.freeze({ ...entry, c4Eligibility: Object.freeze({ rankingVerdict, approvedRevealScope: direct, communicationAuthorityMaterial: authority,
          ...(rankingVerdict.kind === 'legal' ? { revalidationVerdict: legal, revalidationRevealScope } : {}) }) })
        : entry)),
    })

    const stillLegal = runAttentionMixedFamilyEvaluation(withC4(legal))
    expect(stillLegal.kind).toBe('ok')
    if (stillLegal.kind !== 'ok') throw new Error('expected C4 legal tuple to reach the real package and renderer pipeline')
    expect(stillLegal.result.presentation?.candidateId).toBe(candidateId)
    expect(stillLegal.result.trace.communicationAuthorityMaterial).toEqual([authority])
    expect(stillLegal.result.trace.revealScopeMaterial).toEqual([expect.objectContaining({
      candidateId, approvedRevealScope: direct, revalidationOutcome: 'still-legal',
    })])
    expect(stillLegal.result.trace.playerObservable).not.toHaveProperty('communicationAuthorityMaterial')

    const rankingRefusal = runAttentionMixedFamilyEvaluation(withC4(Object.freeze({ kind: 'refused', reason: 'no_legal_channel' as const })))
    expect(rankingRefusal.kind).toBe('ok')
    if (rankingRefusal.kind !== 'ok') throw new Error('expected C4 ranking refusal to remain an evaluation result')
    expect(rankingRefusal.result.orderedCandidates).toEqual([])
    expect(rankingRefusal.result.retainedCandidates).toEqual([])
    expect(rankingRefusal.result.arbitrationAttempts).toEqual([])
    expect(rankingRefusal.result.ledger.records).toEqual([])

    const shrinkRefusal = runAttentionMixedFamilyEvaluation(withC4(legal, changedRecipient))
    expect(shrinkRefusal.kind).toBe('ok')
    if (shrinkRefusal.kind !== 'ok') throw new Error('expected local C4 revalidation refusal')
    expect(shrinkRefusal.result.arbitrationAttempts[0]).toMatchObject({ outcome: 'revalidation-refused', refusalReason: 'no_legal_channel', continued: true })
    expect(shrinkRefusal.result.ledger.records).toEqual([])
    expect(shrinkRefusal.result.trace.revealScopeMaterial).toEqual([expect.objectContaining({ candidateId, revalidationOutcome: 'no_legal_channel' })])
    expect(shrinkRefusal.result.trace.playerObservable).not.toHaveProperty('revealScopeMaterial')

    expect(runAttentionMixedFamilyEvaluation(withC4(legal, expanded))).toEqual({ kind: 'refused', refusal: {
      stage: 'reveal-scope', candidateId, reason: 'reveal_scope_expansion_attempt',
    } })
  })
})
