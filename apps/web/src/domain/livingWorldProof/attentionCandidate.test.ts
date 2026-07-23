import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import type { AttentionReadableQuestCandidateView, QuestCandidate } from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import {
  ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  constructAttentionReadableSurface,
} from './attentionReadableBoundary'
import type { AttentionReadableSurface } from './attentionReadableBoundary'
import { A1_RANKING_SNAPSHOT_LSN, buildAttentionQuestCandidateA1Scenario } from './attentionQuestCandidateScenario'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_RANKING_SNAPSHOT_LSN_MAX,
  ATTENTION_RANKING_SNAPSHOT_LSN_MIN,
} from './attentionCandidatePolicy'
import { computeAttentionCandidateIdentity } from './attentionCandidateIdentity'
import { normalizeAttentionCandidates } from './attentionCandidate'

/**
 * A3 — the normalized Stage A attention candidate.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D4 legal-view field set, D5 normalization preserving source kind and
 *    source authority, D6 identity);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§12 public/resolved `QuestCandidate` fixtures Q2/Q3, §11 hidden pair,
 *    §14 candidate identity fixtures);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6 A3 normalized-candidate obligations, §9 A3 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * Every candidate under test reaches normalization the only way A1/A2 allow:
 * raw proof candidate -> A1 accessor mint -> `constructAttentionReadableSurface`.
 * No fixture fabricates a view, so the accessor-origin authority A1/A2
 * established is exercised rather than bypassed.
 */

const A1_REQUEST = {
  surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
} as const

/** The closed normalized field set, for exact-shape assertions. */
const NORMALIZED_REQUIRED_KEYS = [
  'accessorContractVersion',
  'candidateId',
  'canonicalizationVersion',
  'identitySchemaVersion',
  'legallyVisibleParties',
  'openingProvenanceId',
  'rankingSnapshotLsn',
  'sourceAuthority',
  'sourceId',
  'sourceKind',
] as const

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

function buildSurface(views: readonly AttentionReadableQuestCandidateView[]): AttentionReadableSurface {
  const result = constructAttentionReadableSurface(A1_REQUEST, views, Object.freeze([]))
  if (result.kind !== 'ok') throw new Error('expected A2 to accept accessor-minted views')
  return result.surface
}

function normalizedOrThrow(surface: AttentionReadableSurface) {
  const result = normalizeAttentionCandidates(surface)
  if (result.kind !== 'ok') throw new Error('expected normalization to accept this surface')
  return result.attentionCandidates
}

