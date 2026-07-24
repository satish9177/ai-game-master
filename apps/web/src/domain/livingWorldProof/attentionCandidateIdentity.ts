/**
 * Stage A / A3 + Stage B / B4 — deterministic attention-candidate identity as a
 * discriminated two-family function, and the explicit, versioned
 * canonicalization each branch is computed over. Proof-local to
 * `domain/livingWorldProof`; not a production module, reducer, event, or
 * persistence contract.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research`:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D6 deterministic candidate identity; identity-affecting inputs disjoint
 *    from ranking-only policy);
 *  - `docs/research-notes/2026-07-23-019-narrative-pattern-instances-stage-b.md`
 *    (RN019 §7.2 the pattern identity inputs, §9.1 the common candidate);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-23-attention-ledger-replay-stage-b-implementation-plan.md`
 *    (§4.2 the disjoint quest/pattern identity branches, §6 the exact
 *    pattern-candidate canonical input).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * **One module, two disjoint branches.** The common function dispatches only by
 * `sourceKind`:
 *
 *  - the **quest** branch is byte-identical to committed Stage A: its canonical
 *    input remains exactly `canonicalizationVersion`, `identitySchemaVersion`,
 *    `openingProvenanceId`, `sourceId`, `sourceKind`, and the resulting quest
 *    candidate IDs are unchanged;
 *  - the **pattern** branch is a disjoint schema whose canonical input is
 *    exactly `sourceKind`, `sourceId` (the `patternInstanceId`),
 *    `patternSemanticVersion`, `canonicalBindingTuple`,
 *    `canonicalSupportingRecordIdentityTuple`, `canonicalizationVersion`, and
 *    `patternCandidateIdentitySchemaVersion`. It has no `openingProvenanceId`
 *    field and invents no empty/fabricated sentinel.
 *
 * Both branches exclude ranking/evaluation snapshot LSN, source committed LSN,
 * ordering version, rank, score, resource-policy version, retained/dropped
 * status, exposure, cooldown, retirement, template/presentation version, and
 * ledger state. A ranking-only, resource-only, or presentation-only change
 * therefore preserves every candidate ID.
 *
 * A missing branch-specific field, a quest field on the pattern branch, a
 * pattern field on the quest branch, a mixed/ambiguous input, or an unsupported
 * branch identity-schema version refuses (throws) rather than aliasing. Because
 * `canonicalSerialization.ts` is documented as not collision-resistant, the
 * normalizer refuses rather than aliases when two distinct inputs would produce
 * one ID.
 */
import { canonicalSerialize, mintHash } from './canonicalSerialization'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
} from './attentionCandidatePolicy'

/** The quest identity branch input a caller supplies (committed Stage A shape). */
export interface AttentionQuestCandidateIdentityInput {
  readonly sourceKind: 'quest_candidate'
  readonly sourceId: string
  readonly openingProvenanceId: string
}

/** One canonical `(role, entityId)` binding pair for the pattern branch. */
export type AttentionPatternCandidateBindingTupleEntry = readonly [string, string]

/**
 * One canonical supporting-record identity entry for the pattern branch:
 * `(semanticRole, recordKind, recordId, visibilityProvenanceId, commitLsn)`.
 */
export type AttentionPatternCandidateSupportingTupleEntry =
  readonly [string, string, string, string, number]

/** The pattern identity branch input the normalizer supplies from an instance. */
export interface AttentionPatternCandidateIdentityInput {
  readonly sourceKind: 'narrative_pattern_instance'
  readonly sourceId: string
  readonly patternSemanticVersion: number
  readonly canonicalBindingTuple: readonly AttentionPatternCandidateBindingTupleEntry[]
  readonly canonicalSupportingRecordIdentityTuple:
    readonly AttentionPatternCandidateSupportingTupleEntry[]
}

/** The closed set of identity-affecting inputs, discriminated by `sourceKind`. */
export type AttentionCandidateIdentityInput =
  | AttentionQuestCandidateIdentityInput
  | AttentionPatternCandidateIdentityInput

