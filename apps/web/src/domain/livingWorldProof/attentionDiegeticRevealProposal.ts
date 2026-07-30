/**
 * C6's one transient surface-B hand-off.  This file intentionally depends on
 * no authoritative, cognition, ledger, provider, or runtime module.
 */
export const ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION = 'attention-diegetic-reveal-proposal-v1' as const

export interface AttentionDiegeticRevealProposal {
  readonly schemaVersion: typeof ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION
  readonly candidateId: string
  readonly assertions: readonly string[]
  /** Full canonical per-assertion provenance, retained for authoritative
   * validation. These are not summary digests. */
  readonly assertionProvenance: readonly string[]
  readonly channelId: string
  readonly revealerId: string
  readonly recipientScope: RecipientScope
  readonly revealScope: AttentionRevealScope
  readonly rankingSnapshotLsn: number
  readonly revalidationSnapshotLsn: number
  readonly policyIdentities: readonly string[]
}

export type AttentionDiegeticRevealProposalRefusal =
  | 'unsupported-proposal-schema'
  | 'invalid-proposal-member'
  | 'mismatched-assertion-provenance'
  | 'invalid-snapshot-coordinate'

export type AttentionDiegeticRevealProposalResult =
  | { readonly kind: 'ok'; readonly proposal: AttentionDiegeticRevealProposal }
  | { readonly kind: 'refused'; readonly reason: AttentionDiegeticRevealProposalRefusal }

function present(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function frozenStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values])
}

function freezeRecipientScope(scope: RecipientScope): RecipientScope {
  return scope.kind === 'direct_recipient'
    ? Object.freeze({ kind: scope.kind, recipientId: scope.recipientId })
    : scope.kind === 'bounded_audience'
      ? Object.freeze({ kind: scope.kind, recipientIds: frozenStrings(scope.recipientIds) })
      : Object.freeze({ kind: scope.kind, publicLocusId: scope.publicLocusId })
}

function freezeRevealScope(scope: AttentionRevealScope): AttentionRevealScope {
  return Object.freeze({
    approvedAssertionIds: frozenStrings(scope.approvedAssertionIds),
    approvedRecipientScope: freezeRecipientScope(scope.approvedRecipientScope),
  })
}

function isRecipientScope(scope: RecipientScope): boolean {
  if (scope.kind === 'direct_recipient') return present(scope.recipientId)
  if (scope.kind === 'bounded_audience') {
    return scope.recipientIds.length >= 2
      && scope.recipientIds.every(present)
      && new Set(scope.recipientIds).size === scope.recipientIds.length
      && scope.recipientIds.every((id, index) => index === 0 || scope.recipientIds[index - 1]! < id)
  }
  return scope.kind === 'public_audience' && present(scope.publicLocusId)
}

function isRevealScope(scope: AttentionRevealScope): boolean {
  return scope.approvedAssertionIds.length > 0
    && scope.approvedAssertionIds.every(present)
    && new Set(scope.approvedAssertionIds).size === scope.approvedAssertionIds.length
    && scope.approvedAssertionIds.every((id, index) => index === 0 || scope.approvedAssertionIds[index - 1]! < id)
    && isRecipientScope(scope.approvedRecipientScope)
}

/**
 * Builds an immutable, data-only proposal.  There is deliberately no command,
 * resource, callback, capability, diagnostic, or mutable state member.
 */
export function createAttentionDiegeticRevealProposal(
  input: AttentionDiegeticRevealProposal,
): AttentionDiegeticRevealProposalResult {
  if (input.schemaVersion !== ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION) {
    return { kind: 'refused', reason: 'unsupported-proposal-schema' }
  }
  if (
    !present(input.candidateId) || !present(input.channelId) || !present(input.revealerId)
    || !isRecipientScope(input.recipientScope) || !isRevealScope(input.revealScope)
    || input.assertions.length === 0 || input.policyIdentities.length === 0
    || !input.assertions.every(present) || !input.assertionProvenance.every(present)
    || !input.policyIdentities.every(present)
  ) return { kind: 'refused', reason: 'invalid-proposal-member' }
  if (input.assertions.length !== input.assertionProvenance.length) {
    return { kind: 'refused', reason: 'mismatched-assertion-provenance' }
  }
  if (!Number.isInteger(input.rankingSnapshotLsn) || !Number.isInteger(input.revalidationSnapshotLsn)
    || input.rankingSnapshotLsn < 0 || input.revalidationSnapshotLsn < input.rankingSnapshotLsn) {
    return { kind: 'refused', reason: 'invalid-snapshot-coordinate' }
  }
  return {
    kind: 'ok',
    proposal: Object.freeze({
      schemaVersion: ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION,
      candidateId: input.candidateId,
      assertions: frozenStrings(input.assertions),
      assertionProvenance: frozenStrings(input.assertionProvenance),
      channelId: input.channelId,
      revealerId: input.revealerId,
      recipientScope: freezeRecipientScope(input.recipientScope),
      revealScope: freezeRevealScope(input.revealScope),
      rankingSnapshotLsn: input.rankingSnapshotLsn,
      revalidationSnapshotLsn: input.revalidationSnapshotLsn,
      policyIdentities: frozenStrings(input.policyIdentities),
    }),
  }
}
import type { RecipientScope } from './attentionRecipientScope'
import type { AttentionRevealScope } from './attentionRevealScope'
