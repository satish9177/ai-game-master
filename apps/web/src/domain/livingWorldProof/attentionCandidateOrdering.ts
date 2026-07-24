/**
 * Stage A / A3 + Stage B / B4 — the deterministic complete nine-key total order
 * over normalized two-family attention candidates, with a full tie-break
 * sequence. Proof-local to `domain/livingWorldProof`; not a production module,
 * reducer, event, or persistence contract.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research`:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D14 "complete, stable, versioned total order"; D6 identity is disjoint
 *    from ranking-only policy);
 *  - `docs/research-notes/2026-07-23-019-narrative-pattern-instances-stage-b.md`
 *    (RN019 §9.2 the exact nine-key tuple and the quest opening-LSN adapter);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-23-attention-ledger-replay-stage-b-implementation-plan.md`
 *    (§4.5, §7 the nine-key total order, §9 B4 obligations).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * The nine keys, applied strictly in sequence (RN019 §9.2):
 *
 *   1. `eligibility`            — `eligible=0 < ineligible=1`.
 *   2. `proof-score`           — the deterministic proof score, fixed to 0 for
 *                                every candidate; present so a later scoring
 *                                policy slots in as an edit, never deciding here.
 *   3. `source-kind`           — `quest_candidate < narrative_pattern_instance`.
 *   4. `semantic-version`      — the pattern semantic version; quest uses a
 *                                documented fixed sentinel (0).
 *   5. `canonical-binding-tuple`             — quest uses a fixed empty tuple.
 *   6. `canonical-supporting-record-identity-tuple` — quest uses a fixed empty tuple.
 *   7. `source-committed-lsn`  — quest `openedAtLsn`; pattern `lastProgressLsn`.
 *                                Both are numbers, compared numerically.
 *   8. `source-id`             — the engine-owned source ID.
 *   9. `candidate-id`          — the final total-order/collision guard.
 *
 * **Key 7 is a number in both branches (RN019 §9.2).** The quest value is the
 * numeric `openedAtLsn` already carried on the normalized candidate, joined
 * one-to-one from the accessor-minted
 * `AttentionReadableQuestOpeningCoordinateView` inside the one common
 * normalizer (RN019 §4.3); the pattern value is the numeric `lastProgressLsn`.
 * Key 7 is a committed log coordinate in both branches, so the two are the same
 * kind of quantity even though key 3 has already separated the families.
 *
 * **Explicitly forbidden here, and structurally impossible in this module:**
 * using `openingProvenanceId` as the source-committed-LSN key; parsing,
 * extracting, or inferring a number from a provenance string; comparing
 * provenance text by UTF-16 code unit as the LSN key; substituting a fabricated
 * numeric sentinel (`0`, `-1`, the snapshot LSN, an index, or any other
 * stand-in) for a quest whose coordinate is not legally available; and reading
 * the raw `QuestCandidate`, the snapshot, or any authoritative record. A quest
 * candidate whose opening coordinate is missing, duplicated, mismatched,
 * unsafe, unsupported, or not accessor-minted refuses at the §4.3 join, before
 * ordering — so this module never sees one without a real numeric coordinate,
 * and `sourceCommittedLsnOf` asserts that invariant rather than repairing it.
 *
 * `candidateId` is the final guard only. No unique identifier occurs before an
 * ordering key that must be exercised, so the acceptance suite can force every
 * earlier key independently.
 *
 * Determinism: string keys compare by UTF-16 code unit, never `localeCompare`;
 * no RNG, wall clock, random UUID, process counter, object identity, or map/set
 * iteration order participates; the input array is copied before sorting; and a
 * surviving all-key tie between distinct entries refuses rather than falling
 * back to insertion, iteration, or pointer order.
 */
import {
  ATTENTION_CANDIDATE_ORDERING_VERSION,
  ATTENTION_CANDIDATE_SOURCE_KIND_ORDER,
} from './attentionCandidatePolicy'
import type { AttentionCandidateSourceKind } from './attentionCandidatePolicy'
import { canonicalSerialize } from './canonicalSerialization'
import type { AttentionCandidate } from './attentionCandidate'

export type AttentionCandidateOrderingKey =
  | 'eligibility'
  | 'proof-score'
  | 'source-kind'
  | 'semantic-version'
  | 'canonical-binding-tuple'
  | 'canonical-supporting-record-identity-tuple'
  | 'source-committed-lsn'
  | 'source-id'
  | 'candidate-id'

