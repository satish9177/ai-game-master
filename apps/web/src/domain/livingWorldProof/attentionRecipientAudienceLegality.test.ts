import { describe, expect, it } from 'vitest'
import { evaluateAttentionRecipientScope } from './attentionRecipientScope'

describe('C4 recipient/audience legality', () => {
  const input = { channelId: 'diegetic-direct-communication-v1' as const, authorizedRecipientIds: ['a', 'b'], unavailableRecipientIds: [] }
  it('varies recipient scope independently without computing perception', () => {
    expect(evaluateAttentionRecipientScope({ ...input, scope: { kind: 'direct_recipient', recipientId: 'a' } })).toEqual({ kind: 'legal' })
    expect(evaluateAttentionRecipientScope({ ...input, scope: { kind: 'direct_recipient', recipientId: 'c' } })).toEqual({ kind: 'refused', reason: 'no_legal_revealer' })
    expect(evaluateAttentionRecipientScope({ ...input, scope: { kind: 'bounded_audience', recipientIds: ['a', 'b'] } })).toEqual({ kind: 'legal' })
    expect(evaluateAttentionRecipientScope({ ...input, scope: { kind: 'public_audience', publicLocusId: 'square' } })).toEqual({ kind: 'refused', reason: 'no_legal_channel' })
  })
  it('refuses unavailable recipients and malformed/unpermitted audience kinds as no legal channel', () => {
    expect(evaluateAttentionRecipientScope({ ...input, unavailableRecipientIds: ['a'], scope: { kind: 'direct_recipient', recipientId: 'a' } })).toEqual({ kind: 'refused', reason: 'no_legal_channel' })
    expect(evaluateAttentionRecipientScope({ ...input, scope: { kind: 'bounded_audience', recipientIds: ['b', 'a'] } })).toEqual({ kind: 'refused', reason: 'no_legal_channel' })
  })
})
