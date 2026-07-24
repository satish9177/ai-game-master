import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
  ATTENTION_QUEST_OPENING_COORDINATE_VIEW_KEYS,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
  isAccessorMintedAttentionReadableQuestOpeningCoordinateView,
  isStructurallyValidAttentionReadableQuestOpeningCoordinateView,
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
import type { AttentionReadableSurface } from './attentionReadableBoundary'
import { normalizeAttentionCandidates } from './attentionCandidate'
import {
  A1_RANKING_SNAPSHOT_LSN,
  buildAttentionQuestCandidateA1Scenario,
  buildAttentionQuestCandidateUnsafeOpeningLsnCandidate,
} from './attentionQuestCandidateScenario'
import { ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN } from './attentionStageAQuestOnlyGolden'

/**
 * Stage B / B4 — the quest opening-coordinate sidecar and its one-to-one join.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research`:
 *
 *  - `docs/research-notes/2026-07-23-019-narrative-pattern-instances-stage-b.md`
 *    (RN019 §4.3 the sidecar's closed four-field contract, its accessor-origin
 *    authority, and the seven typed join refusals; §9.2 key 7);
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D2/D3/D4 A-prime admission is accessor-origin, not structural legality);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-23-attention-ledger-replay-stage-b-implementation-plan.md`
 *    (§9 B4 obligations).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * **Why the sidecar exists.** RN019 §9.2 key 7 orders quest candidates by their
 * committed opening LSN. That coordinate is not on the committed legal quest
 * view — which carries only the opaque `openingProvenanceId` — and the legal
 * view may not widen, because its canonical bytes are frozen. The authoritative
 * `QuestCandidate` owns `openedAtLsn`, but the ordering module may not read an
 * authoritative record. The sidecar is the one legal route, and it carries
 * exactly the four fields RN019 fixes and nothing more.
 */

const A1_REQUEST = {
  surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
} as const

function accessorProjection(candidates: readonly QuestCandidate[]) {
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates,
  })
  const result = readAttentionReadableQuestCandidateViews(snapshot, A1_REQUEST)
  if (result.kind !== 'ok') throw new Error('expected the A1 accessor to admit these fixtures')
  return result
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
 * A surface built directly, not through the A-prime constructor.
 *
 * The join in `attentionCandidate.ts` is a *separate* guard from the boundary's
 * admission checks, and RN019 §4.3 requires each of its seven refusals to fire
 * on its own. Some of them — a forged sidecar, a duplicated one — the boundary
 * would reject first, so presenting the surface directly is the only way to
 * reach the join and prove it refuses independently rather than relying on an
 * upstream check.
 */
function directSurface(
  questCandidateViews: readonly AttentionReadableQuestCandidateView[],
  questOpeningCoordinateViews: readonly AttentionReadableQuestOpeningCoordinateView[],
): AttentionReadableSurface {
  return Object.freeze({
    surfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    questCandidateViews: Object.freeze([...questCandidateViews]),
    questOpeningCoordinateViews: Object.freeze([...questOpeningCoordinateViews]),
    patternEvidenceViews: Object.freeze([]),
  })
}