describe('A3 / D5 — normalization preserves exactly the legal, source-authoritative fields', () => {
  it('projects one accessor-minted view into one normalized candidate', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const attentionCandidates = normalizedOrThrow(buildSurface(scenario.views))

    expect(attentionCandidates).toHaveLength(1)
    expect(attentionCandidates.map((candidate) => candidate.sourceId)).toEqual([...scenario.expectedVisibleCandidateIds])
  })

  it('carries the closed normalized field set and nothing else', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const [attentionCandidate] = normalizedOrThrow(buildSurface(scenario.views))
    if (attentionCandidate === undefined) throw new Error('expected one normalized candidate')

    expect(Object.keys(attentionCandidate).sort()).toEqual(
      [...NORMALIZED_REQUIRED_KEYS, 'legallyVisibleOriginConsequenceReference', 'legallyVisiblePublicStakes'].sort(),
    )
    expect(attentionCandidate).toEqual({
      sourceKind: 'quest_candidate',
      sourceAuthority: 'authoritative',
      sourceId: 'quest-public-open',
      candidateId: computeAttentionCandidateIdentity({
        sourceKind: 'quest_candidate',
        sourceId: 'quest-public-open',
        openingProvenanceId: 'consequence-public-37',
      }),
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
      identitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
      openingProvenanceId: 'consequence-public-37',
      legallyVisibleParties: ['player', 'warden'],
      legallyVisiblePublicStakes: 'restore-public-trust',
      legallyVisibleOriginConsequenceReference: 'consequence-public-37',
    })
  })

  it('omits an optional legal field that the view itself did not carry', () => {
    const views = readViews([
      createProofQuestCandidate({
        id: 'quest-minimal-open',
        type: 'reputation_repair',
        status: 'open',
        openedAtLsn: 40,
        openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-40' },
        legallyVisibleParties: ['player'],
        privateParties: ['informant'],
        secretOpeningDetail: 'private-belief-overturn',
      }),
    ])
    const [attentionCandidate] = normalizedOrThrow(buildSurface(views))
    if (attentionCandidate === undefined) throw new Error('expected one normalized candidate')

    expect(Object.keys(attentionCandidate).sort()).toEqual([...NORMALIZED_REQUIRED_KEYS].sort())
  })

  it('never carries a private field, a lifecycle value, or a raw opened-at coordinate', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const bytes = canonicalSerialize(normalizedOrThrow(buildSurface(scenario.views)))

    for (const forbidden of [
      'privateParties',
      'secretOpeningDetail',
      'warden-confidant',
      'private-belief-overturn',
      'openedAtLsn',
      'status',
      'resolved',
    ]) {
      expect({ forbidden, present: bytes.includes(forbidden) }).toEqual({ forbidden, present: false })
    }
  })

  it('preserves source kind and source authority, so a derived source could never be mistaken for this one', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const [attentionCandidate] = normalizedOrThrow(buildSurface(scenario.views))

    expect(attentionCandidate?.sourceKind).toBe('quest_candidate')
    expect(attentionCandidate?.sourceAuthority).toBe('authoritative')
  })

  it('canonicalizes the legally-visible party collection into the stated order', () => {
    const views = readViews([
      createProofQuestCandidate({
        id: 'quest-unsorted-parties',
        type: 'reputation_repair',
        status: 'open',
        openedAtLsn: 40,
        openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-40' },
        legallyVisibleParties: ['warden', 'player', 'merchant'],
      }),
    ])
    const [attentionCandidate] = normalizedOrThrow(buildSurface(views))

    expect(attentionCandidate?.legallyVisibleParties).toEqual(['merchant', 'player', 'warden'])
  })

  it('freezes every normalized candidate and the collection it returns', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const attentionCandidates = normalizedOrThrow(buildSurface(scenario.views))

    expect(Object.isFrozen(attentionCandidates)).toBe(true)
    expect(attentionCandidates.every((candidate) => Object.isFrozen(candidate))).toBe(true)
    expect(attentionCandidates.every((candidate) => Object.isFrozen(candidate.legallyVisibleParties))).toBe(true)
  })
})

describe('A3 — hidden-open and resolved candidates stay absent, exactly as A1/A2 left them', () => {
  it('normalizes only the publicly-opened candidate from the full A1 scenario', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const attentionCandidates = normalizedOrThrow(buildSurface(scenario.views))
    const bytes = canonicalSerialize(attentionCandidates)

    expect(attentionCandidates.map((candidate) => candidate.sourceId)).toEqual(['quest-public-open'])
    expect(bytes.includes('quest-hidden-open')).toBe(false)
    expect(bytes.includes('quest-resolved')).toBe(false)
  })

  it('leaves the raw candidates, the surface, and their canonical bytes unchanged', () => {
    const publicOpenCandidate = createProofQuestCandidate({
      id: 'quest-public-open',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 37,
      openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-37' },
      legallyVisibleParties: ['player', 'warden'],
      privateParties: ['warden-confidant'],
      secretOpeningDetail: 'private-belief-overturn',
    })
    const hiddenOpenCandidate = createProofQuestCandidate({
      id: 'quest-hidden-open',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 38,
      openingProvenance: { visibility: 'private' },
      legallyVisibleParties: ['player'],
    })
    const surface = buildSurface(readViews([publicOpenCandidate, hiddenOpenCandidate]))

    const rawBytesBefore = canonicalSerialize([publicOpenCandidate, hiddenOpenCandidate])
    const surfaceBytesBefore = canonicalSerialize(surface)

    normalizeAttentionCandidates(surface)

    expect(publicOpenCandidate.status).toBe('open')
    expect(hiddenOpenCandidate.status).toBe('open')
    expect(canonicalSerialize([publicOpenCandidate, hiddenOpenCandidate])).toBe(rawBytesBefore)
    expect(canonicalSerialize(surface)).toBe(surfaceBytesBefore)
    expect(surface.questCandidateViews).toHaveLength(1)
  })
})