/** The quest canonical form actually hashed — unchanged from committed Stage A. */
export interface CanonicalAttentionQuestCandidateIdentityInput {
  readonly canonicalizationVersion: string
  readonly identitySchemaVersion: string
  readonly openingProvenanceId: string
  readonly sourceId: string
  readonly sourceKind: 'quest_candidate'
}

/** The pattern canonical form actually hashed (plan §6). */
export interface CanonicalAttentionPatternCandidateIdentityInput {
  readonly canonicalBindingTuple: readonly AttentionPatternCandidateBindingTupleEntry[]
  readonly canonicalSupportingRecordIdentityTuple:
    readonly AttentionPatternCandidateSupportingTupleEntry[]
  readonly canonicalizationVersion: string
  readonly patternCandidateIdentitySchemaVersion: string
  readonly patternSemanticVersion: number
  readonly sourceId: string
  readonly sourceKind: 'narrative_pattern_instance'
}

/** The exact own keys of the quest canonical identity input, in canonical order. */
export const ATTENTION_CANDIDATE_IDENTITY_INPUT_KEYS: readonly string[] = Object.freeze([
  'canonicalizationVersion',
  'identitySchemaVersion',
  'openingProvenanceId',
  'sourceId',
  'sourceKind',
])

/** The exact own keys of the pattern canonical identity input, in canonical order. */
export const ATTENTION_PATTERN_CANDIDATE_IDENTITY_INPUT_KEYS: readonly string[] = Object.freeze([
  'canonicalBindingTuple',
  'canonicalSupportingRecordIdentityTuple',
  'canonicalizationVersion',
  'patternCandidateIdentitySchemaVersion',
  'patternSemanticVersion',
  'sourceId',
  'sourceKind',
])

function requireIdentityField(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('attentionCandidateIdentity: ' + name + ' must be non-empty')
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/**
 * Comparison of two strings by UTF-16 code unit. Deliberately not
 * `localeCompare`: collation is locale- and ICU-dependent, so it would make
 * canonical order an environment input.
 */
function compareByCodeUnit(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * The canonicalization version's collection rule: an unordered string
 * collection is sorted into UTF-16 code-unit order and frozen. Multiplicity is
 * preserved — canonicalization fixes order, it never drops data. The input is
 * copied first, so a caller's array is never sorted in place.
 */
export function canonicalizeAttentionCandidateStringList(values: readonly string[]): readonly string[] {
  return Object.freeze([...values].sort(compareByCodeUnit))
}

/**
 * Build the closed, versioned quest canonical identity input. Keys are written
 * in canonical order here and re-sorted by `canonicalSerialize`, so the bytes
 * are fixed by the rule rather than by this literal's layout. Refuses a pattern
 * field appearing on the quest branch.
 */
export function canonicalAttentionCandidateIdentityInput(
  input: AttentionQuestCandidateIdentityInput,
): CanonicalAttentionQuestCandidateIdentityInput {
  if (input.sourceKind !== 'quest_candidate') {
    throw new Error('attentionCandidateIdentity: quest branch requires source kind quest_candidate')
  }
  if (
    hasOwn(input, 'patternSemanticVersion')
    || hasOwn(input, 'canonicalBindingTuple')
    || hasOwn(input, 'canonicalSupportingRecordIdentityTuple')
  ) {
    throw new Error('attentionCandidateIdentity: quest branch must not carry pattern fields')
  }
  requireIdentityField(input.sourceId, 'source id')
  requireIdentityField(input.openingProvenanceId, 'opening provenance id')

  return Object.freeze({
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    openingProvenanceId: input.openingProvenanceId,
    sourceId: input.sourceId,
    sourceKind: 'quest_candidate',
  })
}

function requireBindingTuple(
  value: readonly AttentionPatternCandidateBindingTupleEntry[],
): readonly AttentionPatternCandidateBindingTupleEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('attentionCandidateIdentity: pattern branch requires a non-empty binding tuple')
  }
  return Object.freeze(value.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error('attentionCandidateIdentity: invalid binding tuple entry')
    }
    requireIdentityField(entry[0], 'binding role')
    requireIdentityField(entry[1], 'binding entity id')
    return Object.freeze([entry[0], entry[1]] as const)
  }))
}