describe('B4 / RN019 §4.3 — the sidecar contract is exactly four fields, deeply frozen', () => {
  it('exposes exactly the closed four-field set and no other own key', () => {
    const { openingCoordinateViews } = accessorProjection([openCandidate('quest-a', 'consequence-public-a', 12)])
    const [sidecar] = openingCoordinateViews
    if (sidecar === undefined) throw new Error('expected one sidecar')

    expect(Object.keys(sidecar).sort()).toEqual([...ATTENTION_QUEST_OPENING_COORDINATE_VIEW_KEYS])
    expect(sidecar).toEqual({
      openingCoordinateContractVersion: ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
      candidateId: 'quest-a',
      openingProvenanceId: 'consequence-public-a',
      openedAtLsn: 12,
    })
    expect(ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION)
      .toBe('attention-quest-opening-coordinate-v1')
  })

  it('exposes no status, private party, secret detail, raw provenance object, or raw candidate', () => {
    const raw = createProofQuestCandidate({
      id: 'quest-secretive',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 12,
      openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-a' },
      legallyVisibleParties: ['player'],
      privateParties: ['confidant'],
      secretOpeningDetail: 'private-belief-overturn',
    })
    const { openingCoordinateViews } = accessorProjection([raw])
    const bytes = canonicalSerialize(openingCoordinateViews)

    // Field names are matched with their JSON quoting so a legal field whose
    // name merely contains a forbidden word (`openedAtLsn` contains "open")
    // cannot make this vacuous.
    for (const forbidden of [
      '"status"',
      '"resolved"',
      '"privateParties"',
      'confidant',
      '"secretOpeningDetail"',
      'private-belief-overturn',
      '"openingProvenance"',
      '"legallyVisibleParties"',
      '"type"',
    ]) {
      expect({ forbidden, present: bytes.includes(forbidden) }).toEqual({ forbidden, present: false })
    }
  })

  it('is deeply frozen and shares no mutable state with the authoritative record', () => {
    const raw = openCandidate('quest-a', 'consequence-public-a', 12)
    const { openingCoordinateViews } = accessorProjection([raw])
    const sidecar = openingCoordinateViews[0]!
    const before = canonicalSerialize(raw)

    expect(Object.isFrozen(openingCoordinateViews)).toBe(true)
    expect(Object.isFrozen(sidecar)).toBe(true)
    expect(() => {
      (sidecar as unknown as Record<string, unknown>).openedAtLsn = 99
    }).toThrow()
    expect(sidecar.openedAtLsn).toBe(12)
    expect(canonicalSerialize(raw)).toBe(before)
  })

  it('requires a safe, non-negative integer coordinate at the structural boundary', () => {
    for (const openedAtLsn of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isStructurallyValidAttentionReadableQuestOpeningCoordinateView({
        openingCoordinateContractVersion: ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
        candidateId: 'quest-a',
        openingProvenanceId: 'consequence-public-a',
        openedAtLsn,
      })).toBe(false)
    }
  })

  it('refuses any own key outside the closed set, rather than trimming it', () => {
    expect(isStructurallyValidAttentionReadableQuestOpeningCoordinateView({
      openingCoordinateContractVersion: ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
      candidateId: 'quest-a',
      openingProvenanceId: 'consequence-public-a',
      openedAtLsn: 12,
      secretOpeningDetail: 'private-belief-overturn',
    })).toBe(false)
  })
})

