import { canonicalSerialize, mintHash } from './canonicalSerialization'
import type { AttentionInferenceProvenancePolicy } from './attentionInferenceProvenancePolicy'
import {
  findAttentionInferenceRule,
  PUBLIC_AID_LINK_EXTENSION_V1,
  RECIPROCAL_PUBLIC_EXCHANGE_V1,
} from './attentionInferenceRuleLibrary'
import type { AttentionInferenceRuleId } from './attentionInferenceRuleLibrary'

export type AttentionInferenceProvenanceRefusal =
  | 'provenance_cycle'
  | 'provenance_depth_exceeded'
  | 'provenance_budget_exceeded'
  | 'provenance_incomplete'

export interface AttentionPositiveRecordProvenance {
  readonly kind: 'positive_record'
  readonly assertionId: string
  readonly sourceRecordId: string
}

export interface AttentionInferenceProvenance {
  readonly kind: 'inference'
  readonly assertionId: string
  readonly token: 'public aid was exchanged' | 'recorded public aid linked'
  readonly participants: readonly string[]
  readonly ruleId: AttentionInferenceRuleId
  readonly ruleSemanticVersion: string
  readonly ruleContentHash: string
  readonly sources: readonly AttentionInferenceProvenanceSource[]
}

export interface AttentionInferenceAggregateSource {
  readonly kind: 'aggregate'
  readonly assertionId: string
  readonly provenance: AttentionInferenceProvenance
}

export type AttentionInferenceProvenanceSource =
  | AttentionPositiveRecordProvenance
  | AttentionInferenceAggregateSource

export interface AttentionValidatedInferenceProvenance {
  readonly canonicalBytes: string
  readonly nodeCount: number
  readonly edgeCount: number
  readonly maxDepth: number
}

export type AttentionInferenceProvenanceValidation =
  | { readonly kind: 'ok'; readonly value: AttentionValidatedInferenceProvenance }
  | { readonly kind: 'refused'; readonly reason: AttentionInferenceProvenanceRefusal }

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isCanonicalParticipantOrder(participants: readonly string[]): boolean {
  return participants.every((participant, index) => index === 0 || participants[index - 1]! < participant)
}

function canonicalDirectOrder(
  sources: readonly AttentionInferenceProvenanceSource[],
): boolean {
  if (!sources.every((source) => source.kind === 'positive_record')) return false
  const keys = sources.map((source) => `${source.sourceRecordId}\u0000${source.assertionId}`)
  return keys.every((key, index) => index === 0 || keys[index - 1]! <= key)
}

function hasExactRuleSourceShape(provenance: AttentionInferenceProvenance): boolean {
  if (provenance.sources.length !== 2) return false
  if (provenance.ruleId === RECIPROCAL_PUBLIC_EXCHANGE_V1.ruleId) {
    return provenance.sources.every((source) => source.kind === 'positive_record')
      && canonicalDirectOrder(provenance.sources)
  }
  if (provenance.ruleId === PUBLIC_AID_LINK_EXTENSION_V1.ruleId) {
    return provenance.sources[0]?.kind === 'aggregate' && provenance.sources[1]?.kind === 'positive_record'
  }
  return false
}

/** The single structural boundary for legal and fixture-forged C1 graphs. */
export function validateAttentionInferenceProvenance(
  provenance: AttentionInferenceProvenance,
  policy: AttentionInferenceProvenancePolicy,
): AttentionInferenceProvenanceValidation {
  const active = new Set<string>()
  const allAssertions = new Set<string>()
  const allSourceRecordIds = new Set<string>()
  let nodeCount = 0
  let edgeCount = 0
  let maxDepth = 0
  const visitInference = (current: AttentionInferenceProvenance, depth: number): AttentionInferenceProvenanceRefusal | null => {
    if (depth > policy.maxDepth) return 'provenance_depth_exceeded'
    if (
      !nonEmpty(current.assertionId)
      || !nonEmpty(current.ruleSemanticVersion)
      || !nonEmpty(current.ruleContentHash)
      || !nonEmpty(current.token)
      || !Array.isArray(current.participants)
      || current.participants.length < 2
      || current.participants.some((participant) => !nonEmpty(participant))
      || new Set(current.participants).size !== current.participants.length
      || !isCanonicalParticipantOrder(current.participants)
      || !hasExactKeys(current, [
        'assertionId', 'kind', 'participants', 'ruleContentHash', 'ruleId',
        'ruleSemanticVersion', 'sources', 'token',
      ])
    ) return 'provenance_incomplete'
    if (active.has(current.assertionId)) return 'provenance_cycle'
    if (allAssertions.has(current.assertionId)) return 'provenance_incomplete'
    if (nodeCount + 1 > policy.maxNodes) return 'provenance_budget_exceeded'
    if (findAttentionInferenceRule(current.ruleId, current.ruleSemanticVersion, current.ruleContentHash) === undefined) {
      return 'provenance_incomplete'
    }
    if (!hasExactRuleSourceShape(current)) return 'provenance_incomplete'
    active.add(current.assertionId)
    allAssertions.add(current.assertionId)
    nodeCount += 1
    maxDepth = Math.max(maxDepth, depth)
    for (const source of current.sources) {
      if (edgeCount + 1 > policy.maxEdges) return 'provenance_budget_exceeded'
      edgeCount += 1
      if (!nonEmpty(source.assertionId) || allAssertions.has(source.assertionId)) {
        return active.has(source.assertionId) ? 'provenance_cycle' : 'provenance_incomplete'
      }
      if (source.kind === 'positive_record') {
        if (
          !hasExactKeys(source, ['assertionId', 'kind', 'sourceRecordId'])
          || !nonEmpty(source.sourceRecordId)
          || allSourceRecordIds.has(source.sourceRecordId)
        ) return 'provenance_incomplete'
        if (nodeCount + 1 > policy.maxNodes) return 'provenance_budget_exceeded'
        allAssertions.add(source.assertionId)
        allSourceRecordIds.add(source.sourceRecordId)
        nodeCount += 1
        maxDepth = Math.max(maxDepth, depth + 1)
      } else if (source.kind === 'aggregate') {
        if (
          !hasExactKeys(source, ['assertionId', 'kind', 'provenance'])
          || source.provenance.assertionId !== source.assertionId
        ) return 'provenance_incomplete'
        const refusal = visitInference(source.provenance, depth + 1)
        if (refusal !== null) return refusal
      } else {
        return 'provenance_incomplete'
      }
    }
    active.delete(current.assertionId)
    return null
  }
  const refusal = visitInference(provenance, 0)
  if (refusal !== null) return { kind: 'refused', reason: refusal }
  return { kind: 'ok', value: Object.freeze({ canonicalBytes: canonicalSerialize(provenance), edgeCount, maxDepth, nodeCount }) }
}

export function mintAttentionAggregateAssertionId(input: object): string {
  return 'attention-aggregate-assertion-v1:' + mintHash(canonicalSerialize(input))
}
