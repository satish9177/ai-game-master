import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import type { AttentionReadableQuestCandidateView, QuestCandidate } from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import { constructAttentionReadableSurface } from './attentionQuestCandidateBoundary'
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
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
} as const

function readViews(candidates: readonly QuestCandidate[]): readonly AttentionReadableQuestCandidateView[] {
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates,
  })
  const result = readAttentionReadableQuestCandidateViews(snapshot, A1_REQUEST)
  if (result.kind !== 'ok') throw new Error('expected the A1 accessor to admit these fixtures')
  return result.views
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

/** Normalize through the only legal path: accessor mint -> A2 surface -> A3. */
function normalizeThroughSurface(
  views: readonly AttentionReadableQuestCandidateView[],
): readonly AttentionCandidate[] {
  const surface = constructAttentionReadableSurface(A1_REQUEST, views)
  if (surface.kind !== 'ok') throw new Error('expected A2 to accept accessor-minted views')
  const normalized = normalizeAttentionCandidates(surface.surface)
  if (normalized.kind !== 'ok') throw new Error('expected normalization to accept this surface')
  return normalized.attentionCandidates
}

function buildThreeCandidates(): readonly AttentionCandidate[] {
  return normalizeThroughSurface(readViews([
    openCandidate('quest-beta-open', 'consequence-public-b', 37),
    openCandidate('quest-alpha-open', 'consequence-public-a', 38),
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
  readonly candidateId: string
}): AttentionCandidate {
  const attentionCandidate: AttentionCandidate = {
    sourceKind: 'quest_candidate',
    sourceAuthority: 'authoritative',
    sourceId: fields.sourceId,
    candidateId: fields.candidateId,
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    openingProvenanceId: fields.openingProvenanceId,
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
  it('declares exactly the Stage A projection of the D14 key sequence', () => {
    expect(ATTENTION_CANDIDATE_ORDERING_KEYS).toEqual([
      'source-kind',
      'source-id',
      'opening-provenance-id',
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

  it('ranks source kinds from the versioned table', () => {
    // Stage A declares exactly one source kind, so this key can never decide a
    // Stage A comparison. It is asserted here so the table stays the thing the
    // comparator consults, and so Stage B's second kind is a policy edit.
    expect(ATTENTION_CANDIDATE_SOURCE_KIND_ORDER).toEqual(['quest_candidate'])
    expect(attentionCandidateSourceKindRank('quest_candidate')).toBe(0)
  })
})

describe('A3 / D14 — each tie level is forced and resolves at exactly that key', () => {
  it('resolves at source-id when the source candidate IDs differ', () => {
    const [alpha, beta] = orderedOrThrow(normalizeThroughSurface(readViews([
      openCandidate('quest-alpha-open', 'consequence-public-shared', 37),
      openCandidate('quest-beta-open', 'consequence-public-shared', 38),
    ])))
    if (alpha === undefined || beta === undefined) throw new Error('expected two ordered candidates')

    // Source kind ties (one Stage A kind); the opening provenance is identical,
    // so source-id is the first key that can decide.
    expect(alpha.openingProvenanceId).toBe(beta.openingProvenanceId)
    expect(resolveAttentionCandidateOrderingKey(alpha, beta)).toBe('source-id')
    expect([alpha.sourceId, beta.sourceId]).toEqual(['quest-alpha-open', 'quest-beta-open'])
  })

  it('resolves at opening-provenance-id when the source IDs also tie', () => {
    // Unreachable through normalization, which refuses a repeated source ID.
    const left = stubCandidate({
      sourceId: 'quest-shared',
      openingProvenanceId: 'consequence-public-a',
      candidateId: 'identity-z',
    })
    const right = stubCandidate({
      sourceId: 'quest-shared',
      openingProvenanceId: 'consequence-public-b',
      candidateId: 'identity-a',
    })

    expect(resolveAttentionCandidateOrderingKey(left, right)).toBe('opening-provenance-id')
    expect(orderedOrThrow([right, left]).map((candidate) => candidate.openingProvenanceId))
      .toEqual(['consequence-public-a', 'consequence-public-b'])
  })

  it('resolves at candidate-id when kind, source ID, and provenance all tie', () => {
    const left = stubCandidate({
      sourceId: 'quest-shared',
      openingProvenanceId: 'consequence-public-shared',
      candidateId: 'identity-a',
    })
    const right = stubCandidate({
      sourceId: 'quest-shared',
      openingProvenanceId: 'consequence-public-shared',
      candidateId: 'identity-b',
    })

    expect(resolveAttentionCandidateOrderingKey(left, right)).toBe('candidate-id')
    expect(orderedOrThrow([right, left]).map((candidate) => candidate.candidateId))
      .toEqual(['identity-a', 'identity-b'])
  })

  it('refuses rather than falling back to insertion order when every key ties', () => {
    const fields = {
      sourceId: 'quest-shared',
      openingProvenanceId: 'consequence-public-shared',
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
    const ordered = orderedOrThrow(normalizeThroughSurface(readViews([
      openCandidate('quest-alpha-open', 'consequence-public-a', 37),
      openCandidate('quest-Beta-open', 'consequence-public-b', 38),
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
      .toEqual({ kind: 'ok', orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION, orderedCandidates: [] })
    expect(orderedOrThrow(buildThreeCandidates().slice(0, 1)).map((candidate) => candidate.sourceId))
      .toEqual(['quest-alpha-open'])
  })
})