describe('B4 / RN019 §4.3 — accessor-only mint authority', () => {
  const genuine = accessorProjection([openCandidate('quest-a', 'consequence-public-a', 12)])
    .openingCoordinateViews[0]!

  it('accepts the genuine accessor mint that every forgery below imitates', () => {
    expect(isAccessorMintedAttentionReadableQuestOpeningCoordinateView(genuine)).toBe(true)
  })

  it('refuses a structurally legal object literal', () => {
    const literal = {
      openingCoordinateContractVersion: ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
      candidateId: 'quest-a',
      openingProvenanceId: 'consequence-public-a',
      openedAtLsn: 12,
    }

    // Structurally indistinguishable — and still refused, because A-prime
    // admission is accessor origin (D2/D4), never structural legality.
    expect(isStructurallyValidAttentionReadableQuestOpeningCoordinateView(literal)).toBe(true)
    expect(isAccessorMintedAttentionReadableQuestOpeningCoordinateView(literal)).toBe(false)
    expect(canonicalSerialize(literal)).toBe(canonicalSerialize(genuine))
  })

  it('refuses a spread copy of a genuine mint', () => {
    expect(isAccessorMintedAttentionReadableQuestOpeningCoordinateView({ ...genuine })).toBe(false)
    expect(isAccessorMintedAttentionReadableQuestOpeningCoordinateView(Object.assign({}, genuine))).toBe(false)
  })

  it('refuses a serialize/deserialize round-trip of a genuine mint', () => {
    const roundTripped = JSON.parse(JSON.stringify(genuine)) as unknown

    expect(isStructurallyValidAttentionReadableQuestOpeningCoordinateView(roundTripped)).toBe(true)
    expect(isAccessorMintedAttentionReadableQuestOpeningCoordinateView(roundTripped)).toBe(false)
  })

  it('cannot be forged by naming the marker, because the symbol is module-private', () => {
    // `Symbol.for` reaches only the global registry; this marker is a plain
    // module-private `Symbol()`, so no key written outside the contracts module
    // can name it. A descriptor clone *does* copy the symbol descriptor — that
    // is a deliberate property of the committed quest-view mint this contract
    // mirrors exactly (RN019 §4.3 names literal, spread, and round-trip as the
    // forgery classes), and it requires already holding a genuine mint, so it
    // widens nothing.
    const forgedKey = Symbol.for('attentionReadableQuestOpeningCoordinate.accessorMint')
    const impostor = {
      openingCoordinateContractVersion: ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
      candidateId: 'quest-a',
      openingProvenanceId: 'consequence-public-a',
      openedAtLsn: 12,
      [forgedKey]: true,
    }

    expect(isAccessorMintedAttentionReadableQuestOpeningCoordinateView(impostor)).toBe(false)
  })

  it('carries the marker as a single non-enumerable symbol, invisible to every observable surface', () => {
    expect(Object.getOwnPropertySymbols(genuine)).toHaveLength(1)
    expect([...Object.keys(genuine)].sort()).toEqual([...ATTENTION_QUEST_OPENING_COORDINATE_VIEW_KEYS])
    expect(JSON.stringify(genuine)).not.toContain('accessorMint')
    expect(canonicalSerialize(genuine)).not.toContain('accessorMint')
  })
})

