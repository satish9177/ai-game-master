import { describe, expect, it } from 'vitest'
import {
  ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION,
  createAttentionDiegeticRevealProposal,
} from './attentionDiegeticRevealProposal'

const input = {
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
} as const

describe('C6 diegetic reveal proposal', () => {
  it('creates a deeply frozen data-only proposal', () => {
    const result = createAttentionDiegeticRevealProposal(input)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected proposal')
    expect(Object.isFrozen(result.proposal)).toBe(true)
    expect(Object.isFrozen(result.proposal.assertions)).toBe(true)
    expect(Object.keys(result.proposal).sort()).toEqual([
      'assertionProvenanceDigests', 'assertions', 'candidateId', 'channelId',
      'policyIdentities', 'rankingSnapshotLsn', 'recipientScope',
      'revalidationSnapshotLsn', 'revealScope', 'revealerId', 'schemaVersion',
    ])
  })

  it('refuses malformed coordinate and assertion/provenance mismatches', () => {
    expect(createAttentionDiegeticRevealProposal({ ...input, revalidationSnapshotLsn: 9 })).toEqual({
      kind: 'refused', reason: 'invalid-snapshot-coordinate',
    })
    expect(createAttentionDiegeticRevealProposal({ ...input, assertionProvenanceDigests: [] })).toEqual({
      kind: 'refused', reason: 'mismatched-assertion-provenance',
    })
  })
})
