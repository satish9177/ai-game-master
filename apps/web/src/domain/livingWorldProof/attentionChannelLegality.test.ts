import { describe, expect, it } from 'vitest'
import { ATTENTION_CHANNEL_POLICY_HASH, ATTENTION_CHANNEL_POLICY_VERSION, ATTENTION_CHANNEL_REGISTRY, resolveAttentionChannelLegality } from './attentionChannelRegistry'

describe('C3 closed channel registry', () => {
  it('has exactly the two declared channels and a versioned policy hash', () => {
    expect(ATTENTION_CHANNEL_REGISTRY.map((channel) => channel.channelId)).toEqual(['extradiegetic-ui-v1', 'diegetic-direct-communication-v1'])
    expect(ATTENTION_CHANNEL_POLICY_VERSION).toBe('attention-channel-policy-c3-v1')
    expect(ATTENTION_CHANNEL_POLICY_HASH).toMatch(/^fnv1a64-v1:/)
  })

  it('uses declared availability, including validator intake, and never an ambient probe', () => {
    expect(resolveAttentionChannelLegality({ channelId: 'diegetic-direct-communication-v1', declaredAvailability: [{ channelId: 'diegetic-direct-communication-v1', available: true, validatorIntakeAvailable: true }] }).kind).toBe('ok')
    expect(resolveAttentionChannelLegality({ channelId: 'diegetic-direct-communication-v1', declaredAvailability: [{ channelId: 'diegetic-direct-communication-v1', available: true }] })).toEqual({ kind: 'refused', reason: 'no_legal_channel' })
    expect(resolveAttentionChannelLegality({ channelId: 'diegetic-direct-communication-v1', declaredAvailability: [{ channelId: 'diegetic-direct-communication-v1', available: false, validatorIntakeAvailable: true }] })).toEqual({ kind: 'refused', reason: 'no_legal_channel' })
  })
})