describe('B4 / RN019 §4.3 — the one-to-one view/sidecar join and its seven typed refusals', () => {
  const candidates = [
    openCandidate('quest-a', 'consequence-public-a', 12),
    openCandidate('quest-b', 'consequence-public-b', 20),
  ]

  it('joins every legal view with exactly one sidecar, carrying the numeric coordinate through', () => {
    const { views, openingCoordinateViews } = accessorProjection(candidates)
    const normalized = normalizeAttentionCandidates(directSurface(views, openingCoordinateViews))
    if (normalized.kind !== 'ok') throw new Error(`expected the join to succeed, got ${normalized.reason}`)

    expect(normalized.attentionCandidates.map((candidate) => (
      candidate.sourceKind === 'quest_candidate' ? [candidate.sourceId, candidate.openedAtLsn] : null
    ))).toEqual([['quest-a', 12], ['quest-b', 20]])
  })

  it('refuses `missing-quest-opening-coordinate` when a legal view has no sidecar', () => {
    const { views, openingCoordinateViews } = accessorProjection(candidates)

    expect(normalizeAttentionCandidates(directSurface(views, [openingCoordinateViews[0]!])))
      .toEqual({ kind: 'refused', reason: 'missing-quest-opening-coordinate' })
    expect(normalizeAttentionCandidates(directSurface(views, [])))
      .toEqual({ kind: 'refused', reason: 'missing-quest-opening-coordinate' })
  })

  it('refuses `duplicate-quest-opening-coordinate` when two sidecars share a candidateId', () => {
    const { views, openingCoordinateViews } = accessorProjection(candidates)
    const duplicated = [openingCoordinateViews[0]!, openingCoordinateViews[0]!, openingCoordinateViews[1]!]

    expect(normalizeAttentionCandidates(directSurface(views, duplicated)))
      .toEqual({ kind: 'refused', reason: 'duplicate-quest-opening-coordinate' })
  })

  it('refuses `quest-opening-coordinate-identity-mismatch` when a sidecar matches no legal view', () => {
    const { views } = accessorProjection(candidates)
    const stranger = accessorProjection([openCandidate('quest-stranger', 'consequence-public-x', 5)])

    expect(normalizeAttentionCandidates(directSurface(
      views,
      [...accessorProjection(candidates).openingCoordinateViews, ...stranger.openingCoordinateViews],
    ))).toEqual({ kind: 'refused', reason: 'quest-opening-coordinate-identity-mismatch' })
  })

  it('refuses `quest-opening-provenance-mismatch` when view and sidecar disagree on provenance', () => {
    const { views } = accessorProjection(candidates)
    // Same candidateId, different legally readable opening provenance: the
    // accessor can mint this pair only from two different authoritative records,
    // so a disagreement is a genuine inconsistency rather than a repairable one.
    const mismatched = accessorProjection([
      openCandidate('quest-a', 'consequence-public-DIFFERENT', 12),
      openCandidate('quest-b', 'consequence-public-b', 20),
    ]).openingCoordinateViews

    expect(normalizeAttentionCandidates(directSurface(views, mismatched)))
      .toEqual({ kind: 'refused', reason: 'quest-opening-provenance-mismatch' })
  })

  it('refuses `unsafe-quest-opened-at-lsn` for a coordinate past the safe-integer ceiling', () => {
    // Reachable through the ordinary legal path: `createProofQuestCandidate`
    // accepts an integer past the safe ceiling, and the accessor mints its
    // sidecar, so this refusal is not pre-empted by an upstream check.
    const unsafe = buildAttentionQuestCandidateUnsafeOpeningLsnCandidate()
    const projection = accessorProjection([unsafe])

    expect(projection.openingCoordinateViews[0]!.openedAtLsn).toBe(Number.MAX_SAFE_INTEGER + 2)
    expect(normalizeAttentionCandidates(directSurface(projection.views, projection.openingCoordinateViews)))
      .toEqual({ kind: 'refused', reason: 'unsafe-quest-opened-at-lsn' })
  })

  it('refuses `unsupported-quest-opening-coordinate-version` for an unsupported contract version', () => {
    const { views, openingCoordinateViews } = accessorProjection([candidates[0]!])
    // A genuine mint whose version field is then overridden on a clone that
    // keeps the accessor marker, so version — not authority — is what refuses.
    const versionShifted = Object.create(
      Object.getPrototypeOf(openingCoordinateViews[0]!) as object,
      {
        ...Object.getOwnPropertyDescriptors(openingCoordinateViews[0]!),
        openingCoordinateContractVersion: {
          value: 'attention-quest-opening-coordinate-v2',
          enumerable: true,
          writable: false,
          configurable: false,
        },
        [Object.getOwnPropertySymbols(openingCoordinateViews[0]!)[0]!]: {
          value: true, enumerable: false, writable: false, configurable: false,
        },
      },
    ) as AttentionReadableQuestOpeningCoordinateView

    expect(isAccessorMintedAttentionReadableQuestOpeningCoordinateView(versionShifted)).toBe(true)
    expect(normalizeAttentionCandidates(directSurface(views, [versionShifted])))
      .toEqual({ kind: 'refused', reason: 'unsupported-quest-opening-coordinate-version' })
  })

  it('refuses `quest-opening-coordinate-not-accessor-minted` for a forged sidecar', () => {
    const { views } = accessorProjection([candidates[0]!])
    const forged = {
      openingCoordinateContractVersion: ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
      candidateId: 'quest-a',
      openingProvenanceId: 'consequence-public-a',
      openedAtLsn: 12,
    } as unknown as AttentionReadableQuestOpeningCoordinateView

    expect(normalizeAttentionCandidates(directSurface(views, [forged])))
      .toEqual({ kind: 'refused', reason: 'quest-opening-coordinate-not-accessor-minted' })
  })

  it('never repairs, defaults, or substitutes a sentinel for any of the seven refusals', () => {
    const { views, openingCoordinateViews } = accessorProjection(candidates)
    const before = canonicalSerialize([views, openingCoordinateViews])

    // Every refusal returns a typed reason and leaves its inputs byte-identical:
    // there is no partially-normalized candidate set, no fabricated coordinate,
    // and no fallback to provenance text.
    for (const sidecars of [[], [openingCoordinateViews[0]!, openingCoordinateViews[0]!]]) {
      const result = normalizeAttentionCandidates(directSurface(views, sidecars))
      expect(result.kind).toBe('refused')
      expect(result).not.toHaveProperty('attentionCandidates')
    }
    expect(canonicalSerialize([views, openingCoordinateViews])).toBe(before)
  })
})

