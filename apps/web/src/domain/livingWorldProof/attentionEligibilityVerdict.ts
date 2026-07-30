import { evaluateAttentionRecipientScope } from './attentionRecipientScope'
import type { RecipientScope } from './attentionRecipientScope'
import type { AttentionRevealerAuthorityVerdict } from './attentionRevealerLegality'

export type AttentionEligibilityVerdict =
  | { readonly kind: 'legal'; readonly candidateId: string; readonly channelId: string; readonly revealerId: string; readonly recipientScope: RecipientScope }
  | { readonly kind: 'refused'; readonly reason: 'no_legal_channel' | 'no_legal_revealer' }

/** C4's complete five-tuple verdict, composed once from C3 rather than recomputed. */
export function evaluateAttentionEligibilityVerdict(input: { readonly candidateId: string; readonly authorityVerdict: AttentionRevealerAuthorityVerdict; readonly recipientScope: RecipientScope; readonly authorizedRecipientIds: readonly string[]; readonly unavailableRecipientIds: readonly string[] }): AttentionEligibilityVerdict {
  if (input.authorityVerdict.kind === 'bypassed') return { kind: 'refused', reason: 'no_legal_revealer' }
  if (input.authorityVerdict.kind === 'refused') return { kind: 'refused', reason: input.authorityVerdict.reason }
  const scope = evaluateAttentionRecipientScope({ channelId: input.authorityVerdict.channelId, scope: input.recipientScope, authorizedRecipientIds: input.authorizedRecipientIds, unavailableRecipientIds: input.unavailableRecipientIds })
  return scope.kind === 'legal' ? { kind: 'legal', candidateId: input.candidateId, channelId: input.authorityVerdict.channelId, revealerId: input.authorityVerdict.revealerId, recipientScope: input.recipientScope } : scope
}