function requireSupportingTuple(
  value: readonly AttentionPatternCandidateSupportingTupleEntry[],
): readonly AttentionPatternCandidateSupportingTupleEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('attentionCandidateIdentity: pattern branch requires a non-empty supporting tuple')
  }
  return Object.freeze(value.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 5) {
      throw new Error('attentionCandidateIdentity: invalid supporting tuple entry')
    }
    requireIdentityField(entry[0], 'supporting role')
    requireIdentityField(entry[1], 'supporting record kind')
    requireIdentityField(entry[2], 'supporting record id')
    requireIdentityField(entry[3], 'supporting visibility provenance id')
    if (typeof entry[4] !== 'number' || !Number.isSafeInteger(entry[4]) || entry[4] < 0) {
      throw new Error('attentionCandidateIdentity: invalid supporting commit lsn')
    }
    return Object.freeze([entry[0], entry[1], entry[2], entry[3], entry[4]] as const)
  }))
}

/**
 * Build the closed, versioned pattern canonical identity input (plan §6). Keys
 * are written in canonical order and re-sorted by `canonicalSerialize`. Refuses
 * a quest field appearing on the pattern branch.
 */
export function canonicalPatternAttentionCandidateIdentityInput(
  input: AttentionPatternCandidateIdentityInput,
): CanonicalAttentionPatternCandidateIdentityInput {
  if (input.sourceKind !== 'narrative_pattern_instance') {
    throw new Error('attentionCandidateIdentity: pattern branch requires source kind narrative_pattern_instance')
  }
  if (hasOwn(input, 'openingProvenanceId')) {
    throw new Error('attentionCandidateIdentity: pattern branch must not carry the quest opening-provenance field')
  }
  requireIdentityField(input.sourceId, 'source id')
  if (
    typeof input.patternSemanticVersion !== 'number'
    || !Number.isSafeInteger(input.patternSemanticVersion)
    || input.patternSemanticVersion < 0
  ) {
    throw new Error('attentionCandidateIdentity: pattern semantic version must be a non-negative integer')
  }

  return Object.freeze({
    canonicalBindingTuple: requireBindingTuple(input.canonicalBindingTuple),
    canonicalSupportingRecordIdentityTuple: requireSupportingTuple(input.canonicalSupportingRecordIdentityTuple),
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    patternCandidateIdentitySchemaVersion: ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    patternSemanticVersion: input.patternSemanticVersion,
    sourceId: input.sourceId,
    sourceKind: 'narrative_pattern_instance',
  })
}

/** The quest canonical bytes an identity is computed over — exposed for evidence. */
export function canonicalAttentionCandidateIdentityBytes(
  input: AttentionQuestCandidateIdentityInput,
): string {
  return canonicalSerialize(canonicalAttentionCandidateIdentityInput(input))
}

/** The pattern canonical bytes an identity is computed over — exposed for evidence. */
export function canonicalPatternAttentionCandidateIdentityBytes(
  input: AttentionPatternCandidateIdentityInput,
): string {
  return canonicalSerialize(canonicalPatternAttentionCandidateIdentityInput(input))
}

/**
 * The deterministic attention-candidate ID, dispatched by `sourceKind`. The
 * relevant identity-schema version is prefixed so an ID minted under one branch
 * or a later schema can never be compared equal to one minted under another.
 */
export function computeAttentionCandidateIdentity(input: AttentionCandidateIdentityInput): string {
  if (input.sourceKind === 'quest_candidate') {
    return ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION
      + ':' + mintHash(canonicalAttentionCandidateIdentityBytes(input))
  }
  if (input.sourceKind === 'narrative_pattern_instance') {
    return ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION
      + ':' + mintHash(canonicalPatternAttentionCandidateIdentityBytes(input))
  }
  throw new Error('attentionCandidateIdentity: unsupported source kind')
}