describe('A3 / I1 — normalization is insertion-order independent and repeatable', () => {
  function buildThreeSurface(reversed: boolean): AttentionReadableSurface {
    const views = readViews([
      createProofQuestCandidate({
        id: 'quest-beta-open',
        type: 'reputation_repair',
        status: 'open',
        openedAtLsn: 37,
        openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-b' },
        legallyVisibleParties: ['player'],
      }),
      createProofQuestCandidate({
        id: 'quest-alpha-open',
        type: 'reputation_repair',
        status: 'open',
        openedAtLsn: 38,
        openingProvenance: { visibility: 'declassified', provenanceId: 'declassification-a' },
        legallyVisibleParties: ['player', 'warden'],
      }),
      createProofQuestCandidate({
        id: 'quest-gamma-open',
        type: 'reputation_repair',
        status: 'open',
        openedAtLsn: 39,
        openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-g' },
        legallyVisibleParties: ['merchant'],
      }),
    ])
    return buildSurface(reversed ? [...views].reverse() : views)
  }

  it('mints identical candidate identities whatever order the views arrive in', () => {
    const forward = normalizedOrThrow(buildThreeSurface(false))
    const reversed = normalizedOrThrow(buildThreeSurface(true))

    const identityBySource = (candidates: readonly { sourceId: string; candidateId: string }[]) =>
      canonicalSerialize(
        [...candidates].sort((left, right) => (left.sourceId < right.sourceId ? -1 : 1))
          .map((candidate) => [candidate.sourceId, candidate.candidateId]),
      )

    expect(identityBySource(reversed)).toBe(identityBySource(forward))
    expect(reversed.map((candidate) => candidate.sourceId).reverse())
      .toEqual(forward.map((candidate) => candidate.sourceId))
  })

  it('produces byte-identical output across repeated independent runs', () => {
    const byteForms = new Set<string>()

    for (let run = 0; run < 5; run += 1) {
      byteForms.add(canonicalSerialize(normalizedOrThrow(buildThreeSurface(false))))
    }

    expect(byteForms.size).toBe(1)
  })
})

