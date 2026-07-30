import { ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2, ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2 } from './attentionReplayResources'
import type { AttentionReplayAuthoritativeResources, AttentionReplayWallClockInput } from './attentionReplayResources'
import { validateAndCommitAttentionDiegeticRevealProposal } from './communicationValidator'
import type { AuthoritativeCommunicationPayload } from './communicationValidatorContracts'
import type { AttentionDiegeticRevealProposal } from './attentionDiegeticRevealProposal'

export type AttentionDiegeticDeliveryResult =
  | { readonly kind: 'committed'; readonly resources: AttentionReplayAuthoritativeResources; readonly communicationPayloadDigest: string }
  | { readonly kind: 'refused'; readonly resources: AttentionReplayAuthoritativeResources; readonly reason: string }

/**
 * The only C6 delivery route.  It has no direct commit call: the validator
 * remains the sole authoritative writer and retains its C5 fold contract.
 */
export function deliverAttentionDiegeticReveal(input: {
  readonly resources: AttentionReplayAuthoritativeResources
  readonly proposal: AttentionDiegeticRevealProposal
  readonly authoritativePayloads: readonly AuthoritativeCommunicationPayload[]
  readonly wallClockInput: AttentionReplayWallClockInput
}): AttentionDiegeticDeliveryResult {
  const validated = validateAndCommitAttentionDiegeticRevealProposal({
    resources: input.resources,
    proposal: input.proposal,
    authoritativePayloads: input.authoritativePayloads,
    wallClockInput: input.wallClockInput,
    commitSchemaVersion: ATTENTION_REPLAY_AUTHORITATIVE_COMMIT_SCHEMA_V2,
    foldVersion: ATTENTION_REPLAY_AUTHORITATIVE_LOG_FOLD_V2,
  })
  return validated.result.kind === 'committed'
    ? { kind: 'committed', resources: validated.resources, communicationPayloadDigest: validated.result.communicationPayloadDigest }
    : { kind: 'refused', resources: validated.resources, reason: validated.result.reason }
}
