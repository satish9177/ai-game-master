/**
 * C6's one transient surface-B hand-off.  This file intentionally depends on
 * no authoritative, cognition, ledger, provider, or runtime module.
 */
export const ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION = 'attention-diegetic-reveal-proposal-v1' as const

export interface AttentionDiegeticRevealProposal {
  readonly schemaVersion: typeof ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION
  readonly candidateId: string
  readonly assertions: readonly string[]
  readonly assertionProvenanceDigests: readonly string[]
  readonly channelId: string
  readonly revealerId: string
  readonly recipientScope: string
  readonly revealScope: string
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
    || !present(input.recipientScope) || !present(input.revealScope)
    || input.assertions.length === 0 || input.policyIdentities.length === 0
    || !input.assertions.every(present) || !input.assertionProvenanceDigests.every(present)
    || !input.policyIdentities.every(present)
  ) return { kind: 'refused', reason: 'invalid-proposal-member' }
  if (input.assertions.length !== input.assertionProvenanceDigests.length) {
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
      assertionProvenanceDigests: frozenStrings(input.assertionProvenanceDigests),
      channelId: input.channelId,
      revealerId: input.revealerId,
      recipientScope: input.recipientScope,
      revealScope: input.revealScope,
      rankingSnapshotLsn: input.rankingSnapshotLsn,
      revalidationSnapshotLsn: input.revalidationSnapshotLsn,
      policyIdentities: frozenStrings(input.policyIdentities),
    }),
  }
}
