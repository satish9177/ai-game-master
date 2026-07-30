import { describe, expect, it } from 'vitest'
import { COMMUNICATION_VALIDATOR_CONTRACT_VERSION } from './communicationValidatorContracts'
import { validateAndCommitAuthoritativeCommunication } from './communicationValidator'
import { createAttentionReplayAuthoritativeResources } from './attentionReplayResources'
import { ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2, ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2 } from './attentionReplayResources'

const recipientScope = Object.freeze({ kind: 'direct_recipient' as const, recipientId: 'b' })
const revealScope = Object.freeze({ approvedAssertionIds: Object.freeze(['aid/a/b']), approvedRecipientScope: recipientScope })
const payload = Object.freeze({ communicationKey: 'public-aid', assertionContent: Object.freeze(['aid/a/b']), assertionProvenance: Object.freeze(['full-provenance-aid']), channelId: 'diegetic-direct-communication-v1', revealerId: 'a', recipientScope, revealScope, policyIdentities: Object.freeze(['channel-c3', 'scope-c4']), available: true })
const command = Object.freeze({ contractVersion: COMMUNICATION_VALIDATOR_CONTRACT_VERSION, commandId: 'ordinary-public-aid', communicationKey: 'public-aid', wallClockInput: 12, commitSchemaVersion: ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2, foldVersion: ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2 })

describe('C5 authoritative communication validator', () => {
  it('independently derives and commits a content-bearing payload through the ordinary resource path', () => {
    const first = validateAndCommitAuthoritativeCommunication({ resources: createAttentionReplayAuthoritativeResources(7), command, authoritativePayloads: [payload] })
    const second = validateAndCommitAuthoritativeCommunication({ resources: createAttentionReplayAuthoritativeResources(7), command, authoritativePayloads: [payload] })
    expect(first.result).toEqual(second.result)
    expect(first.result.kind).toBe('committed')
    expect(first.resources.log.commits[0]?.communicationPayloadDigest).toBe((first.result as { readonly communicationPayloadDigest: string }).communicationPayloadDigest)
    expect(first.resources.log.commits).toHaveLength(1)
  })

  it('rejects unavailable or unknown authoritative communications without consuming a resource or appending a commit', () => {
    const resources = createAttentionReplayAuthoritativeResources(7)
    expect(validateAndCommitAuthoritativeCommunication({ resources, command, authoritativePayloads: [{ ...payload, available: false }] }).result)
      .toEqual({ kind: 'refused', reason: 'communication-unavailable' })
    expect(validateAndCommitAuthoritativeCommunication({ resources, command, authoritativePayloads: [] }).resources).toBe(resources)
  })
})
