/**
 * Stage A / A3 — the deterministic total order over normalized attention
 * candidates, with a complete tie-break sequence. Proof-local to
 * `domain/livingWorldProof`; not a production module, reducer, event, or
 * persistence contract.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D14 "complete, stable, versioned total order"; D6 identity is disjoint
 *    from ranking-only policy);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§13.1 "Total-order tie-break forcing family", D5-D12);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6 A3 ordering and tie-break obligations, §9 A3 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * The order is the Stage A projection of D14's tuple, restricted to the keys
 * that exist at this slice and applied strictly in sequence:
 *
 *   1. `source-kind`           — by the versioned source-kind table (D14 key 3).
 *                                Stage A declares exactly one kind, so this key
 *                                is never the decider here; it is evaluated
 *                                first so Stage B's second kind slots in as a
 *                                policy edit, not a comparator rewrite.
 *   2. `source-id`             — the engine-owned quest candidate ID
 *                                (D14 "pattern/source ID").
 *   3. `opening-provenance-id` — the accepted public/declassified opening
 *                                provenance: the Stage A analogue of D14's
 *                                sorted supporting-record identities.
 *   4. `candidate-id`          — the deterministic derived identity; D14's final
 *                                key, and the one that makes the order total.
 *
 * D14's earlier keys have no Stage A referent and are deliberately absent
 * rather than faked: there is no eligibility class beyond A-prime membership,
 * no deterministic score (ranking features are not in the controlling A3 plan
 * section), no semantic version, and no binding tuple — those belong to the
 * `narrative_pattern_instance` family, which Stage A does not build.
 *
 * Determinism rules honoured here, and asserted in
 * `attentionCandidateOrdering.test.ts`:
 *
 *  - string keys compare by UTF-16 code unit, never `localeCompare`, whose
 *    collation depends on host locale and ICU data;
 *  - no RNG, wall clock, random UUID, process-local counter, object identity,
 *    or map/set iteration order participates;
 *  - the input array is copied before sorting, so no caller's array is mutated
 *    and no earlier order is consumed as state;
 *  - sort stability is never relied on. Every tie must terminate in a strict
 *    total order: if two distinct entries compare equal through all four keys,
 *    `orderAttentionCandidates` returns a typed refusal rather than falling back
 *    to insertion, iteration, or pointer order.
 *
 * The comparator and the reported deciding key are driven by one table, so the
 * key a caller is told decided a comparison can never diverge from the key the
 * comparator actually used.
 *
 * Ordering is ranking policy: ADR-0013 D6 keeps it out of candidate identity,
 * so nothing in this module feeds `attentionCandidateIdentity.ts` and the
 * ordering version is not an identity input. No cap, budget, selection, ledger,
 * template, or trace is applied here; those are later, separately approved
 * slices.
 */
import {
  ATTENTION_CANDIDATE_ORDERING_VERSION,
  ATTENTION_CANDIDATE_SOURCE_KIND_ORDER,
} from './attentionCandidatePolicy'
import type { AttentionCandidateSourceKind } from './attentionCandidatePolicy'
import type { AttentionCandidate } from './attentionCandidate'

export type AttentionCandidateOrderingKey =
  | 'source-kind'
  | 'source-id'
  | 'opening-provenance-id'
  | 'candidate-id'

export type AttentionCandidateOrderingRefusal = 'ordering-tie-not-total'

export type AttentionCandidateOrderingResult =
  | {
      readonly kind: 'ok'
      readonly orderingVersion: string
      readonly orderedCandidates: readonly AttentionCandidate[]
    }
  | { readonly kind: 'refused'; readonly reason: AttentionCandidateOrderingRefusal }

/** Rank of a source kind in the versioned table (D14 key 3). */
export function attentionCandidateSourceKindRank(kind: AttentionCandidateSourceKind): number {
  return ATTENTION_CANDIDATE_SOURCE_KIND_ORDER.indexOf(kind)
}

function compareByCodeUnit(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareNumeric(left: number, right: number): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

type AttentionCandidateKeyComparator = (
  left: AttentionCandidate,
  right: AttentionCandidate,
) => number

type AttentionCandidateOrderingRule = readonly [
  AttentionCandidateOrderingKey,
  AttentionCandidateKeyComparator,
]

/** The ordering tuple, in the exact sequence the comparator applies it. */
const ORDERING_KEY_COMPARATORS: readonly AttentionCandidateOrderingRule[] =
  Object.freeze<AttentionCandidateOrderingRule[]>([
    [
      'source-kind',
      (left, right) => compareNumeric(
        attentionCandidateSourceKindRank(left.sourceKind),
        attentionCandidateSourceKindRank(right.sourceKind),
      ),
    ],
    ['source-id', (left, right) => compareByCodeUnit(left.sourceId, right.sourceId)],
    [
      'opening-provenance-id',
      (left, right) => compareByCodeUnit(left.openingProvenanceId, right.openingProvenanceId),
    ],
    ['candidate-id', (left, right) => compareByCodeUnit(left.candidateId, right.candidateId)],
  ])

/** The versioned key sequence, derived from the comparator table itself. */
export const ATTENTION_CANDIDATE_ORDERING_KEYS: readonly AttentionCandidateOrderingKey[] = Object.freeze(
  ORDERING_KEY_COMPARATORS.map(([key]) => key),
)

/** The complete Stage A comparator: strict tuple order, no fallback. */
export function compareAttentionCandidates(left: AttentionCandidate, right: AttentionCandidate): number {
  for (const [, compare] of ORDERING_KEY_COMPARATORS) {
    const order = compare(left, right)
    if (order !== 0) return order
  }
  return 0
}

/**
 * Which tuple key decided this comparison, or `null` when the two candidates
 * are equal through every key. Driven by the same table as the comparator, so
 * the two can never disagree.
 */
export function resolveAttentionCandidateOrderingKey(
  left: AttentionCandidate,
  right: AttentionCandidate,
): AttentionCandidateOrderingKey | null {
  for (const [key, compare] of ORDERING_KEY_COMPARATORS) {
    if (compare(left, right) !== 0) return key
  }
  return null
}

/**
 * Order candidates into the versioned total order, or refuse.
 *
 * The adjacent-pair check after sorting is what makes "total" a verified
 * property rather than an assumption: in a sorted sequence, two entries compare
 * equal somewhere if and only if some adjacent pair does. A tie that survives
 * every key is a typed refusal, never insertion order.
 */
export function orderAttentionCandidates(
  attentionCandidates: readonly AttentionCandidate[],
): AttentionCandidateOrderingResult {
  const orderedCandidates = [...attentionCandidates].sort(compareAttentionCandidates)

  let previous: AttentionCandidate | null = null
  for (const current of orderedCandidates) {
    if (previous !== null && compareAttentionCandidates(previous, current) === 0) {
      return { kind: 'refused', reason: 'ordering-tie-not-total' }
    }
    previous = current
  }

  return {
    kind: 'ok',
    orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION,
    orderedCandidates: Object.freeze(orderedCandidates),
  }
}
