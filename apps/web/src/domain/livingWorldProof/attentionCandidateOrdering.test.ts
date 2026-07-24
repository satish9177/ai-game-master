import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import type {
  AttentionReadableQuestCandidateView,
  AttentionReadableQuestOpeningCoordinateView,
  QuestCandidate,
} from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import {
  ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  constructAttentionReadableSurface,
} from './attentionReadableBoundary'
import { A1_RANKING_SNAPSHOT_LSN } from './attentionQuestCandidateScenario'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_ORDERING_VERSION,
  ATTENTION_CANDIDATE_SOURCE_KIND_ORDER,
} from './attentionCandidatePolicy'
import { normalizeAttentionCandidates } from './attentionCandidate'
import type { AttentionCandidate } from './attentionCandidate'
import {
  ATTENTION_CANDIDATE_ORDERING_KEYS,
  attentionCandidateSourceKindRank,
  compareAttentionCandidates,
  orderAttentionCandidates,
  resolveAttentionCandidateOrderingKey,
} from './attentionCandidateOrdering'

/**
 * A3 — the deterministic total order and its complete tie-break sequence.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D14 complete, stable, versioned total order; D6 identity is disjoint from
 *    ranking-only policy);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§13.1 "Total-order tie-break forcing family", D5-D12);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6 A3 ordering obligations, §9 A3 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * The forcing discipline of §13.1 is followed: each key case ties on every
 * earlier key and differs only at the key under test. Cases that cannot arise
 * through normalization — which refuses a repeated source ID before ordering
 * ever runs — are built directly from the exported normalized type, and say so;
 * the point of those fixtures is that the comparator provably consults the key,
 * so a later slice that widens what normalization admits still has a total
 * order rather than an insertion-order accident.
 */

const A1_REQUEST = {
  surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
} as const

interface AccessorProjection {
  readonly views: readonly AttentionReadableQuestCandidateView[]
  readonly openingCoordinateViews: readonly AttentionReadableQuestOpeningCoordinateView[]
}

function readViews(candidates: readonly QuestCandidate[]): AccessorProjection {
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates,
  })
  const result = readAttentionReadableQuestCandidateViews(snapshot, A1_REQUEST)
  if (result.kind !== 'ok') throw new Error('expected the A1 accessor to admit these fixtures')
  return { views: result.views, openingCoordinateViews: result.openingCoordinateViews }
}

function openCandidate(id: string, provenanceId: string, openedAtLsn: number): QuestCandidate {
  return createProofQuestCandidate({
    id,
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn,
    openingProvenance: { visibility: 'public', provenanceId },
    legallyVisibleParties: ['player'],
  })
}

/**
 * Normalize through the only legal path: accessor mint -> A-prime surface ->
 * the one common normalizer, which joins each legal view to its accessor-minted
 * opening-coordinate sidecar before any candidate exists (RN019 §4.3).
 */
function normalizeThroughSurface(projection: AccessorProjection): readonly AttentionCandidate[] {
  const surface = constructAttentionReadableSurface(
    A1_REQUEST,
    projection.views,
    projection.openingCoordinateViews,
    Object.freeze([]),
  )
  if (surface.kind !== 'ok') throw new Error('expected A2 to accept accessor-minted views')
  const normalized = normalizeAttentionCandidates(surface.surface)
  if (normalized.kind !== 'ok') throw new Error('expected normalization to accept this surface')
  return normalized.attentionCandidates
}

/**
 * Three distinct legal candidates whose numeric opening coordinates ascend with
 * their source IDs, so the expected sequence is unambiguous under the corrected
 * numeric key 7 (alpha 37 < beta 38 < gamma 39).
 */
function buildThreeCandidates(): readonly AttentionCandidate[] {
  return normalizeThroughSurface(readViews([
    openCandidate('quest-beta-open', 'consequence-public-b', 38),
    openCandidate('quest-alpha-open', 'consequence-public-a', 37),
    openCandidate('quest-gamma-open', 'consequence-public-g', 39),
  ]))
}

/**
 * A directly-built normalized candidate, for the tie levels normalization
 * cannot reach. Every field is stated so no fixture depends on a default.
 */
function stubCandidate(fields: {
  readonly sourceId: string
  readonly openingProvenanceId: string
  readonly openedAtLsn: number
  readonly candidateId: string
}): AttentionCandidate {
  const attentionCandidate: AttentionCandidate = {
    sourceKind: 'quest_candidate',
    sourceAuthority: 'authoritative',
    sourceId: fields.sourceId,
    candidateId: fields.candidateId,
    eligibility: 'eligible',
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    openingProvenanceId: fields.openingProvenanceId,
    openedAtLsn: fields.openedAtLsn,
    legallyVisibleParties: Object.freeze(['player']),
  }
  return Object.freeze(attentionCandidate)
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  const result: T[][] = []
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)]
    for (const permutation of permutations(rest)) {
      result.push([item, ...permutation])
    }
  })
  return result
}

