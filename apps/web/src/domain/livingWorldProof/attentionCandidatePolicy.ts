/**
 * Stage A / A3 — the single immutable Stage A policy module for the derived
 * (B-domain) attention candidate. This is not a production module, reducer,
 * event, or persistence contract; it is proof-local to `domain/livingWorldProof`.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D5 source-kind preservation, D6 identity-schema and canonicalization
 *    versions, D14 stable total order);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§4 declared replay inputs, §13.1 total-order tie-break family,
 *    §14 candidate identity fixtures);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6 A3 obligations, §9 A3 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * Every value here is a pinned, versioned constant. ADR-0013 D6 requires that
 * canonicalization and identity-schema versions stay *distinct and never
 * collapsed* — a change to either is an explicit, auditable version bump, never
 * a silent format drift — so they are declared separately and the ordering
 * version is declared separately again.
 *
 * Deliberately absent, because the controlling A3 plan section does not
 * authorize them: ranking weights or score policy, resource/candidate caps,
 * exposure, cooldown, template, channel, and ledger policy versions. Those are
 * A4/A5 pins and adding them here early would put unowned constants into every
 * later cache key and trace.
 */

/**
 * The versioned canonical byte rule (ADR-0013 D6). It covers *how* an identity
 * input is turned into bytes: deep key sorting, the collection canonical form
 * in `attentionCandidateIdentity.ts`, and the hash encoding those bytes feed.
 */
export const ATTENTION_CANDIDATE_CANONICALIZATION_VERSION = 'attention-candidate-canonicalization-v1' as const

/**
 * The versioned shape of the candidate ID itself (ADR-0013 D6) — which fields
 * are identity-affecting, and how the resulting ID string is encoded. Distinct
 * from the canonicalization version above and never collapsed into it.
 */
export const ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION = 'attention-candidate-identity-schema-v1' as const

/**
 * The versioned total-order key sequence (ADR-0013 D14). Ordering is ranking
 * policy, so ADR-0013 D6 forbids it from reaching candidate identity: this
 * version is deliberately not an identity input.
 */
export const ATTENTION_CANDIDATE_ORDERING_VERSION = 'attention-candidate-ordering-v1' as const

/**
 * The two cache-key schema versions (ADR-0013 D15; plan §6 "View-cache identity
 * ... Ranking-cache identity"). They are separate pins because the two keys have
 * different semantic dependencies and must be able to move independently. Each
 * is prefixed onto its key, so a key minted under a later schema can never be
 * compared equal to one minted under this schema.
 */
export const ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION =
  'attention-candidate-derivation-cache-key-v1' as const

export const ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION =
  'attention-candidate-ranking-cache-key-v1' as const

/**
 * The bounds on the one numeric field Stage A actually owns: the ranking
 * snapshot coordinate. Plan §6 requires "checked range validation and a typed
 * refusal on overflow", and that "Zero/negative/overflow ... return a typed
 * ineligible/refusal outcome, never an unbounded fallback".
 *
 * Provenance of each bound, stated because neither is a product value the plan
 * pins as a number:
 *
 *  - the minimum is `0`, carried unchanged from A1's committed coordinate rule
 *    (`attentionQuestCandidateContracts.requireLsn`: a non-negative integer);
 *  - the maximum is the JavaScript safe-integer ceiling. It is the only ceiling
 *    under which ADR-0013 D13's "arithmetic cannot overflow within those ranges"
 *    is checkable at all: past it, integers are no longer distinct values, so
 *    two different coordinates could compare and serialize identically.
 *
 * ADR-0013 open questions 1-3 leave every *product* numeric bound — ranking
 * score cutpoints, candidate cap, template assertion cap, window density limit,
 * retirement and cooldown thresholds — explicitly experiment-owned and unpinned.
 * None of them is invented here; see the A3 report for the exact missing
 * decisions.
 */
export const ATTENTION_RANKING_SNAPSHOT_LSN_MIN = 0

export const ATTENTION_RANKING_SNAPSHOT_LSN_MAX = Number.MAX_SAFE_INTEGER

/**
 * The shared bounded-integer check for that coordinate. `Number.isSafeInteger`
 * is false for `NaN`, `Infinity`, `-Infinity`, any fractional value, and any
 * magnitude past the safe ceiling, so a single predicate closes every case the
 * plan names. Nothing here clamps, wraps, truncates, or repairs: a caller either
 * supplies a value inside the range or receives a typed refusal.
 */
export function isAttentionRankingSnapshotLsnInRange(value: number): boolean {
  return Number.isSafeInteger(value)
    && value >= ATTENTION_RANKING_SNAPSHOT_LSN_MIN
    && value <= ATTENTION_RANKING_SNAPSHOT_LSN_MAX
}

/**
 * ADR-0013 D5 requires two source kinds for the complete v0 surface. Stage A
 * scopes to `quest_candidate` only; `narrative_pattern_instance` belongs to
 * Stage B and is not declared here, so no Stage A code can name it.
 */
export type AttentionCandidateSourceKind = 'quest_candidate'

/**
 * ADR-0013 D5: "Normalization must never erase whether the source is
 * authoritative (`QuestCandidate`) or derived (`NarrativePatternInstance`)."
 */
export type AttentionCandidateSourceAuthority = 'authoritative'

/**
 * The versioned source-kind order — key 1 of the D14 tuple. It is declared even
 * though Stage A has exactly one kind, so the comparator consults a pinned
 * table rather than an implicit constant, and adding Stage B's kind later is a
 * visible policy edit rather than a comparator rewrite.
 */
export const ATTENTION_CANDIDATE_SOURCE_KIND_ORDER: readonly AttentionCandidateSourceKind[] = Object.freeze([
  'quest_candidate',
])

/** Source authority per kind, preserved through normalization (ADR-0013 D5). */
export const ATTENTION_CANDIDATE_SOURCE_AUTHORITY: Readonly<
  Record<AttentionCandidateSourceKind, AttentionCandidateSourceAuthority>
> = Object.freeze({ quest_candidate: 'authoritative' })
