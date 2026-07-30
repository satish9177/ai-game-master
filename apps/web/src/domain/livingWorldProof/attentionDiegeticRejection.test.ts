import { describe, expect, it } from 'vitest'
import { createAttentionReplayAuthoritativeResources } from './attentionReplayResources'
import { deliverAttentionDiegeticReveal } from './attentionDiegeticDelivery'
import { ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION, createAttentionDiegeticRevealProposal } from './attentionDiegeticRevealProposal'

describe('C6 diegetic rejection', () => {
  it('rejects an unavailable independently-owned communication without a commit, identifier, or scheduler change', () => {
    const created = createAttentionDiegeticRevealProposal({
      schemaVersion: ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION,
      candidateId: 'pattern-aid',
      assertions: ['aid/a/b'],
      assertionProvenanceDigests: ['provenance-aid'],
      channelId: 'diegetic-direct-communication-v1',
      revealerId: 'a',
      recipientScope: 'direct:b',
      revealScope: 'assertions:aid',
      rankingSnapshotLsn: 10,
      revalidationSnapshotLsn: 12,
      policyIdentities: ['channel-c3', 'scope-c4'],
    })
    if (created.kind !== 'ok') throw new Error('proposal failed')
    const resources = createAttentionReplayAuthoritativeResources(7)
    const delivery = deliverAttentionDiegeticReveal({
      resources,
      proposal: created.proposal,
      authoritativePayloads: [{
        communicationKey: 'public-aid',
        assertionContent: ['aid/a/b'],
        assertionProvenanceDigests: ['provenance-aid'],
        channelId: 'diegetic-direct-communication-v1',
        revealerId: 'a',
        recipientScope: 'direct:b',
        revealScope: 'assertions:aid',
        policyIdentities: ['channel-c3', 'scope-c4'],
        available: false,
      }],
      wallClockInput: 12,
    })
    expect(delivery).toEqual({ kind: 'refused', resources, reason: 'unknown-authoritative-communication' })
    expect(delivery.resources.log.commits).toEqual([])
    expect(delivery.resources.idAllocator).toEqual(resources.idAllocator)
    expect(delivery.resources.scheduler).toEqual(resources.scheduler)
  })
})
