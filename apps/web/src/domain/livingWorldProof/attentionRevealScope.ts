import { canonicalSerialize } from './canonicalSerialization'
import type { RecipientScope } from './attentionRecipientScope'

export interface AttentionRevealScope {
  readonly approvedAssertionIds: readonly string[]
  readonly approvedRecipientScope: RecipientScope
}
export type AttentionRevealScopeRevalidation = 'still-legal' | 'no_legal_channel' | 'reveal_scope_expansion_attempt'

export function createAttentionRevealScope(assertionIds: readonly string[], scope: RecipientScope): AttentionRevealScope | 'reveal_scope_expansion_attempt' {
  if (assertionIds.length === 0 || new Set(assertionIds).size !== assertionIds.length || assertionIds.some((id, index) => id.trim().length === 0 || (index > 0 && assertionIds[index - 1]! >= id))) return 'reveal_scope_expansion_attempt'
  return Object.freeze({ approvedAssertionIds: Object.freeze([...assertionIds]), approvedRecipientScope: Object.freeze(scope) })
}

/** Exact bytes are the approval contract: neither a shrink nor an expansion may render silently. */
export function revalidateAttentionRevealScope(approved: AttentionRevealScope, presented: AttentionRevealScope): AttentionRevealScopeRevalidation {
  const before = canonicalSerialize(approved)
  const after = canonicalSerialize(presented)
  if (before === after) return 'still-legal'
  if (presented.approvedAssertionIds.some((id) => !approved.approvedAssertionIds.includes(id))) return 'reveal_scope_expansion_attempt'
  if (approved.approvedRecipientScope.kind !== presented.approvedRecipientScope.kind) return 'no_legal_channel'
  if (approved.approvedRecipientScope.kind === 'direct_recipient') return 'no_legal_channel'
  const recipientsOf = (scope: AttentionRevealScope['approvedRecipientScope']): readonly string[] => {
    if (scope.kind === 'direct_recipient') return [scope.recipientId]
    return scope.kind === 'bounded_audience' ? scope.recipientIds : []
  }
  const approvedRecipients = recipientsOf(approved.approvedRecipientScope)
  const presentedRecipients = recipientsOf(presented.approvedRecipientScope)
  if (presentedRecipients.some((id) => !approvedRecipients.includes(id))) return 'reveal_scope_expansion_attempt'
  return 'no_legal_channel'
}
