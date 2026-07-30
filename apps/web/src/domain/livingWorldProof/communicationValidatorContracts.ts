import type { AttentionReplayAuthoritativeCommitSchemaVersion, AttentionReplayAuthoritativeLogFoldVersion, AttentionReplayWallClockInput } from './attentionReplayResources'
import type { RecipientScope } from './attentionRecipientScope'
import type { AttentionRevealScope } from './attentionRevealScope'

export const COMMUNICATION_VALIDATOR_CONTRACT_VERSION = 'communication-validator-c5-v1' as const

export interface AuthoritativeCommunicationPayload {
  readonly communicationKey: string
  readonly assertionContent: readonly string[]
  /** Validator-owned complete per-assertion provenance; no attention advisory
   * identity participates in this payload. */
  readonly assertionProvenance: readonly string[]
  readonly channelId: string
  readonly revealerId: string
  readonly recipientScope: RecipientScope
  readonly revealScope: AttentionRevealScope
  readonly policyIdentities: readonly string[]
  readonly available: boolean
}

export interface AuthoritativeCommunicationCommand {
  readonly contractVersion: typeof COMMUNICATION_VALIDATOR_CONTRACT_VERSION
  readonly commandId: string
  readonly communicationKey: string
  readonly wallClockInput: AttentionReplayWallClockInput
  readonly commitSchemaVersion: AttentionReplayAuthoritativeCommitSchemaVersion
  readonly foldVersion: AttentionReplayAuthoritativeLogFoldVersion
}

export type AuthoritativeCommunicationValidationRefusal =
  | 'unsupported-validator-contract'
  | 'unknown-authoritative-communication'
  | 'communication-unavailable'
  | 'invalid-communication-command'
  | 'authoritative-log-version-mismatch'

export type AuthoritativeCommunicationValidationResult =
  | { readonly kind: 'committed'; readonly communicationPayloadDigest: string }
  | { readonly kind: 'refused'; readonly reason: AuthoritativeCommunicationValidationRefusal }
