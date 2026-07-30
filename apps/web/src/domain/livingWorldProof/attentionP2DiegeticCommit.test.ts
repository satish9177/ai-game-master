import { describe, expect, it } from 'vitest'
import {
  ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2,
  ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2,
  createAttentionReplayAuthoritativeResources,
  foldAttentionReplayAuthoritativeLog,
} from './attentionReplayResources'
import { COMMUNICATION_VALIDATOR_CONTRACT_VERSION } from './communicationValidatorContracts'
import { validateAndCommitAuthoritativeCommunication } from './communicationValidator'
import { deliverAttentionDiegeticReveal } from './attentionDiegeticDelivery'
import { ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION, createAttentionDiegeticRevealProposal } from './attentionDiegeticRevealProposal'
import { canonicalSerialize } from './canonicalSerialization'

const recipientScope = Object.freeze({ kind: 'direct_recipient' as const, recipientId: 'b' })
const revealScope = Object.freeze({ approvedAssertionIds: Object.freeze(['aid/a/b']), approvedRecipientScope: recipientScope })

const payload = Object.freeze({
  communicationKey: 'public-aid',
  assertionContent: Object.freeze(['aid/a/b']),
  assertionProvenance: Object.freeze(['full-provenance-aid']),
  channelId: 'diegetic-direct-communication-v1',
  revealerId: 'a',
  recipientScope,
  revealScope,
  policyIdentities: Object.freeze(['channel-c3', 'scope-c4']),
  available: true,
})

function proposal(candidateId = 'pattern-aid') {
  const result = createAttentionDiegeticRevealProposal({
    schemaVersion: ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION,
    candidateId,
    assertions: payload.assertionContent,
    assertionProvenance: payload.assertionProvenance,
    channelId: payload.channelId,
    revealerId: payload.revealerId,
    recipientScope: payload.recipientScope,
    revealScope: payload.revealScope,
    rankingSnapshotLsn: 10,
    revalidationSnapshotLsn: 12,
    policyIdentities: payload.policyIdentities,
  })
  if (result.kind !== 'ok') throw new Error('proposal failed')
  return result.proposal
}

