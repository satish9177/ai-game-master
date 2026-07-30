import type { AttentionDirectEvidenceAssertion } from './attentionDirectEvidenceAssertion'
import {
  ATTENTION_INFERENCE_PROVENANCE_POLICY,
} from './attentionInferenceProvenancePolicy'
import type { AttentionInferenceProvenancePolicy } from './attentionInferenceProvenancePolicy'
import {
  PUBLIC_AID_LINK_EXTENSION_V1,
  RECIPROCAL_PUBLIC_EXCHANGE_V1,
} from './attentionInferenceRuleLibrary'
import type { AttentionInferenceRuleId } from './attentionInferenceRuleLibrary'
import {
  mintAttentionAggregateAssertionId,
  validateAttentionInferenceProvenance,
} from './attentionInferenceProvenance'
import type {
  AttentionInferenceAggregateSource,
  AttentionInferenceProvenance,
  AttentionInferenceProvenanceRefusal,
  AttentionPositiveRecordProvenance,
} from './attentionInferenceProvenance'

export type AggregateLegitimacyPolicyRef = 'aggregate-legitimacy-disabled-v0' | 'aggregate-legitimacy-c1-v1'

export interface AttentionAggregateAssertion {
  readonly assertionKind: 'aggregate'
  readonly assertionId: string
  readonly ruleId: AttentionInferenceRuleId
  readonly ruleSemanticVersion: string
  readonly ruleContentHash: string
  readonly token: 'public aid was exchanged' | 'recorded public aid linked'
  readonly participants: readonly string[]
  readonly provenance: AttentionInferenceProvenance
}

export type AttentionAggregateSource = AttentionDirectEvidenceAssertion | AttentionAggregateAssertion

export type AttentionAggregateLegitimacyRefusal = 'aggregate_assertion_not_legal' | 'provenance_missing'

export type AttentionAggregateLegitimacyResult =
  | { readonly kind: 'bypassed' }
  | { readonly kind: 'ok'; readonly aggregate: AttentionAggregateAssertion }
  | {
      readonly kind: 'refused'
      readonly reason: AttentionAggregateLegitimacyRefusal
      readonly internalReason?: AttentionInferenceProvenanceRefusal
    }

function isPublicAid(value: AttentionAggregateSource): value is Extract<AttentionDirectEvidenceAssertion, { readonly assertionKind: 'public_aid' }> {
  return value.assertionKind === 'public_aid'
}

function isAggregate(value: AttentionAggregateSource): value is AttentionAggregateAssertion {
  return value.assertionKind === 'aggregate'
}

function positive(source: Extract<AttentionDirectEvidenceAssertion, { readonly assertionKind: 'public_aid' }>): AttentionPositiveRecordProvenance {
  return Object.freeze({ kind: 'positive_record', assertionId: source.assertionId, sourceRecordId: source.sourceRecordId })
}

