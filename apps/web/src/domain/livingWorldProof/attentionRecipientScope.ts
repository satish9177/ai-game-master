import { ATTENTION_CHANNEL_REGISTRY } from './attentionChannelRegistry'
import type { AttentionChannelId } from './attentionChannelRegistry'

export type RecipientScope =
  | { readonly kind: 'direct_recipient'; readonly recipientId: string }
  | { readonly kind: 'bounded_audience'; readonly recipientIds: readonly string[] }
  | { readonly kind: 'public_audience'; readonly publicLocusId: string }

export type AttentionRecipientScopeVerdict =
  | { readonly kind: 'legal' }
  | { readonly kind: 'refused'; readonly reason: 'no_legal_channel' | 'no_legal_revealer' }

function present(value: string): boolean { return value.trim().length > 0 }

/** A legality subset check only: it never computes actual perception. */
export function evaluateAttentionRecipientScope(input: {
  readonly channelId: AttentionChannelId
  readonly scope: RecipientScope
  readonly authorizedRecipientIds: readonly string[]
  readonly unavailableRecipientIds: readonly string[]
}): AttentionRecipientScopeVerdict {
  const channel = ATTENTION_CHANNEL_REGISTRY.find((entry) => entry.channelId === input.channelId)
  if (channel === undefined || !channel.permittedRecipientScopeKinds.includes(input.scope.kind)) return { kind: 'refused', reason: 'no_legal_channel' }
  if (input.scope.kind === 'public_audience') return { kind: 'refused', reason: 'no_legal_channel' }
  const recipients = input.scope.kind === 'direct_recipient' ? [input.scope.recipientId] : input.scope.recipientIds
  if (recipients.length === 0 || recipients.some((id) => !present(id) || input.unavailableRecipientIds.includes(id))) return { kind: 'refused', reason: 'no_legal_channel' }
  if (input.scope.kind === 'bounded_audience' && (recipients.length < 2 || new Set(recipients).size !== recipients.length || recipients.some((id, index) => index > 0 && recipients[index - 1]! >= id))) return { kind: 'refused', reason: 'no_legal_channel' }
  if (recipients.some((id) => !input.authorizedRecipientIds.includes(id))) return { kind: 'refused', reason: 'no_legal_revealer' }
  return { kind: 'legal' }
}
