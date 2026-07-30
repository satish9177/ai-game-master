import { canonicalSerialize, mintHash } from './canonicalSerialization'

export const ATTENTION_CHANNEL_POLICY_VERSION = 'attention-channel-policy-c3-v1' as const
export type AttentionChannelId = 'extradiegetic-ui-v1' | 'diegetic-direct-communication-v1'
export type AttentionChannelClass = 'extradiegetic' | 'diegetic'
export type AttentionRecipientScopeKind = 'direct_recipient' | 'bounded_audience' | 'public_audience'

export interface AttentionCommunicationChannel {
  readonly channelId: AttentionChannelId
  readonly channelClass: AttentionChannelClass
  readonly channelSemanticVersion: '1.0.0'
  readonly permittedRecipientScopeKinds: readonly AttentionRecipientScopeKind[]
  readonly requiresRevealer: boolean
  readonly requiresValidator: boolean
}

export const ATTENTION_CHANNEL_REGISTRY: readonly AttentionCommunicationChannel[] = Object.freeze([
  Object.freeze({ channelId: 'extradiegetic-ui-v1', channelClass: 'extradiegetic', channelSemanticVersion: '1.0.0', permittedRecipientScopeKinds: Object.freeze([]), requiresRevealer: false, requiresValidator: false }),
  Object.freeze({ channelId: 'diegetic-direct-communication-v1', channelClass: 'diegetic', channelSemanticVersion: '1.0.0', permittedRecipientScopeKinds: Object.freeze(['direct_recipient', 'bounded_audience']), requiresRevealer: true, requiresValidator: true }),
])

export const ATTENTION_CHANNEL_POLICY_HASH = mintHash(canonicalSerialize({ version: ATTENTION_CHANNEL_POLICY_VERSION, channels: ATTENTION_CHANNEL_REGISTRY }))

export interface AttentionDeclaredChannelAvailability {
  readonly channelId: AttentionChannelId
  readonly available: boolean
  readonly validatorIntakeAvailable?: boolean
}

export type AttentionChannelLegalityResult =
  | { readonly kind: 'ok'; readonly channel: AttentionCommunicationChannel }
  | { readonly kind: 'refused'; readonly reason: 'no_legal_channel' }

/** Availability comes only from this declared replay input; no runtime condition is consulted. */
export function resolveAttentionChannelLegality(input: { readonly channelId: AttentionChannelId; readonly declaredAvailability: readonly AttentionDeclaredChannelAvailability[] }): AttentionChannelLegalityResult {
  const channel = ATTENTION_CHANNEL_REGISTRY.find((entry) => entry.channelId === input.channelId)
  const entries = input.declaredAvailability.filter((entry) => entry.channelId === input.channelId)
  if (channel === undefined || entries.length !== 1) return { kind: 'refused', reason: 'no_legal_channel' }
  const availability = entries[0]!
  if (!availability.available || (channel.requiresValidator && availability.validatorIntakeAvailable !== true)) return { kind: 'refused', reason: 'no_legal_channel' }
  return { kind: 'ok', channel }
}