function orderedOrThrow(attentionCandidates: readonly AttentionCandidate[]): readonly AttentionCandidate[] {
  const result = orderAttentionCandidates(attentionCandidates)
  if (result.kind !== 'ok') throw new Error('expected a total order over distinct candidates')
  return result.orderedCandidates
}

describe('A3 / D14 — the ordering tuple is versioned, complete, and applied in sequence', () => {
  it('declares exactly the complete nine-key D14 tuple in sequence', () => {
    expect(ATTENTION_CANDIDATE_ORDERING_KEYS).toEqual([
      'eligibility',
      'proof-score',
      'source-kind',
      'semantic-version',
      'canonical-binding-tuple',
      'canonical-supporting-record-identity-tuple',
      'source-committed-lsn',
      'source-id',
      'candidate-id',
    ])
  })

  it('pins an ordering version that is not an identity input', () => {
    const [attentionCandidate] = buildThreeCandidates()
    const result = orderAttentionCandidates(buildThreeCandidates())

    expect(result).toMatchObject({ kind: 'ok', orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION })
    // ADR-0013 D6: ranking-only policy must not reach candidate identity.
    expect(attentionCandidate?.candidateId.includes(ATTENTION_CANDIDATE_ORDERING_VERSION)).toBe(false)
  })

  it('ranks source kinds from the versioned two-family table', () => {
    // B4 adds the second family; the comparator consults this pinned table so
    // `quest_candidate < narrative_pattern_instance` is a visible policy value.
    expect(ATTENTION_CANDIDATE_SOURCE_KIND_ORDER).toEqual(['quest_candidate', 'narrative_pattern_instance'])
    expect(attentionCandidateSourceKindRank('quest_candidate')).toBe(0)
    expect(attentionCandidateSourceKindRank('narrative_pattern_instance')).toBe(1)
  })
})

describe('A3 / D14 — each tie level is forced and resolves at exactly that key', () => {
  it('resolves at source-committed-lsn when two legal quests differ only in their numeric opening LSN', () => {
    const [earlier, later] = orderedOrThrow(normalizeThroughSurface(readViews([
      // Authored so the *later* opening LSN carries the lexically smaller
      // provenance: only a numeric key 7 puts LSN 20 first.
      openCandidate('quest-lsn-later', 'consequence-public-a', 40),
      openCandidate('quest-lsn-earlier', 'consequence-public-z', 20),
    ])))
    if (earlier === undefined || later === undefined) throw new Error('expected two ordered candidates')
    if (earlier.sourceKind !== 'quest_candidate' || later.sourceKind !== 'quest_candidate') {
      throw new Error('expected quest candidates')
    }

    expect(resolveAttentionCandidateOrderingKey(earlier, later)).toBe('source-committed-lsn')
    expect([earlier.openedAtLsn, later.openedAtLsn]).toEqual([20, 40])
    expect([earlier.sourceId, later.sourceId]).toEqual(['quest-lsn-earlier', 'quest-lsn-later'])
  })

  it('resolves at source-id when two legal quests carry an equal numeric opening LSN', () => {
    const [alpha, beta] = orderedOrThrow(normalizeThroughSurface(readViews([
      openCandidate('quest-beta-open', 'consequence-public-beta', 37),
      openCandidate('quest-alpha-open', 'consequence-public-alpha', 37),
    ])))
    if (alpha === undefined || beta === undefined) throw new Error('expected two ordered candidates')
    if (alpha.sourceKind !== 'quest_candidate' || beta.sourceKind !== 'quest_candidate') {
      throw new Error('expected quest candidates')
    }

    // Eligibility, proof score, source kind, semantic version, binding and
    // supporting tuples all tie (both quests use the fixed sentinels), and the
    // numeric opening coordinates are *equal*, so key 8 (source-id) is the first
    // key that can decide. The provenance strings differ and are irrelevant.
    expect(alpha.openedAtLsn).toBe(beta.openedAtLsn)
    expect(alpha.openingProvenanceId).not.toBe(beta.openingProvenanceId)
    expect(resolveAttentionCandidateOrderingKey(alpha, beta)).toBe('source-id')
    expect([alpha.sourceId, beta.sourceId]).toEqual(['quest-alpha-open', 'quest-beta-open'])
  })

  it('resolves at candidate-id when kind, opening LSN, and source ID all tie', () => {
    const left = stubCandidate({
      sourceId: 'quest-shared',
      openingProvenanceId: 'consequence-public-shared',
      openedAtLsn: 37,
      candidateId: 'identity-a',
    })
    const right = stubCandidate({
      sourceId: 'quest-shared',
      openingProvenanceId: 'consequence-public-shared',
      openedAtLsn: 37,
      candidateId: 'identity-b',
    })

    expect(resolveAttentionCandidateOrderingKey(left, right)).toBe('candidate-id')
    expect(orderedOrThrow([right, left]).map((candidate) => candidate.candidateId))
      .toEqual(['identity-a', 'identity-b'])
  })

  it('never lets provenance text decide key 7: differing provenance with an equal LSN ties', () => {
    // Unreachable through normalization, which refuses a repeated source ID —
    // built directly so the comparator's own behaviour is the subject.
    const left = stubCandidate({
      sourceId: 'quest-shared',
      openingProvenanceId: 'consequence-public-a',
      openedAtLsn: 37,
      candidateId: 'identity-a',
    })
    const right = stubCandidate({
      sourceId: 'quest-shared',
      openingProvenanceId: 'consequence-public-z',
      openedAtLsn: 37,
      candidateId: 'identity-b',
    })

    // A comparator that compared provenance text would decide at key 7 here.
    expect(resolveAttentionCandidateOrderingKey(left, right)).toBe('candidate-id')
  })

  it('refuses rather than falling back to insertion order when every key ties', () => {
    const fields = {
      sourceId: 'quest-shared',
      openingProvenanceId: 'consequence-public-shared',
      openedAtLsn: 37,
      candidateId: 'identity-shared',
    }
    const left = stubCandidate(fields)
    const right = stubCandidate(fields)

    expect(left).not.toBe(right)
    expect(compareAttentionCandidates(left, right)).toBe(0)
    expect(resolveAttentionCandidateOrderingKey(left, right)).toBeNull()
    expect(orderAttentionCandidates([left, right]))
      .toEqual({ kind: 'refused', reason: 'ordering-tie-not-total' })
    expect(orderAttentionCandidates([right, left]))
      .toEqual({ kind: 'refused', reason: 'ordering-tie-not-total' })
  })
})

