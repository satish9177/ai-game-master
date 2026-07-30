import { describe, expect, it } from 'vitest'
import { evaluateAttentionEligibilityVerdict } from './attentionEligibilityVerdict'

const authority = { kind: 'legal' as const, channelId: 'diegetic-direct-communication-v1' as const, revealerId: 'speaker', authorityKind: 'public_knowledge' as const, route: 'authoritatively-knows' as const, policyVersion: 'communication-legality-c4-v1' as const, policyHash: 'communication-legality-c4-v1:declared-individual-speaker-policy-and-recipient-scope' as const, channelPolicyVersion: 'attention-channel-policy-c3-v1' as const, channelPolicyHash: 'hash' }

describe('C4 complete eligibility tuple', () => {
  it('changes when candidate, channel authority, or recipient scope changes', () => {
    expect(evaluateAttentionEligibilityVerdict({ candidateId: 'candidate-a', authorityVerdict: authority, recipientScope: { kind: 'direct_recipient', recipientId: 'r' }, authorizedRecipientIds: ['r'], unavailableRecipientIds: [] })).toMatchObject({ kind: 'legal', candidateId: 'candidate-a' })
    expect(evaluateAttentionEligibilityVerdict({ candidateId: 'candidate-b', authorityVerdict: { ...authority, kind: 'refused', reason: 'no_legal_revealer' } as const, recipientScope: { kind: 'direct_recipient', recipientId: 'r' }, authorizedRecipientIds: ['r'], unavailableRecipientIds: [] })).toEqual({ kind: 'refused', reason: 'no_legal_revealer' })
  })
})