describe('C6 P2-B diegetic commit', () => {
  it('P2-B records equal identities before digest comparison and proves the exact v2 authoritative delta', () => {
    const off = createAttentionReplayAuthoritativeResources(7)
    const offV2 = Object.freeze({ ...off, log: Object.freeze({ ...off.log, commitSchemaVersion: ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2, foldVersion: ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2 }) })
    const control = validateAndCommitAuthoritativeCommunication({
      resources: createAttentionReplayAuthoritativeResources(7),
      authoritativePayloads: [payload],
      command: {
        contractVersion: COMMUNICATION_VALIDATOR_CONTRACT_VERSION,
        commandId: payload.communicationKey,
        communicationKey: payload.communicationKey,
        wallClockInput: 12,
        commitSchemaVersion: ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2,
        foldVersion: ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2,
      },
    })
    const on = deliverAttentionDiegeticReveal({
      resources: createAttentionReplayAuthoritativeResources(7),
      proposal: proposal(),
      authoritativePayloads: [payload],
      wallClockInput: 12,
    })
    expect(control.result.kind).toBe('committed')
    expect(on.kind).toBe('committed')
    const offFold = foldAttentionReplayAuthoritativeLog(offV2.log, ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2)
    const controlFold = foldAttentionReplayAuthoritativeLog(control.resources.log, ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2)
    const onFold = foldAttentionReplayAuthoritativeLog(on.resources.log, ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2)
    expect(offFold.kind).toBe('ok'); expect(controlFold.kind).toBe('ok'); expect(onFold.kind).toBe('ok')
    if (controlFold.kind !== 'ok' || onFold.kind !== 'ok' || offFold.kind !== 'ok') throw new Error('fold failed')
    const identities = (resources: typeof offV2) => Object.freeze({
      commitSchemaVersion: resources.log.commitSchemaVersion,
      foldVersion: resources.log.foldVersion,
      validatorPolicyVersion: COMMUNICATION_VALIDATOR_CONTRACT_VERSION,
    })
    expect(identities(offV2)).toEqual(identities(control.resources))
    expect(identities(offV2)).toEqual(identities(on.resources))
    expect(onFold.digest).toBe(controlFold.digest)
    expect(onFold.digest).not.toBe(offFold.digest)
    expect(control.resources.log.commits.length - offV2.log.commits.length).toBe(1)
    expect(on.resources.log.commits.length - offV2.log.commits.length).toBe(1)
    expect(control.resources.log.commits.map((commit) => commit.commandId)).toEqual([payload.communicationKey])
    expect(on.resources.log.commits.map((commit) => commit.commandId)).toEqual([payload.communicationKey])
    expect(on.resources.log.commits[0]?.communicationPayloadDigest).toBe(on.communicationPayloadDigest)
  })

  it('P2-N6/P2-N7 rejects invalid or unavailable delivery without a commit or resource mutation', () => {
    const resources = Object.freeze({ ...createAttentionReplayAuthoritativeResources(7), log: Object.freeze({ commits: Object.freeze([]), commitSchemaVersion: ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2, foldVersion: ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2 }) })
    const refused = deliverAttentionDiegeticReveal({
      resources, proposal: proposal(), authoritativePayloads: [], wallClockInput: 12,
    })
    expect(refused.kind).toBe('refused')
    expect(canonicalSerialize(refused.resources)).toBe(canonicalSerialize(resources))
    const unavailable = deliverAttentionDiegeticReveal({ resources, proposal: proposal(), authoritativePayloads: [{ ...payload, available: false }], wallClockInput: 12 })
    expect(unavailable.kind).toBe('refused')
    expect(canonicalSerialize(unavailable.resources)).toBe(canonicalSerialize(resources))
  })

  it('P2-N8/P2-N9 treats advisory candidate identity as non-authoritative and rejects ambiguous authoritative payloads', () => {
    const advisoryOnly = deliverAttentionDiegeticReveal({
      resources: createAttentionReplayAuthoritativeResources(7), proposal: proposal('advisory-only-mutation'), authoritativePayloads: [payload], wallClockInput: 12,
    })
    const baseline = deliverAttentionDiegeticReveal({
      resources: createAttentionReplayAuthoritativeResources(7), proposal: proposal(), authoritativePayloads: [payload], wallClockInput: 12,
    })
    expect(advisoryOnly.kind).toBe('committed'); expect(baseline.kind).toBe('committed')
    if (advisoryOnly.kind !== 'committed' || baseline.kind !== 'committed') throw new Error('expected commits')
    expect(advisoryOnly.communicationPayloadDigest).toBe(baseline.communicationPayloadDigest)
    const ambiguous = deliverAttentionDiegeticReveal({
      resources: createAttentionReplayAuthoritativeResources(7), proposal: proposal(), authoritativePayloads: [payload, { ...payload, communicationKey: 'duplicate' }], wallClockInput: 12,
    })
    expect(ambiguous).toMatchObject({ kind: 'refused', reason: 'invalid-communication-command' })
    expect(ambiguous.resources.log.commits).toEqual([])
  })

  it('P2-PC1 preserves the validator-owned command sequence and communication digest through the single authoritative route', () => {
    const resources = createAttentionReplayAuthoritativeResources(7)
    const delivered = deliverAttentionDiegeticReveal({ resources, proposal: proposal(), authoritativePayloads: [payload], wallClockInput: 12 })
    expect(delivered.kind).toBe('committed')
    if (delivered.kind !== 'committed') throw new Error('expected commit')
    expect(delivered.resources.log.commits).toEqual([expect.objectContaining({ commandId: payload.communicationKey, communicationPayloadDigest: delivered.communicationPayloadDigest })])
    expect(foldAttentionReplayAuthoritativeLog(
      { ...resources.log, commitSchemaVersion: ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2, foldVersion: ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2 },
      'attention-replay-authoritative-log-fold-v1',
    )).toEqual({ kind: 'refused', reason: 'commit-schema-fold-mismatch' })
  })
})