describe('B1/A3 — duplicate and colliding identity inputs are typed refusals, never silent drops', () => {
  it('refuses a surface carrying two views for one engine-owned candidate', () => {
    const duplicated = createProofQuestCandidate({
      id: 'quest-duplicated',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 37,
      openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-37' },
      legallyVisibleParties: ['player'],
    })
    const result = constructAttentionReadableSurface(
      A1_REQUEST,
      readViews([duplicated, duplicated]),
      Object.freeze([]),
    )

    expect(result).toEqual({ kind: 'refused', reason: 'ambiguous-legal-identity' })
  })

  it('gives distinct engine-owned candidates distinct identities', () => {
    const attentionCandidates = normalizedOrThrow(
      buildSurface(readViews([
        createProofQuestCandidate({
          id: 'quest-alpha-open',
          type: 'reputation_repair',
          status: 'open',
          openedAtLsn: 37,
          openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-a' },
          legallyVisibleParties: ['player'],
        }),
        createProofQuestCandidate({
          id: 'quest-beta-open',
          type: 'reputation_repair',
          status: 'open',
          openedAtLsn: 38,
          openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-b' },
          legallyVisibleParties: ['player'],
        }),
      ])),
    )

    expect(new Set(attentionCandidates.map((candidate) => candidate.candidateId)).size).toBe(2)
  })

  /**
   * The `candidate-identity-collision` branch is deliberately retained and is
   * deliberately not forced by a fixture.
   *
   * Reaching it requires two *distinct* identity inputs whose canonical bytes
   * hash to one value. The rig's hash is FNV-1a-64, which its own header records
   * as explicitly non-cryptographic — so this is not an appeal to preimage
   * resistance. It is an appeal to work factor: locating any 64-bit collision
   * takes on the order of 2^32 hash evaluations by the birthday bound, and no
   * colliding pair is published for this rig's version-prefixed identity schema.
   * A fixture would therefore have to either search for hours or inject a fake
   * hash through a seam that exists only for the test — and adding such a seam
   * would put a production-reachable override on the one function whose purity
   * ADR-0013 D6 depends on.
   *
   * What is asserted instead, structurally:
   *
   *  - identity is injective over the fixture family (below), so no fixture
   *    silently relies on two candidates sharing an ID;
   *  - the guard's *mechanism* — detect a repeated identity, refuse before any
   *    candidate is emitted — is exercised by the reachable `duplicate-source-id`
   *    case above; the collision case differs only in why two IDs coincide;
   *  - the same invariant fails closed again one layer later:
   *    `attentionCandidateOrdering.test.ts` drives two distinct candidates that
   *    share a `candidateId` and asserts `ordering-tie-not-total`, so even a
   *    collision that somehow passed here could not silently produce an order.
   */
  it('mints an injective identity across a wider fixture family', () => {
    const attentionCandidates = normalizedOrThrow(buildSurface(readViews([
      createProofQuestCandidate({
        id: 'quest-alpha-open',
        type: 'reputation_repair',
        status: 'open',
        openedAtLsn: 37,
        openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-a' },
        legallyVisibleParties: ['player'],
      }),
      createProofQuestCandidate({
        id: 'quest-beta-open',
        type: 'reputation_repair',
        status: 'open',
        openedAtLsn: 38,
        openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-a' },
        legallyVisibleParties: ['player'],
      }),
      createProofQuestCandidate({
        id: 'quest-gamma-open',
        type: 'reputation_repair',
        status: 'open',
        openedAtLsn: 39,
        openingProvenance: { visibility: 'declassified', provenanceId: 'declassification-g' },
        legallyVisibleParties: ['merchant'],
      }),
      createProofQuestCandidate({
        id: 'quest-delta-open',
        type: 'reputation_repair',
        status: 'open',
        openedAtLsn: 40,
        openingProvenance: { visibility: 'declassified', provenanceId: 'declassification-d' },
        legallyVisibleParties: ['warden'],
      }),
    ])))

    expect(attentionCandidates).toHaveLength(4)
    expect(new Set(attentionCandidates.map((candidate) => candidate.candidateId)).size).toBe(4)
  })

  it('normalizes an empty surface into an empty candidate set rather than refusing', () => {
    const surface = buildSurface(readViews([
      createProofQuestCandidate({
        id: 'quest-hidden-only',
        type: 'reputation_repair',
        status: 'open',
        openedAtLsn: 37,
        openingProvenance: { visibility: 'unobserved' },
        legallyVisibleParties: ['player'],
      }),
    ]))

    expect(surface.questCandidateViews).toEqual([])
    expect(normalizeAttentionCandidates(surface)).toEqual({ kind: 'ok', attentionCandidates: [] })
  })
})

describe('A3 — the ranking snapshot coordinate is a checked bounded integer', () => {
  /**
   * Plan §6: "numeric scores use bounded integers with checked range validation
   * and a typed refusal on overflow", and "Zero/negative/overflow ... return a
   * typed ineligible/refusal outcome, never an unbounded fallback."
   *
   * A1 and A2 admit any non-negative integer, and `Number.isInteger(1e21)` is
   * true, so a coordinate past the safe-integer ceiling reaches normalization
   * fully constructed through the real accessor and A-prime path. Past that
   * ceiling adjacent integers stop being distinct Numbers, so two different
   * coordinates could compare and serialize identically — which is exactly the
   * overflow case the plan requires be refused rather than repaired. The
   * remaining shapes (NaN, +/-Infinity, fractional, negative) cannot reach here,
   * because A1/A2 reject them first; they are covered at the one A3 entry point
   * that does accept a raw coordinate, in `attentionCandidateCacheKey.test.ts`.
   */
  function surfaceAtCoordinate(rankingSnapshotLsn: number): AttentionReadableSurface {
    const request = {
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn,
    }
    const snapshot = createProofQuestCandidateSnapshot({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      snapshotLsn: rankingSnapshotLsn,
      candidates: [
        createProofQuestCandidate({
          id: 'quest-public-open',
          type: 'reputation_repair',
          status: 'open',
          openedAtLsn: 0,
          openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-0' },
          legallyVisibleParties: ['player'],
        }),
      ],
    })
    const views = readAttentionReadableQuestCandidateViews(snapshot, request)
    if (views.kind !== 'ok') throw new Error('expected the A1 accessor to admit this fixture')
    const surface = constructAttentionReadableSurface(
      { ...request, surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION },
      views.views,
      Object.freeze([]),
    )
    if (surface.kind !== 'ok') throw new Error('expected A2 to accept accessor-minted views')
    return surface.surface
  }

  it('accepts the pinned minimum coordinate', () => {
    expect(normalizeAttentionCandidates(surfaceAtCoordinate(ATTENTION_RANKING_SNAPSHOT_LSN_MIN)).kind).toBe('ok')
  })

  it('accepts the pinned maximum coordinate', () => {
    expect(normalizeAttentionCandidates(surfaceAtCoordinate(ATTENTION_RANKING_SNAPSHOT_LSN_MAX)).kind).toBe('ok')
  })

  it('accepts an ordinary in-range coordinate', () => {
    expect(normalizeAttentionCandidates(surfaceAtCoordinate(A1_RANKING_SNAPSHOT_LSN)).kind).toBe('ok')
  })

  it('refuses a coordinate past the safe-integer ceiling instead of clamping it', () => {
    const surface = surfaceAtCoordinate(1e21)

    expect(surface.rankingSnapshotLsn).toBe(1e21)
    expect(normalizeAttentionCandidates(surface))
      .toEqual({ kind: 'refused', reason: 'ranking-snapshot-lsn-out-of-range' })
  })

  it('leaves the surface and its views byte-identical after a refusal', () => {
    const surface = surfaceAtCoordinate(1e21)
    const before = canonicalSerialize(surface)

    expect(normalizeAttentionCandidates(surface).kind).toBe('refused')
    expect(canonicalSerialize(surface)).toBe(before)
    expect(surface.questCandidateViews).toHaveLength(1)
  })
})

