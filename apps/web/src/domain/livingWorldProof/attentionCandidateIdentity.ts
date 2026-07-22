/**
 * Stage A / A3 — deterministic attention-candidate identity and the explicit,
 * versioned canonicalization that identity is computed over. Proof-local to
 * `domain/livingWorldProof`; not a production module, reducer, event, or
 * persistence contract.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D6 deterministic candidate identity; identity-affecting inputs disjoint
 *    from ranking-only policy);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§14 "Candidate identity fixtures", I1-I7);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6 A3 identity obligations, §9 A3 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * The identity input set is closed and small, exactly as the controlling A3
 * plan section fixes it: source kind, source candidate ID, identity-schema
 * version, canonicalization version, and the accepted public/declassified
 * opening-provenance identity. ADR-0013 D6 is explicit that identity-affecting
 * inputs are *disjoint* from ranking-only policy, so nothing else may enter —
 * in particular not the ranking snapshot coordinate, the accessor-contract
 * version, the ordering version, legally-visible parties, stakes, or the origin
 * consequence reference. A ranking-only or snapshot-only change must therefore
 * leave every candidate ID byte-identical, which is what keeps later exposure
 * and cooldown history joinable across such a change.
 *
 * Determinism rules honoured here, and asserted in
 * `attentionCandidateIdentity.test.ts`:
 *
 *  - canonicalization is explicit: the identity input is rebuilt as a closed
 *    record whose keys are written in sorted order and then serialized by the
 *    proof rig's deep key-sorting `canonicalSerialize`, so no construction or
 *    property-insertion order can reach the bytes;
 *  - collections are canonicalized by a stated rule before use, by UTF-16
 *    code-unit order — never `localeCompare`, whose collation depends on the
 *    host locale and ICU data and would make the result environment-sensitive;
 *  - no RNG, wall clock, random UUID, process-local counter, object identity,
 *    or map/set iteration order participates;
 *  - both versions are folded into the hashed bytes *and* the identity-schema
 *    version is prefixed onto the ID, so a version bump is visible in the ID
 *    itself and can never be silently reinterpreted as an older one.
 *
 * `canonicalSerialization.ts` is reused unchanged, as the controlling A3 plan
 * section directs. Its own header records that it is a proof-local stand-in and
 * not a production canonical-serialization or cryptographic-hash choice; that
 * limit is unchanged here, and nothing in this module promotes it. Because the
 * helper is explicitly not collision-resistant, the normalizer refuses rather
 * than aliases when two distinct identity inputs would produce one ID.
 */
import { canonicalSerialize, mintHash } from './canonicalSerialization'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
} from './attentionCandidatePolicy'
import type { AttentionCandidateSourceKind } from './attentionCandidatePolicy'

/** The closed set of identity-affecting inputs a caller supplies. */
export interface AttentionCandidateIdentityInput {
  readonly sourceKind: AttentionCandidateSourceKind
  readonly sourceId: string
  readonly openingProvenanceId: string
}

/**
 * The canonical form actually hashed. The two versions are added here rather
 * than accepted from the caller, so no call site can compute an identity under
 * a version it did not declare.
 */
export interface CanonicalAttentionCandidateIdentityInput {
  readonly canonicalizationVersion: string
  readonly identitySchemaVersion: string
  readonly openingProvenanceId: string
  readonly sourceId: string
  readonly sourceKind: AttentionCandidateSourceKind
}

/** The exact own keys of the canonical identity input, in canonical order. */
export const ATTENTION_CANDIDATE_IDENTITY_INPUT_KEYS: readonly string[] = Object.freeze([
  'canonicalizationVersion',
  'identitySchemaVersion',
  'openingProvenanceId',
  'sourceId',
  'sourceKind',
])

function requireIdentityField(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error('attentionCandidateIdentity: ' + name + ' must be non-empty')
  }
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
 * Build the closed, versioned canonical identity input. Keys are written in
 * canonical order here and re-sorted by `canonicalSerialize`, so the bytes are
 * fixed by the rule rather than by this literal's layout.
 */
export function canonicalAttentionCandidateIdentityInput(
  input: AttentionCandidateIdentityInput,
): CanonicalAttentionCandidateIdentityInput {
  requireIdentityField(input.sourceId, 'source id')
  requireIdentityField(input.openingProvenanceId, 'opening provenance id')

  return Object.freeze({
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    openingProvenanceId: input.openingProvenanceId,
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
  })
}

/** The canonical bytes an identity is computed over — exposed for evidence. */
export function canonicalAttentionCandidateIdentityBytes(input: AttentionCandidateIdentityInput): string {
  return canonicalSerialize(canonicalAttentionCandidateIdentityInput(input))
}

/**
 * The deterministic attention-candidate ID: a pure function of the versioned
 * canonical input above and of nothing else. The identity-schema version is
 * prefixed so an ID minted under a later schema can never be mistaken for, or
 * compared equal to, one minted under this schema.
 */
export function computeAttentionCandidateIdentity(input: AttentionCandidateIdentityInput): string {
  return ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION + ':' + mintHash(canonicalAttentionCandidateIdentityBytes(input))
}