/** The documented fixed quest sentinels for keys the quest family does not carry. */
export const ATTENTION_QUEST_SEMANTIC_VERSION_SENTINEL = 0
export const ATTENTION_QUEST_EMPTY_TUPLE_BYTES = canonicalSerialize(Object.freeze([]))

/** The fixed deterministic proof score for every candidate (RN019 §9.2). */
export const ATTENTION_CANDIDATE_PROOF_SCORE = 0

export type AttentionCandidateOrderingRefusal = 'ordering-tie-not-total'

/** One adjacent-pair comparison from the ordered sequence, for trace evidence. */
export interface AttentionCandidateOrderingComparison {
  readonly leftCandidateId: string
  readonly rightCandidateId: string
  readonly evaluatedKeys: readonly AttentionCandidateOrderingKey[]
  readonly decidingKey: AttentionCandidateOrderingKey
  readonly leftValue: string
  readonly rightValue: string
}

export type AttentionCandidateOrderingResult =
  | {
      readonly kind: 'ok'
      readonly orderingVersion: string
      readonly orderedCandidates: readonly AttentionCandidate[]
      readonly comparisons: readonly AttentionCandidateOrderingComparison[]
    }
  | { readonly kind: 'refused'; readonly reason: AttentionCandidateOrderingRefusal }

/** Rank of a source kind in the versioned table (key 3). */
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

function semanticVersionOf(candidate: AttentionCandidate): number {
  return candidate.sourceKind === 'quest_candidate'
    ? ATTENTION_QUEST_SEMANTIC_VERSION_SENTINEL
    : candidate.patternSemanticVersion
}

function bindingBytesOf(candidate: AttentionCandidate): string {
  return candidate.sourceKind === 'quest_candidate'
    ? ATTENTION_QUEST_EMPTY_TUPLE_BYTES
    : canonicalSerialize(candidate.canonicalBindingTuple)
}

function supportingBytesOf(candidate: AttentionCandidate): string {
  return candidate.sourceKind === 'quest_candidate'
    ? ATTENTION_QUEST_EMPTY_TUPLE_BYTES
    : canonicalSerialize(candidate.canonicalSupportingRecordIdentityTuple)
}

/**
 * The key-7 value: the candidate's committed log coordinate as a **number**.
 * Quests use the numeric `openedAtLsn` joined from the accessor-minted sidecar;
 * patterns use the numeric `lastProgressLsn`. Neither branch reads, parses, or
 * compares `openingProvenanceId`.
 *
 * The safe-integer assertion is a structural guard, not a repair: the §4.3 join
 * and the pattern lifecycle both already refuse an unsafe coordinate, so
 * reaching this throw means a candidate was fabricated outside the one common
 * normalizer. Refusing loudly is correct — silently substituting a sentinel is
 * exactly what RN019 §9.2 forbids.
 */
function sourceCommittedLsnOf(candidate: AttentionCandidate): number {
  const value = candidate.sourceKind === 'quest_candidate'
    ? candidate.openedAtLsn
    : candidate.lastProgressLsn
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('attentionCandidateOrdering: source committed LSN must be a safe non-negative integer')
  }
  return value
}

/**
 * The source-committed-LSN key comparison — numeric safe-integer comparison in
 * both branches, never a UTF-16 / code-unit / lexicographic comparison of any
 * text. Key 3 has already separated the families, so both operands always share
 * a `sourceKind`; comparing them as numbers is nonetheless well defined across
 * families, because both values are committed log coordinates.
 */
function compareSourceCommittedLsn(left: AttentionCandidate, right: AttentionCandidate): number {
  return compareNumeric(sourceCommittedLsnOf(left), sourceCommittedLsnOf(right))
}

function sourceCommittedLsnValueOf(candidate: AttentionCandidate): string {
  return String(sourceCommittedLsnOf(candidate))
}

type OrderingKeyRule = readonly [
  AttentionCandidateOrderingKey,
  (left: AttentionCandidate, right: AttentionCandidate) => number,
  (candidate: AttentionCandidate) => string,
]