describe('A3 — the order is independent of insertion order and stable across runs', () => {
  it('produces the same sequence from every permutation of the same candidates', () => {
    const attentionCandidates = buildThreeCandidates()
    const byteForms = new Set<string>()

    const allPermutations = permutations(attentionCandidates)
    expect(allPermutations).toHaveLength(6)

    for (const permutation of allPermutations) {
      byteForms.add(canonicalSerialize(orderedOrThrow(permutation)))
    }

    expect(byteForms.size).toBe(1)
    expect(orderedOrThrow(attentionCandidates).map((candidate) => candidate.sourceId))
      .toEqual(['quest-alpha-open', 'quest-beta-open', 'quest-gamma-open'])
  })

  it('produces byte-identical output across repeated independent runs', () => {
    const byteForms = new Set<string>()

    for (let run = 0; run < 5; run += 1) {
      byteForms.add(canonicalSerialize(orderedOrThrow(buildThreeCandidates())))
    }

    expect(byteForms.size).toBe(1)
  })

  it('compares by UTF-16 code unit rather than by host collation', () => {
    // Code-unit order puts 'quest-Beta-open' before 'quest-alpha-open'; a
    // locale collator returns the opposite. The expectation is written as the
    // literal code-unit result rather than compared against a live collator,
    // because a collator's answer depends on the host's ICU data — the exact
    // dependency being excluded.
    // An equal numeric opening coordinate makes key 7 tie so source-id (key 8)
    // decides, isolating the code-unit-vs-collation comparison to that key.
    const ordered = orderedOrThrow(normalizeThroughSurface(readViews([
      openCandidate('quest-alpha-open', 'consequence-public-shared-alpha', 37),
      openCandidate('quest-Beta-open', 'consequence-public-shared-beta', 37),
    ])))

    expect(ordered.map((candidate) => candidate.sourceId)).toEqual(['quest-Beta-open', 'quest-alpha-open'])
  })
})

describe('A3 — ordering leaves its inputs untouched and returns an immutable result', () => {
  it('never sorts the caller\'s array in place', () => {
    const attentionCandidates = [...buildThreeCandidates()].reverse()
    const beforeBytes = canonicalSerialize(attentionCandidates)

    orderAttentionCandidates(attentionCandidates)

    expect(canonicalSerialize(attentionCandidates)).toBe(beforeBytes)
    expect(attentionCandidates.map((candidate) => candidate.sourceId))
      .toEqual(['quest-gamma-open', 'quest-beta-open', 'quest-alpha-open'])
  })

  it('freezes the ordered collection and leaves each candidate byte-identical', () => {
    const attentionCandidates = buildThreeCandidates()
    const beforeBytes = canonicalSerialize(attentionCandidates)
    const ordered = orderedOrThrow(attentionCandidates)

    expect(Object.isFrozen(ordered)).toBe(true)
    expect(canonicalSerialize(attentionCandidates)).toBe(beforeBytes)
    expect(canonicalSerialize([...ordered].sort((left, right) => (left.sourceId < right.sourceId ? -1 : 1))))
      .toBe(canonicalSerialize([...attentionCandidates].sort((left, right) => (left.sourceId < right.sourceId ? -1 : 1))))
  })

  it('orders an empty and a single-candidate set without refusing', () => {
    expect(orderAttentionCandidates([]))
      .toEqual({ kind: 'ok', orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION, orderedCandidates: [], comparisons: [] })
    expect(orderedOrThrow(buildThreeCandidates().slice(0, 1)).map((candidate) => candidate.sourceId))
      .toEqual(['quest-alpha-open'])
  })
})