describe('A3 — presentation eligibility is A-prime admission, and carries no extra field', () => {
  /**
   * Plan §6 lists "presentation eligibility" among the fields the normalized
   * candidate preserves, but pins neither a field name nor a value vocabulary
   * for it, and plan §9's A3 targeted-evidence list does not name it. ADR-0013
   * D9 makes eligibility a property of the tuple `(candidate, channel, revealer,
   * recipient, reveal_scope)` — three of whose coordinates (channel, revealer,
   * recipient/reveal scope) are A4 and Stage C capabilities that do not exist at
   * this slice and that this slice may not create.
   *
   * So no eligibility field is invented here. What Stage A *can* state, in the
   * plan's own terms, is that A-prime membership is the whole of the eligibility
   * fact available: plan §3 requires that "hidden/open candidates with no
   * accepted public/declassified opening provenance emit no view; resolved
   * candidates emit no open view", and ADR-0013 D4's admission gate is both
   * conditions at the pinned coordinate. Every normalized candidate is therefore
   * exactly an admitted A-prime member, and no other candidate exists to be
   * marked ineligible. These assertions record that correspondence so a reviewer
   * can check the claim rather than take it on trust; the missing decision is
   * reported alongside the slice.
   */
  it('normalizes exactly the A-prime membership set, one candidate per admitted view', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const surface = buildSurface(scenario.views)
    const attentionCandidates = normalizedOrThrow(surface)

    expect(attentionCandidates).toHaveLength(surface.questCandidateViews.length)
    expect(attentionCandidates.map((candidate) => candidate.sourceId))
      .toEqual(surface.questCandidateViews.map((view) => view.candidateId))
  })

  it('admits nothing that failed D4, and marks nothing ineligible, because A-prime holds no such member', () => {
    // The A1 scenario feeds three raw candidates: public/open, hidden/open, and
    // resolved. Only the first is an A-prime member, so only it is normalized —
    // the other two are absent rather than present-and-flagged.
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const attentionCandidates = normalizedOrThrow(buildSurface(scenario.views))

    expect(attentionCandidates.map((candidate) => candidate.sourceId)).toEqual(['quest-public-open'])
    expect(attentionCandidates.every((candidate) => candidate.openingProvenanceId.trim().length > 0)).toBe(true)
  })

  it('carries no eligibility, verdict, annotation, or gate field on the normalized candidate', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const [attentionCandidate] = normalizedOrThrow(buildSurface(scenario.views))
    if (attentionCandidate === undefined) throw new Error('expected one normalized candidate')

    for (const absent of [
      'presentationEligibility',
      'eligibility',
      'eligible',
      'monitorVerdict',
      'narrativeAnnotation',
      'gate',
    ]) {
      expect({ absent, present: Object.keys(attentionCandidate).includes(absent) })
        .toEqual({ absent, present: false })
    }
  })
})