/** The ordering tuple, in the exact sequence the comparator applies it. */
const ORDERING_KEY_RULES: readonly OrderingKeyRule[] = Object.freeze<OrderingKeyRule[]>([
  [
    'eligibility',
    (l, r) => compareNumeric(l.eligibility === 'eligible' ? 0 : 1, r.eligibility === 'eligible' ? 0 : 1),
    (c) => String(c.eligibility === 'eligible' ? 0 : 1),
  ],
  ['proof-score', () => 0, () => String(ATTENTION_CANDIDATE_PROOF_SCORE)],
  [
    'source-kind',
    (l, r) => compareNumeric(attentionCandidateSourceKindRank(l.sourceKind), attentionCandidateSourceKindRank(r.sourceKind)),
    (c) => String(attentionCandidateSourceKindRank(c.sourceKind)),
  ],
  ['semantic-version', (l, r) => compareNumeric(semanticVersionOf(l), semanticVersionOf(r)), (c) => String(semanticVersionOf(c))],
  ['canonical-binding-tuple', (l, r) => compareByCodeUnit(bindingBytesOf(l), bindingBytesOf(r)), (c) => bindingBytesOf(c)],
  [
    'canonical-supporting-record-identity-tuple',
    (l, r) => compareByCodeUnit(supportingBytesOf(l), supportingBytesOf(r)),
    (c) => supportingBytesOf(c),
  ],
  ['source-committed-lsn', compareSourceCommittedLsn, sourceCommittedLsnValueOf],
  ['source-id', (l, r) => compareByCodeUnit(l.sourceId, r.sourceId), (c) => c.sourceId],
  ['candidate-id', (l, r) => compareByCodeUnit(l.candidateId, r.candidateId), (c) => c.candidateId],
])

/** The versioned key sequence, derived from the comparator table itself. */
export const ATTENTION_CANDIDATE_ORDERING_KEYS: readonly AttentionCandidateOrderingKey[] = Object.freeze(
  ORDERING_KEY_RULES.map(([key]) => key),
)

/**
 * One candidate's value at one ordering key, read from the same table the
 * comparator uses — so trusted trace v2 can record the complete nine-key tuple
 * per candidate without a second, independently drifting projection of it.
 */
export function attentionCandidateOrderingKeyValue(
  candidate: AttentionCandidate,
  key: AttentionCandidateOrderingKey,
): string {
  const rule = ORDERING_KEY_RULES.find(([ruleKey]) => ruleKey === key)
  if (rule === undefined) {
    throw new Error('attentionCandidateOrdering: unknown ordering key')
  }
  return rule[2](candidate)
}

/** The complete comparator: strict nine-key tuple order, no fallback. */
export function compareAttentionCandidates(left: AttentionCandidate, right: AttentionCandidate): number {
  for (const [, compare] of ORDERING_KEY_RULES) {
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
  for (const [key, compare] of ORDERING_KEY_RULES) {
    if (compare(left, right) !== 0) return key
  }
  return null
}

/**
 * Order candidates into the versioned nine-key total order, or refuse.
 *
 * The adjacent-pair check after sorting is what makes "total" a verified
 * property rather than an assumption: in a sorted sequence, two entries compare
 * equal somewhere if and only if some adjacent pair does. A tie that survives
 * every key is a typed refusal, never insertion order. The adjacent comparisons
 * are returned as ordering-trace evidence.
 */
export function orderAttentionCandidates(
  attentionCandidates: readonly AttentionCandidate[],
): AttentionCandidateOrderingResult {
  const orderedCandidates = [...attentionCandidates].sort(compareAttentionCandidates)

  const comparisons: AttentionCandidateOrderingComparison[] = []
  for (let index = 0; index < orderedCandidates.length - 1; index += 1) {
    const left = orderedCandidates[index]!
    const right = orderedCandidates[index + 1]!
    const decidingKey = resolveAttentionCandidateOrderingKey(left, right)
    if (decidingKey === null) {
      return { kind: 'refused', reason: 'ordering-tie-not-total' }
    }
    const cutoff = ATTENTION_CANDIDATE_ORDERING_KEYS.indexOf(decidingKey)
    const valueOf = ORDERING_KEY_RULES[cutoff]![2]
    comparisons.push(Object.freeze({
      leftCandidateId: left.candidateId,
      rightCandidateId: right.candidateId,
      evaluatedKeys: Object.freeze(ATTENTION_CANDIDATE_ORDERING_KEYS.slice(0, cutoff + 1)),
      decidingKey,
      leftValue: valueOf(left),
      rightValue: valueOf(right),
    }))
  }

  return {
    kind: 'ok',
    orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION,
    orderedCandidates: Object.freeze(orderedCandidates),
    comparisons: Object.freeze(comparisons),
  }
}
