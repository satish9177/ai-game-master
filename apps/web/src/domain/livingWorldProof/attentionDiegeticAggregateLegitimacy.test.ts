import { describe, expect, it } from 'vitest'
import { evaluateAttentionDiegeticAggregateLegitimacy } from './attentionDiegeticAggregateLegitimacy'

describe('C3 diegetic check B', () => {
  it('maps absent authority to a typed no-legal-revealer refusal', () => {
    expect(evaluateAttentionDiegeticAggregateLegitimacy({ policyRef: 'communication-legality-c3-v1', candidateId: 'candidate', channelId: 'diegetic-direct-communication-v1', propositionKey: 'c', sourcePropositionKeys: ['a', 'b'], aggregateRuleLicensed: false, authorityViews: [], availabilityEvidence: [], declaredChannelAvailability: [{ channelId: 'diegetic-direct-communication-v1', available: true, validatorIntakeAvailable: true }] })).toEqual({ kind: 'refused', reason: 'no_legal_revealer' })
  })
})