function directOrder(
  sources: readonly Extract<AttentionDirectEvidenceAssertion, { readonly assertionKind: 'public_aid' }>[],
): readonly Extract<AttentionDirectEvidenceAssertion, { readonly assertionKind: 'public_aid' }>[] {
  return Object.freeze([...sources].sort((left, right) => {
    const leftKey = `${left.sourceRecordId}\u0000${left.assertionId}`
    const rightKey = `${right.sourceRecordId}\u0000${right.assertionId}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  }))
}

function allLeafIdentities(provenance: AttentionInferenceProvenance): readonly AttentionPositiveRecordProvenance[] {
  const leaves: AttentionPositiveRecordProvenance[] = []
  const visit = (current: AttentionInferenceProvenance): void => {
    for (const source of current.sources) {
      if (source.kind === 'positive_record') leaves.push(source)
      else visit(source.provenance)
    }
  }
  visit(provenance)
  return leaves
}

function completed(
  aggregate: AttentionAggregateAssertion,
  policy: AttentionInferenceProvenancePolicy,
): AttentionAggregateLegitimacyResult {
  const checked = validateAttentionInferenceProvenance(aggregate.provenance, policy)
  if (checked.kind === 'refused') {
    return { kind: 'refused', reason: 'provenance_missing', internalReason: checked.reason }
  }
  return { kind: 'ok', aggregate }
}

function reciprocal(
  sources: readonly AttentionAggregateSource[],
  policy: AttentionInferenceProvenancePolicy,
): AttentionAggregateLegitimacyResult {
  const directSources = sources.filter(isPublicAid)
  if (sources.length !== 2 || directSources.length !== 2) return { kind: 'refused', reason: 'aggregate_assertion_not_legal' }
  const first = directSources[0]
  const second = directSources[1]
  if (first === undefined || second === undefined) return { kind: 'refused', reason: 'aggregate_assertion_not_legal' }
  if (
    first.sourceRecordId === second.sourceRecordId
    || first.assertionId === second.assertionId
    || first.actorId !== second.targetId
    || first.targetId !== second.actorId
  ) return { kind: 'refused', reason: 'aggregate_assertion_not_legal' }
  const participants = Object.freeze([first.actorId, first.targetId].sort())
  const ordered = directOrder([first, second])
  const assertionId = mintAttentionAggregateAssertionId({
    participants,
    ruleContentHash: RECIPROCAL_PUBLIC_EXCHANGE_V1.contentHash,
    ruleId: RECIPROCAL_PUBLIC_EXCHANGE_V1.ruleId,
    ruleSemanticVersion: RECIPROCAL_PUBLIC_EXCHANGE_V1.semanticVersion,
    sources: ordered.map((source) => ({ assertionId: source.assertionId, sourceRecordId: source.sourceRecordId })),
    token: 'public aid was exchanged',
  })
  const provenance: AttentionInferenceProvenance = Object.freeze({
    assertionId,
    kind: 'inference',
    participants,
    ruleContentHash: RECIPROCAL_PUBLIC_EXCHANGE_V1.contentHash,
    ruleId: RECIPROCAL_PUBLIC_EXCHANGE_V1.ruleId,
    ruleSemanticVersion: RECIPROCAL_PUBLIC_EXCHANGE_V1.semanticVersion,
    sources: Object.freeze(ordered.map(positive)),
    token: 'public aid was exchanged',
  })
  return completed(Object.freeze({
    assertionKind: 'aggregate', assertionId, participants, provenance,
    ruleContentHash: RECIPROCAL_PUBLIC_EXCHANGE_V1.contentHash,
    ruleId: RECIPROCAL_PUBLIC_EXCHANGE_V1.ruleId,
    ruleSemanticVersion: RECIPROCAL_PUBLIC_EXCHANGE_V1.semanticVersion,
    token: 'public aid was exchanged',
  }), policy)
}

function extension(
  sources: readonly AttentionAggregateSource[],
  policy: AttentionInferenceProvenancePolicy,
): AttentionAggregateLegitimacyResult {
  if (sources.length !== 2) return { kind: 'refused', reason: 'aggregate_assertion_not_legal' }
  const aggregate = sources.find(isAggregate)
  const direct = sources.find(isPublicAid)
  if (aggregate === undefined || direct === undefined) return { kind: 'refused', reason: 'aggregate_assertion_not_legal' }
  const nested = validateAttentionInferenceProvenance(aggregate.provenance, policy)
  if (nested.kind === 'refused' || aggregate.provenance.assertionId !== aggregate.assertionId) {
    return { kind: 'refused', reason: 'provenance_missing', internalReason: nested.kind === 'refused' ? nested.reason : 'provenance_incomplete' }
  }
  const shared = [direct.actorId, direct.targetId].filter((id) => aggregate.participants.includes(id))
  const newEndpoints = [direct.actorId, direct.targetId].filter((id) => !aggregate.participants.includes(id))
  const newEndpoint = newEndpoints[0]
  const leaves = allLeafIdentities(aggregate.provenance)
  if (
    shared.length !== 1
    || newEndpoints.length !== 1
    || newEndpoint === undefined
    || leaves.some((leaf) => leaf.sourceRecordId === direct.sourceRecordId || leaf.assertionId === direct.assertionId)
  ) return { kind: 'refused', reason: 'aggregate_assertion_not_legal' }
  const participants = Object.freeze([...new Set([...aggregate.participants, newEndpoint])].sort())
  const assertionId = mintAttentionAggregateAssertionId({
    aggregateAssertionId: aggregate.assertionId,
    aggregateProvenance: nested.value.canonicalBytes,
    directAssertionId: direct.assertionId,
    directSourceRecordId: direct.sourceRecordId,
    participants,
    ruleContentHash: PUBLIC_AID_LINK_EXTENSION_V1.contentHash,
    ruleId: PUBLIC_AID_LINK_EXTENSION_V1.ruleId,
    ruleSemanticVersion: PUBLIC_AID_LINK_EXTENSION_V1.semanticVersion,
    token: 'recorded public aid linked',
  })
  const aggregateSource: AttentionInferenceAggregateSource = Object.freeze({
    assertionId: aggregate.assertionId,
    kind: 'aggregate',
    provenance: aggregate.provenance,
  })
  const provenance: AttentionInferenceProvenance = Object.freeze({
    assertionId,
    kind: 'inference',
    participants,
    ruleContentHash: PUBLIC_AID_LINK_EXTENSION_V1.contentHash,
    ruleId: PUBLIC_AID_LINK_EXTENSION_V1.ruleId,
    ruleSemanticVersion: PUBLIC_AID_LINK_EXTENSION_V1.semanticVersion,
    sources: Object.freeze([aggregateSource, positive(direct)]),
    token: 'recorded public aid linked',
  })
  return completed(Object.freeze({
    assertionKind: 'aggregate', assertionId, participants, provenance,
    ruleContentHash: PUBLIC_AID_LINK_EXTENSION_V1.contentHash,
    ruleId: PUBLIC_AID_LINK_EXTENSION_V1.ruleId,
    ruleSemanticVersion: PUBLIC_AID_LINK_EXTENSION_V1.semanticVersion,
    token: 'recorded public aid linked',
  }), policy)
}

export function evaluateAttentionAggregateLegitimacy(input: {
  readonly policyRef: AggregateLegitimacyPolicyRef
  readonly sourceKind: 'quest_candidate' | 'narrative_pattern_instance'
  readonly sources: readonly AttentionAggregateSource[]
  readonly ruleId?: AttentionInferenceRuleId
  readonly provenancePolicy?: AttentionInferenceProvenancePolicy
}): AttentionAggregateLegitimacyResult {
  if (input.sourceKind === 'quest_candidate' || input.policyRef === 'aggregate-legitimacy-disabled-v0') {
    return { kind: 'bypassed' }
  }
  if (input.policyRef !== 'aggregate-legitimacy-c1-v1') {
    return { kind: 'refused', reason: 'aggregate_assertion_not_legal' }
  }
  const policy = input.provenancePolicy ?? ATTENTION_INFERENCE_PROVENANCE_POLICY
  if (
    input.ruleId !== undefined
    && input.ruleId !== RECIPROCAL_PUBLIC_EXCHANGE_V1.ruleId
    && input.ruleId !== PUBLIC_AID_LINK_EXTENSION_V1.ruleId
  ) return { kind: 'refused', reason: 'aggregate_assertion_not_legal' }
  if (input.ruleId === PUBLIC_AID_LINK_EXTENSION_V1.ruleId) return extension(input.sources, policy)
  return reciprocal(input.sources, policy)
}