describe('B4 / RN019 §4.3 — hidden and private candidates alter no sidecar', () => {
  it('produces neither a legal view nor a sidecar for a hidden-open or resolved candidate', () => {
    const publicOpen = openCandidate('quest-visible', 'consequence-public-a', 12)
    const hiddenOpen = createProofQuestCandidate({
      id: 'quest-hidden-open',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 13,
      openingProvenance: { visibility: 'private' },
      legallyVisibleParties: ['player'],
      secretOpeningDetail: 'unobserved-belief-overturn',
    })
    const unobserved = createProofQuestCandidate({
      id: 'quest-unobserved-open',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 14,
      openingProvenance: { visibility: 'unobserved' },
      legallyVisibleParties: ['player'],
    })
    const resolved = createProofQuestCandidate({
      id: 'quest-resolved',
      type: 'reputation_repair',
      status: 'resolved',
      openedAtLsn: 15,
      openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-r' },
      legallyVisibleParties: ['player'],
    })

    const withHidden = accessorProjection([publicOpen, hiddenOpen, unobserved, resolved])
    const withoutHidden = accessorProjection([publicOpen])

    // The sidecar is a projection of the same gated candidate set, so a record
    // that produces no legal view produces no sidecar either.
    expect(withHidden.openingCoordinateViews.map((sidecar) => sidecar.candidateId)).toEqual(['quest-visible'])
    expect(canonicalSerialize(withHidden.openingCoordinateViews))
      .toBe(canonicalSerialize(withoutHidden.openingCoordinateViews))
    expect(canonicalSerialize(withHidden.views)).toBe(canonicalSerialize(withoutHidden.views))
  })

  it('shifts no coordinate: the visible candidate keeps its own opening LSN either way', () => {
    const publicOpen = openCandidate('quest-visible', 'consequence-public-a', 12)
    const hiddenOpen = createProofQuestCandidate({
      id: 'quest-hidden-open',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 11,
      openingProvenance: { visibility: 'private' },
      legallyVisibleParties: ['player'],
    })

    expect(accessorProjection([publicOpen, hiddenOpen]).openingCoordinateViews[0]!.openedAtLsn).toBe(12)
    expect(accessorProjection([publicOpen]).openingCoordinateViews[0]!.openedAtLsn).toBe(12)
  })
})

describe('B4 — the committed legal quest view is byte-identical to Stage A', () => {
  it('pins the complete canonical quest legal-view bytes with the sidecar collection present', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const surface = constructAttentionReadableSurface(
      A1_REQUEST,
      scenario.views,
      scenario.openingCoordinateViews,
      Object.freeze([]),
    )
    if (surface.kind !== 'ok') throw new Error('expected the common A-prime surface')

    expect(surface.surface.questCandidateViews.map(canonicalSerialize))
      .toEqual(ATTENTION_STAGE_A_QUEST_ONLY_GOLDEN.completeCanonicalQuestViewBytes)
  })

  it('adds no field to the legal quest view: the numeric coordinate lives only on the sidecar', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()
    const view = scenario.views[0]!

    expect(Object.keys(view)).not.toContain('openedAtLsn')
    expect(Object.keys(view)).not.toContain('sourceCommittedLsn')
    expect(Object.keys(view)).not.toContain('openingCoordinateContractVersion')
    expect(scenario.openingCoordinateViews[0]!.openedAtLsn).toBe(37)
  })
})
