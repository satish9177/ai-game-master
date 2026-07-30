import { describe, expect, it } from 'vitest'
import { createAttentionReplayAuthoritativeResources } from './attentionReplayResources'
import { runAttentionDiegeticDelivery } from './attentionReplay'
import { ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION, createAttentionDiegeticRevealProposal } from './attentionDiegeticRevealProposal'

const payload = Object.freeze({
  communicationKey: 'public-aid',
  assertionContent: Object.freeze(['aid/a/b']),
  assertionProvenanceDigests: Object.freeze(['provenance-aid']),
  channelId: 'diegetic-direct-communication-v1',
  revealerId: 'a',
  recipientScope: 'direct:b',
  revealScope: 'assertions:aid',
  policyIdentities: Object.freeze(['channel-c3', 'scope-c4']),
  available: true,
})

function proposal() {
  const result = createAttentionDiegeticRevealProposal({
    schemaVersion: ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION,
    candidateId: 'pattern-aid',
    assertions: ['aid/a/b'],
    assertionProvenanceDigests: ['provenance-aid'],
    channelId: payload.channelId,
    revealerId: payload.revealerId,
    recipientScope: payload.recipientScope,
    revealScope: payload.revealScope,
    rankingSnapshotLsn: 10,
    revalidationSnapshotLsn: 12,
    policyIdentities: payload.policyIdentities,
  })
  if (result.kind !== 'ok') throw new Error('proposal construction failed')
  return result.proposal
}

describe('C6 diegetic delivery', () => {
  it('uses the validator-owned payload and C5 v2 commit route', () => {
    const result = runAttentionDiegeticDelivery({
      resources: createAttentionReplayAuthoritativeResources(7),
      proposal: proposal(),
      authoritativePayloads: [payload],
      wallClockInput: 12,
    })
    expect(result.kind).toBe('committed')
    expect(result.resources.log.commitSchemaVersion).toBe('attention-replay-authoritative-commit-schema-v2')
    expect(result.resources.log.commits[0]?.communicationPayloadDigest).toBeDefined()
  })

  it('refuses without a commit when independent reconstruction finds no payload', () => {
    const resources = createAttentionReplayAuthoritativeResources(7)
    const result = runAttentionDiegeticDelivery({
      resources, proposal: proposal(), authoritativePayloads: [], wallClockInput: 12,
    })
    expect(result).toEqual({ kind: 'refused', resources, reason: 'unknown-authoritative-communication' })
  })
})
