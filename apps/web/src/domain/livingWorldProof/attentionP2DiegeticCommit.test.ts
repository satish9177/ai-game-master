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

function proposal(candidateId = 'pattern-aid') {
  const result = createAttentionDiegeticRevealProposal({
    schemaVersion: ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION,
    candidateId,
    assertions: payload.assertionContent,
    assertionProvenanceDigests: payload.assertionProvenanceDigests,
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
  it('makes L_on byte-identical to L_ctl under the frozen C5 v2 fold', () => {
    const off = createAttentionReplayAuthoritativeResources(7)
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
    const offFold = foldAttentionReplayAuthoritativeLog(
      { ...off.log, commitSchemaVersion: ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2, foldVersion: ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2 },
      ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2,
    )
    const controlFold = foldAttentionReplayAuthoritativeLog(control.resources.log, ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2)
    const onFold = foldAttentionReplayAuthoritativeLog(on.resources.log, ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2)
    expect(offFold.kind).toBe('ok'); expect(controlFold.kind).toBe('ok'); expect(onFold.kind).toBe('ok')
    if (controlFold.kind !== 'ok' || onFold.kind !== 'ok' || offFold.kind !== 'ok') throw new Error('fold failed')
    expect(onFold.digest).toBe(controlFold.digest)
    expect(onFold.digest).not.toBe(offFold.digest)
  })

  it('refuses a fold mismatch and leaves a rejected proposal byte-identical to the v2 no-commit control', () => {
    const resources = createAttentionReplayAuthoritativeResources(7)
    const refused = deliverAttentionDiegeticReveal({
      resources, proposal: proposal(), authoritativePayloads: [], wallClockInput: 12,
    })
    expect(refused.kind).toBe('refused')
    expect(refused.resources).toBe(resources)
    expect(foldAttentionReplayAuthoritativeLog(
      { ...resources.log, commitSchemaVersion: ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2, foldVersion: ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2 },
      'attention-replay-authoritative-log-fold-v1',
    )).toEqual({ kind: 'refused', reason: 'commit-schema-fold-mismatch' })
  })
})
