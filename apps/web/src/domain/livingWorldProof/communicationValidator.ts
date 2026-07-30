import { canonicalSerialize, mintHash } from './canonicalSerialization'
import {
  ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2,
  ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2,
  commitAttentionReplayAuthoritativeCommand,
} from './attentionReplayResources'
import type { AttentionReplayAuthoritativeResources } from './attentionReplayResources'
import { COMMUNICATION_VALIDATOR_CONTRACT_VERSION } from './communicationValidatorContracts'
import type {
  AuthoritativeCommunicationCommand,
  AuthoritativeCommunicationPayload,
  AuthoritativeCommunicationValidationResult,
} from './communicationValidatorContracts'

/** C5's independent authoritative validation: it accepts no attention-domain type. */
export function validateAndCommitAuthoritativeCommunication(input: {
  readonly resources: AttentionReplayAuthoritativeResources
  readonly command: AuthoritativeCommunicationCommand
  readonly authoritativePayloads: readonly AuthoritativeCommunicationPayload[]
}): { readonly result: AuthoritativeCommunicationValidationResult; readonly resources: AttentionReplayAuthoritativeResources } {
  if (input.command.contractVersion !== COMMUNICATION_VALIDATOR_CONTRACT_VERSION
    || input.command.commandId.trim().length === 0 || input.command.communicationKey.trim().length === 0) {
    return { result: { kind: 'refused', reason: 'invalid-communication-command' }, resources: input.resources }
  }
  if (input.command.commitSchemaVersion !== ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2
    || input.command.foldVersion !== ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2) {
    return { result: { kind: 'refused', reason: 'authoritative-log-version-mismatch' }, resources: input.resources }
  }
  const payload = input.authoritativePayloads.find((entry) => entry.communicationKey === input.command.communicationKey)
  if (payload === undefined) return { result: { kind: 'refused', reason: 'unknown-authoritative-communication' }, resources: input.resources }
  if (!payload.available) return { result: { kind: 'refused', reason: 'communication-unavailable' }, resources: input.resources }
  const communicationPayloadDigest = mintHash(canonicalSerialize({
    assertionContent: [...payload.assertionContent], assertionProvenanceDigests: [...payload.assertionProvenanceDigests],
    channelId: payload.channelId, revealerId: payload.revealerId, recipientScope: payload.recipientScope,
    revealScope: payload.revealScope, policyIdentities: [...payload.policyIdentities],
    validatorContractVersion: COMMUNICATION_VALIDATOR_CONTRACT_VERSION,
  }))
  return {
    result: { kind: 'committed', communicationPayloadDigest },
    resources: commitAttentionReplayAuthoritativeCommand(input.resources, input.command.commandId, input.command.wallClockInput, { communicationPayloadDigest }),
  }
}
