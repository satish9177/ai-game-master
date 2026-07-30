import {
  ATTENTION_CHANNEL_POLICY_HASH,
  ATTENTION_CHANNEL_POLICY_VERSION,
  resolveAttentionChannelLegality,
} from './attentionChannelRegistry'
import type { AttentionChannelId, AttentionDeclaredChannelAvailability } from './attentionChannelRegistry'
import type { AttentionReadableCommunicationAuthorityView } from './attentionCommunicationAuthorityContracts'
import { isAttentionReadableCommunicationAuthorityViewFromAccessor } from './attentionCommunicationAuthorityAccessor'
import type { AttentionReadablePatternEvidenceView } from './attentionPatternEvidenceContracts'
import { isAttentionReadablePatternEvidenceViewFromAccessor } from './attentionPatternEvidenceAccessor'

export type CommunicationLegalityPolicyRef = 'communication-legality-disabled-v0' | 'communication-legality-c3-v1'
export const ATTENTION_COMMUNICATION_LEGALITY_POLICY_VERSION = 'communication-legality-c4-v1' as const
export const ATTENTION_COMMUNICATION_LEGALITY_POLICY_HASH = 'communication-legality-c4-v1:declared-individual-speaker-policy-and-recipient-scope' as const
export const ATTENTION_REVEALER_ORDER_VERSION = 'attention-revealer-order-c3-v1' as const

export interface AttentionRevealerAuthorityRequest {
  readonly policyRef: CommunicationLegalityPolicyRef
  readonly candidateId: string
  readonly channelId: AttentionChannelId
  readonly propositionKey: string
  readonly sourcePropositionKeys: readonly string[]
  readonly aggregateRuleLicensed: boolean
  /** Route 1: a recorded public communication of this exact conclusion. */
  readonly authoritativeCommunicationGroundingRecordId?: string
  readonly authorityViews: readonly AttentionReadableCommunicationAuthorityView[]
  readonly availabilityEvidence: readonly AttentionReadablePatternEvidenceView[]
  readonly declaredChannelAvailability: readonly AttentionDeclaredChannelAvailability[]
}

export type AttentionRevealerAuthorityVerdict =
  | {
      readonly kind: 'legal'
      readonly channelId: AttentionChannelId
      readonly revealerId: string
      readonly authorityKind: 'declassified_knowledge' | 'public_knowledge' | 'communication_authority'
      readonly route: 'authoritatively-communicated' | 'authoritatively-knows' | 'rule-licensed-combination'
      readonly policyVersion: typeof ATTENTION_COMMUNICATION_LEGALITY_POLICY_VERSION
      readonly policyHash: typeof ATTENTION_COMMUNICATION_LEGALITY_POLICY_HASH
      readonly channelPolicyVersion: typeof ATTENTION_CHANNEL_POLICY_VERSION
      readonly channelPolicyHash: typeof ATTENTION_CHANNEL_POLICY_HASH
    }
  | {
      readonly kind: 'refused'
      readonly reason: 'no_legal_channel' | 'no_legal_revealer'
      readonly policyVersion: typeof ATTENTION_COMMUNICATION_LEGALITY_POLICY_VERSION
      readonly policyHash: typeof ATTENTION_COMMUNICATION_LEGALITY_POLICY_HASH
      readonly channelPolicyVersion: typeof ATTENTION_CHANNEL_POLICY_VERSION
      readonly channelPolicyHash: typeof ATTENTION_CHANNEL_POLICY_HASH
    }
  | { readonly kind: 'bypassed' }

function unavailable(entityId: string, evidence: readonly AttentionReadablePatternEvidenceView[]): boolean {
  return evidence.some((view) => isAttentionReadablePatternEvidenceViewFromAccessor(view)
    && view.recordKind === 'world_observable_availability' && view.entityId === entityId)
}

function compare(left: AttentionReadableCommunicationAuthorityView, right: AttentionReadableCommunicationAuthorityView): number {
  const rank = { declassified_knowledge: 0, public_knowledge: 1, communication_authority: 2 } as const
  if (rank[left.authorityKind] !== rank[right.authorityKind]) return rank[left.authorityKind] - rank[right.authorityKind]
  if (left.commitLsn !== right.commitLsn) return left.commitLsn - right.commitLsn
  return left.entityId < right.entityId ? -1 : left.entityId > right.entityId ? 1 : 0
}

function hasCommunicationAuthority(entityId: string, channelId: AttentionChannelId, views: readonly AttentionReadableCommunicationAuthorityView[]): boolean {
  return views.some((view) => view.authorityKind === 'communication_authority' && view.entityId === entityId && view.authorityScopeKey === channelId)
}

/**
 * C3's (candidate, channel, revealer) verdict. It reads only accessor-minted
 * authority/availability views and declared availability: never Belief, time,
 * relationship state, source trust, or unobserved truth.
 */
export function evaluateAttentionRevealerLegality(input: AttentionRevealerAuthorityRequest): AttentionRevealerAuthorityVerdict {
  if (input.policyRef === 'communication-legality-disabled-v0') return { kind: 'bypassed' }
  const common = { policyVersion: ATTENTION_COMMUNICATION_LEGALITY_POLICY_VERSION, policyHash: ATTENTION_COMMUNICATION_LEGALITY_POLICY_HASH, channelPolicyVersion: ATTENTION_CHANNEL_POLICY_VERSION, channelPolicyHash: ATTENTION_CHANNEL_POLICY_HASH } as const
  if (input.policyRef !== 'communication-legality-c3-v1' || input.authorityViews.some((view) => !isAttentionReadableCommunicationAuthorityViewFromAccessor(view)) || input.availabilityEvidence.some((view) => !isAttentionReadablePatternEvidenceViewFromAccessor(view))) return { kind: 'refused', reason: 'no_legal_revealer', ...common }
  const channel = resolveAttentionChannelLegality({ channelId: input.channelId, declaredAvailability: input.declaredChannelAvailability })
  if (channel.kind !== 'ok') return { kind: 'refused', reason: 'no_legal_channel', ...common }
  if (!channel.channel.requiresRevealer) return { kind: 'refused', reason: 'no_legal_revealer', ...common }
  const views = [...input.authorityViews].sort(compare)
  for (const view of views) {
    if (unavailable(view.entityId, input.availabilityEvidence)) continue
    const speaking = hasCommunicationAuthority(view.entityId, input.channelId, views)
      || view.authorityKind === 'public_knowledge' || view.authorityKind === 'declassified_knowledge'
    if (!speaking) continue
    if ((view.authorityKind === 'public_knowledge' || view.authorityKind === 'declassified_knowledge') && view.propositionKey === input.propositionKey) {
      const route = view.authorityKind === 'public_knowledge' && input.authoritativeCommunicationGroundingRecordId === view.groundingRecordId
        ? 'authoritatively-communicated' as const : 'authoritatively-knows' as const
      return { kind: 'legal', channelId: input.channelId, revealerId: view.entityId, authorityKind: view.authorityKind, route, ...common }
    }
    if (input.aggregateRuleLicensed && input.sourcePropositionKeys.length > 0 && view.authorityKind !== 'communication_authority'
      && input.sourcePropositionKeys.every((key) => views.some((candidate) => candidate.entityId === view.entityId && (candidate.authorityKind === 'public_knowledge' || candidate.authorityKind === 'declassified_knowledge') && candidate.propositionKey === key))) {
      return { kind: 'legal', channelId: input.channelId, revealerId: view.entityId, authorityKind: view.authorityKind, route: 'rule-licensed-combination', ...common }
    }
  }
  return { kind: 'refused', reason: 'no_legal_revealer', ...common }
}
