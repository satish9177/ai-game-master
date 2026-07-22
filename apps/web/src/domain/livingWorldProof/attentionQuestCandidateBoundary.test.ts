import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import type { AttentionReadableQuestCandidateView } from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import { A1_RANKING_SNAPSHOT_LSN } from './attentionQuestCandidateScenario'
import { constructAttentionReadableSurface } from './attentionQuestCandidateBoundary'

/**
 * A2 / S2 — A-prime construction closure.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§8 "S2 — A′-construction closure");
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D2 surface enumeration, D3 type-level admission, D4 accessor contract,
 *    D20 item 2);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§5 A2 obligations, §9 A2 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * Type-shaped evidence bears the proof: every excluded A-domain input class is
 * asserted `@ts-expect-error` at the constructor's accepted input type, using
 * the compile-negative idiom this proof rig already uses
 * (`attributionBuilder.test.ts`) — checked by the existing `tsc -b` build, with
 * no separate compiler project. Runtime refusal corroborates it.
 *
 * D2 admits into A′ only views "obtained from the engine-owned snapshot
 * accessor", so the closure has two independent halves and both are exercised:
 *
 *  - *shape* — a value carrying any own field outside the closed legal set is
 *    refused rather than trimmed. Width subtyping means TypeScript alone cannot
 *    reject this class; the exhaustive own-key check closes it;
 *  - *origin* — a value the A1 accessor did not mint is refused however legal
 *    its shape, at the type level through the module-private nominal marker and
 *    at runtime through the accessor-mint check.
 */

const A1_REQUEST = {
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
} as const

function buildA1Sources() {
  const publicOpenCandidate = createProofQuestCandidate({
    id: 'quest-public-open',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 37,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-37' },
    legallyVisibleParties: ['player', 'warden'],
    legallyVisiblePublicStakes: 'restore-public-trust',
    legallyVisibleOriginConsequenceReference: 'consequence-public-37',
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
    privateParties: ['warden'],
    secretOpeningDetail: 'unobserved-belief-overturn',
  })
  const resolvedCandidate = createProofQuestCandidate({
    id: 'quest-resolved',
    type: 'reputation_repair',
    status: 'resolved',
    openedAtLsn: 39,
    openingProvenance: { visibility: 'declassified', provenanceId: 'declassification-39' },
    legallyVisibleParties: ['player', 'merchant'],
    legallyVisiblePublicStakes: 'repair-merchant-standing',
    privateParties: ['merchant-confidant'],
    secretOpeningDetail: 'resolved-private-opening-detail',
  })
  const snapshot = createProofQuestCandidateSnapshot({
    accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    candidates: [resolvedCandidate, hiddenOpenCandidate, publicOpenCandidate],
  })

  return { publicOpenCandidate, hiddenOpenCandidate, resolvedCandidate, snapshot }
}

function canonicalSourceBytes(sources: ReturnType<typeof buildA1Sources>): string {
  return canonicalSerialize({
    publicOpenCandidate: sources.publicOpenCandidate,
    hiddenOpenCandidate: sources.hiddenOpenCandidate,
    resolvedCandidate: sources.resolvedCandidate,
  })
}

function expectSourceLifecycleAndBytesUnchanged(
  sources: ReturnType<typeof buildA1Sources>,
  before: string,
): void {
  expect(sources.publicOpenCandidate.status).toBe('open')
  expect(sources.hiddenOpenCandidate.status).toBe('open')
  expect(sources.resolvedCandidate.status).toBe('resolved')
  expect(canonicalSourceBytes(sources)).toBe(before)
}

function readLegalViews(sources: ReturnType<typeof buildA1Sources>): readonly AttentionReadableQuestCandidateView[] {
  const result = readAttentionReadableQuestCandidateViews(sources.snapshot, A1_REQUEST)
  if (result.kind !== 'ok') throw new Error('expected the A1 accessor to admit its public candidate')
  return result.views
}

/**
 * Only an explicit cast can present a non-view to the constructor at all. The
 * compile-negative blocks below are what prove the cast is required; this
 * helper exists so the runtime-refusal blocks can still reach the constructor.
 */
function asViewList(values: readonly unknown[]): readonly AttentionReadableQuestCandidateView[] {
  return values as unknown as readonly AttentionReadableQuestCandidateView[]
}

function containsRawCandidateOrSnapshot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) return value.some((item) => containsRawCandidateOrSnapshot(item))

  const record = value as Record<string, unknown>
  if ('candidates' in record || ('status' in record && 'openingProvenance' in record && 'privateParties' in record)) {
    return true
  }
  return Object.values(record).some((nested) => containsRawCandidateOrSnapshot(nested))
}

// ---- Excluded A-domain input classes (Attention Ledger Replay v0 §8) -------
// Declared once, used by both the compile-negative and the runtime-refusal
// blocks below so the two can never silently drift apart.

const genericAuthoritativeRecord = { recordId: 'rec-1', kind: 'authoritative-record', payload: { candidateId: 'quest-public-open' } }
const serializedEnvelope = { envelopeKind: 'quest_candidate', version: 1, body: '{"candidateId":"quest-public-open"}' }
const privateBelief = { beliefId: 'Bel_1', holder: 'warden', proposition: 'player-betrayed-warden', private: true }
const privateIntentionCommitment = { commitmentId: 'IC_1', holder: 'warden', goal: 'confront-player', status: 'adopted' }
const unreadableTruthEvent = { truthEventId: 'TE_1', observedBy: [], predicate: 'stole', subject: 'player' }
const attentionLedgerRecord = { ledgerSeq: 1, candidateId: 'quest-public-open', exposureCount: 2, outcome: 'presented' }
const engineOnlyDiagnostic = { diagnosticKind: 'resource_limit_exceeded', engineOnly: true, detail: 'density-budget' }

// ---- Forged legal-shaped views the A1 accessor never minted ----------------
// Every field below is invented. Each literal carries the complete legal field
// set, so before the accessor-origin marker existed each one type-checked with
// no cast and was accepted by A′ — re-admitting candidates that D4's lifecycle
// and opening-provenance gates exclude.

const forgedNeverExistingView = {
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
  candidateId: 'quest-never-existed',
  openingProvenanceId: 'provenance-never-existed',
  legallyVisibleParties: ['party-never-existed'],
  legallyVisiblePublicStakes: 'stakes-never-existed',
  legallyVisibleOriginConsequenceReference: 'consequence-never-existed',
}

// A private-provenance candidate has no legal opening-provenance id at all, so
// the accessor mints no view for it (ADR-0013 D4).
const forgedHiddenOpenView = {
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
  candidateId: 'quest-hidden-open',
  openingProvenanceId: 'unobserved-belief-overturn',
  legallyVisibleParties: ['player'],
}

// A resolved candidate emits no open view (ADR-0013 D4).
const forgedResolvedView = {
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
  candidateId: 'quest-resolved',
  openingProvenanceId: 'declassification-39',
  legallyVisibleParties: ['player', 'merchant'],
}

describe('A2 / S2 — A-prime is constructed only from A1 legal views', () => {
  it('builds A-prime through the approved A1 accessor, carrying the public open view only', () => {
    const sources = buildA1Sources()
    const before = canonicalSourceBytes(sources)

    const result = constructAttentionReadableSurface(A1_REQUEST, readLegalViews(sources))

    expect(result).toEqual({
      kind: 'ok',
      surface: {
        accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
        rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
        questCandidateViews: [{
          accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
          rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
          candidateId: 'quest-public-open',
          openingProvenanceId: 'consequence-public-37',
          legallyVisibleParties: ['player', 'warden'],
          legallyVisiblePublicStakes: 'restore-public-trust',
          legallyVisibleOriginConsequenceReference: 'consequence-public-37',
        }],
      },
    })
    expectSourceLifecycleAndBytesUnchanged(sources, before)
  })

  it('keeps hidden-open and resolved candidates, private parties, and secret opening detail out of A-prime', () => {
    const sources = buildA1Sources()
    const before = canonicalSourceBytes(sources)

    const result = constructAttentionReadableSurface(A1_REQUEST, readLegalViews(sources))

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected an A-prime surface')
    expect(result.surface.questCandidateViews.map((view) => view.candidateId)).toEqual(['quest-public-open'])
    const serializedSurface = JSON.stringify(result.surface)
    expect(serializedSurface).not.toContain('quest-hidden-open')
    expect(serializedSurface).not.toContain('quest-resolved')
    expect(serializedSurface).not.toContain('warden-confidant')
    expect(serializedSurface).not.toContain('private-belief-overturn')
    expect(serializedSurface).not.toContain('unobserved-belief-overturn')
    expect(containsRawCandidateOrSnapshot(result.surface)).toBe(false)
    expect(result.surface.questCandidateViews[0]).not.toHaveProperty('privateParties')
    expect(result.surface.questCandidateViews[0]).not.toHaveProperty('secretOpeningDetail')
    expect(result.surface.questCandidateViews[0]).not.toHaveProperty('status')
    expectSourceLifecycleAndBytesUnchanged(sources, before)
  })

  it('preserves the accessor order and retains the accessor-minted views themselves', () => {
    const sources = buildA1Sources()
    const extraCandidate = createProofQuestCandidate({
      id: 'quest-alpha-open',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 40,
      openingProvenance: { visibility: 'declassified', provenanceId: 'declassification-40' },
      legallyVisibleParties: ['player'],
    })
    const snapshot = createProofQuestCandidateSnapshot({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
      candidates: [...sources.snapshot.candidates, extraCandidate],
    })
    const accessed = readAttentionReadableQuestCandidateViews(snapshot, A1_REQUEST)
    if (accessed.kind !== 'ok') throw new Error('expected legal views')

    const first = constructAttentionReadableSurface(A1_REQUEST, accessed.views)
    const second = constructAttentionReadableSurface(A1_REQUEST, accessed.views)

    if (first.kind !== 'ok' || second.kind !== 'ok') throw new Error('expected two A-prime surfaces')
    // Accessor order is preserved verbatim; A2 introduces no ordering policy.
    expect(first.surface.questCandidateViews.map((view) => view.candidateId))
      .toEqual(accessed.views.map((view) => view.candidateId))
    expect(first.surface.questCandidateViews.map((view) => view.candidateId))
      .toEqual(['quest-alpha-open', 'quest-public-open'])
    expect(first).toEqual(second)
    // The surface and its array are built fresh on every construction ...
    expect(first.surface).not.toBe(second.surface)
    expect(first.surface.questCandidateViews).not.toBe(second.surface.questCandidateViews)
    // ... while the deeply frozen minted views are retained rather than
    // rebuilt, so the accessor-origin mark survives into A′ (ADR-0013 D2).
    // Sharing them is safe precisely because they are frozen and expose only
    // the legal field set.
    expect(first.surface.questCandidateViews[0]).toBe(accessed.views[0])
    expect(second.surface.questCandidateViews[0]).toBe(accessed.views[0])
    expect(Object.isFrozen(first.surface.questCandidateViews[0])).toBe(true)
    expect(Object.isFrozen(first.surface.questCandidateViews[0]!.legallyVisibleParties)).toBe(true)
  })

  it('refuses a stale or mismatched accessor version or ranking snapshot coordinate instead of repairing it', () => {
    const sources = buildA1Sources()
    const before = canonicalSourceBytes(sources)
    const views = readLegalViews(sources)

    expect(constructAttentionReadableSurface(
      { accessorContractVersion: 'unknown-accessor-version', rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN },
      views,
    )).toEqual({ kind: 'refused', reason: 'accessor-contract-version-mismatch' })
    expect(constructAttentionReadableSurface(
      { accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION, rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN + 1 },
      views,
    )).toEqual({ kind: 'refused', reason: 'ranking-snapshot-lsn-mismatch' })
    expect(constructAttentionReadableSurface(
      { accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION, rankingSnapshotLsn: undefined as never },
      views,
    )).toEqual({ kind: 'refused', reason: 'ranking-snapshot-lsn-mismatch' })
    expectSourceLifecycleAndBytesUnchanged(sources, before)
  })

  it('refuses genuinely minted views pinned to a ranking snapshot other than the request', () => {
    // Minted at A1_RANKING_SNAPSHOT_LSN, presented at a later coordinate, with
    // no forgery involved — this exercises the per-view coordinate check on
    // real accessor output. The sibling per-view accessor-version check is
    // defence in depth and is unreachable through this seam: A1 refuses any
    // snapshot not at the pinned version, so no view can carry a different one.
    const sources = buildA1Sources()
    const views = readLegalViews(sources)

    expect(constructAttentionReadableSurface(
      {
        accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
        rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN + 1,
      },
      views,
    )).toEqual({ kind: 'refused', reason: 'ranking-snapshot-lsn-mismatch' })
  })
})

describe('A2 / S2 [compile-time type tests] — excluded A-domain inputs do not type-check at the A-prime boundary', () => {
  it('a raw QuestCandidate and a raw proof snapshot are not AttentionReadableQuestCandidateViews', () => {
    const sources = buildA1Sources()
    // @ts-expect-error -- S2: the raw authoritative QuestCandidate is not a legal view; it must never cross A -> A'.
    const rawCandidateAsView: AttentionReadableQuestCandidateView = sources.publicOpenCandidate
    // @ts-expect-error -- S2: the raw candidate snapshot (which holds raw candidates) is not a legal view.
    const rawSnapshotAsView: AttentionReadableQuestCandidateView = sources.snapshot
    void rawCandidateAsView
    void rawSnapshotAsView
  })

  it('the A-prime constructor accepts no raw-candidate list', () => {
    const sources = buildA1Sources()
    // @ts-expect-error -- S2: a list of raw QuestCandidates is not a legal-view list, so the constructor cannot be called with one.
    const rawCandidateViews: readonly AttentionReadableQuestCandidateView[] = [sources.publicOpenCandidate]
    void rawCandidateViews
  })

  it('the accessor result union (which may be a typed refusal) cannot be passed as a legal-view list', () => {
    const sources = buildA1Sources()
    const accessResult = readAttentionReadableQuestCandidateViews(sources.snapshot, A1_REQUEST)
    // @ts-expect-error -- S2: only the accessor's admitted `views` may feed A'; the result union itself may not.
    const unionAsViews: readonly AttentionReadableQuestCandidateView[] = accessResult
    void unionAsViews
  })

  it('generic authoritative records, envelopes, private cognition, unreadable truth, ledger records, and diagnostics do not type-check', () => {
    // @ts-expect-error -- S2: a generic authoritative record is not a legal view.
    const genericRecordAsView: AttentionReadableQuestCandidateView = genericAuthoritativeRecord
    // @ts-expect-error -- S2: a serialized record envelope lacking authoritative semantic provenance is not a legal view.
    const envelopeAsView: AttentionReadableQuestCandidateView = serializedEnvelope
    // @ts-expect-error -- S2: a holder-private Belief is not a legal view.
    const beliefAsView: AttentionReadableQuestCandidateView = privateBelief
    // @ts-expect-error -- S2: a private IntentionCommitment is not a legal view.
    const intentionAsView: AttentionReadableQuestCandidateView = privateIntentionCommitment
    // @ts-expect-error -- S2: an unobserved/unreadable TruthEvent is not a legal view.
    const truthEventAsView: AttentionReadableQuestCandidateView = unreadableTruthEvent
    // @ts-expect-error -- S2: an Attention Ledger (C) record is not a legal view and may never enter A'.
    const ledgerAsView: AttentionReadableQuestCandidateView = attentionLedgerRecord
    // @ts-expect-error -- S2: an engine-only diagnostic is not a legal view.
    const diagnosticAsView: AttentionReadableQuestCandidateView = engineOnlyDiagnostic
    void genericRecordAsView
    void envelopeAsView
    void beliefAsView
    void intentionAsView
    void truthEventAsView
    void ledgerAsView
    void diagnosticAsView
  })
})

describe('A2 / D2 [compile-time type tests] — a structurally legal forgery is not an attention-readable view', () => {
  it('rejects fabricated views carrying every legal field, with no cast anywhere', () => {
    // This is precisely the block that compiled before the accessor-origin
    // marker existed: each literal carries the complete legal field set and was
    // therefore assignable. What refuses them now is the plain assignment
    // itself — there is no cast, no helper, and no runtime call involved.
    // @ts-expect-error -- D2: a fabricated view for a candidate that never existed was not minted by the A1 accessor.
    const neverExisting: AttentionReadableQuestCandidateView = forgedNeverExistingView
    // @ts-expect-error -- D2/D4: a fabricated hidden-open view was never minted; its candidate has no legal opening provenance.
    const hiddenOpen: AttentionReadableQuestCandidateView = forgedHiddenOpenView
    // @ts-expect-error -- D2/D4: a fabricated resolved-candidate view was never minted; a resolved candidate emits no open view.
    const resolved: AttentionReadableQuestCandidateView = forgedResolvedView
    void neverExisting
    void hiddenOpen
    void resolved
  })

  it('rejects a fabricated legal-view list at the constructor parameter itself', () => {
    // @ts-expect-error -- D2: forged views cannot be presented as a legal-view list, so the constructor cannot be called with them.
    const forgedList: readonly AttentionReadableQuestCandidateView[] = [forgedNeverExistingView]
    void forgedList
  })

  it('is not, by itself, sufficient: TypeScript still treats a spread copy as branded', () => {
    const legalView = readLegalViews(buildA1Sources())[0]!
    // Deliberately no `@ts-expect-error`: TypeScript models object spread as
    // copying every property including the marker, so this assignment compiles.
    // JavaScript does not — a non-enumerable symbol is not spread — so the copy
    // is unmarked at runtime. This is exactly why the origin check is enforced
    // at runtime as well as in the type, and the runtime block below refuses it.
    const copiedView: AttentionReadableQuestCandidateView = { ...legalView }
    void copiedView
  })
})

describe('A2 / D2 [runtime corroboration] — forged legal-shaped views are refused by the A-prime constructor', () => {
  const forgeries: [string, unknown][] = [
    ['a plain object literal carrying every legal field', forgedNeverExistingView],
    ['a fabricated never-existing candidate view', forgedNeverExistingView],
    ['a fabricated hidden-open candidate view', forgedHiddenOpenView],
    ['a fabricated resolved-candidate view', forgedResolvedView],
  ]

  it.each(forgeries)('refuses %s as not accessor-minted', (_label, forged) => {
    const result = constructAttentionReadableSurface(A1_REQUEST, asViewList([forged]))

    expect(result).toEqual({ kind: 'refused', reason: 'input-not-accessor-minted' })
    expect(result).not.toHaveProperty('surface')
  })

  it('refuses a spread copy of a genuine accessor-minted view', () => {
    // The class the type cannot catch: TypeScript treats spread as preserving
    // the marker, but a non-enumerable symbol is not actually copied, so the
    // copy is unmarked. Note this needs no cast — it compiles — which is why
    // the runtime origin check has to exist.
    const legalView = readLegalViews(buildA1Sources())[0]!
    const copiedView: AttentionReadableQuestCandidateView = { ...legalView }

    const result = constructAttentionReadableSurface(A1_REQUEST, [copiedView])

    expect(result).toEqual({ kind: 'refused', reason: 'input-not-accessor-minted' })
    expect(result).not.toHaveProperty('surface')
  })

  it('fails closed when a forgery is presented alongside a genuine minted view', () => {
    const sources = buildA1Sources()
    const genuine = readLegalViews(sources)[0]!

    const result = constructAttentionReadableSurface(A1_REQUEST, asViewList([genuine, forgedHiddenOpenView]))

    // One forgery refuses the whole surface; there is no partial admission.
    expect(result).toEqual({ kind: 'refused', reason: 'input-not-accessor-minted' })
    expect(result).not.toHaveProperty('surface')
  })

  it('admits the genuine accessor-minted view that those forgeries imitate', () => {
    // Positive control: the refusals above turn on origin, not on shape — an
    // identically shaped view that the accessor did mint is accepted.
    const sources = buildA1Sources()

    const result = constructAttentionReadableSurface(A1_REQUEST, readLegalViews(sources))

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected an A-prime surface')
    expect(result.surface.questCandidateViews.map((view) => view.candidateId)).toEqual(['quest-public-open'])
  })
})

describe('A2 / D2 — the accessor-origin marker is invisible on every observable surface', () => {
  const LEGAL_VIEW_KEYS = [
    'accessorContractVersion',
    'rankingSnapshotLsn',
    'candidateId',
    'openingProvenanceId',
    'legallyVisibleParties',
    'legallyVisiblePublicStakes',
    'legallyVisibleOriginConsequenceReference',
  ]

  function buildSurface() {
    const result = constructAttentionReadableSurface(A1_REQUEST, readLegalViews(buildA1Sources()))
    if (result.kind !== 'ok') throw new Error('expected an A-prime surface')
    return result.surface
  }

  it('exposes exactly the legal string-keyed fields and nothing else', () => {
    const view = buildSurface().questCandidateViews[0]!

    expect(Object.keys(view).sort()).toEqual([...LEGAL_VIEW_KEYS].sort())
    expect(Object.entries(view).map(([key]) => key).sort()).toEqual([...LEGAL_VIEW_KEYS].sort())
    for (const key in view) {
      expect(LEGAL_VIEW_KEYS).toContain(key)
    }
  })

  it('carries the mark as a single non-enumerable symbol holding no candidate data', () => {
    const view = buildSurface().questCandidateViews[0]!
    const symbols = Object.getOwnPropertySymbols(view)

    expect(symbols).toHaveLength(1)
    const marker = symbols[0]!
    // Non-enumerable, non-writable, non-configurable: invisible to every
    // enumeration path, and the mark is a bare `true` — it records origin,
    // never candidate content.
    expect(Object.getOwnPropertyDescriptor(view, marker)).toEqual({
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    })
    expect(String(marker.description)).not.toContain('quest-public-open')
    expect(String(marker.description)).not.toContain('warden')
  })

  it('does not appear in JSON or canonical serialized output', () => {
    const surface = buildSurface()
    const view = surface.questCandidateViews[0]!

    const serialized = JSON.stringify(surface)
    expect(serialized).not.toContain('accessorMint')
    expect(serialized).not.toContain('Symbol')
    expect(canonicalSerialize(surface)).not.toContain('accessorMint')

    // Canonical bytes are exactly those of the legal fields alone, so the
    // marker changes no A′ byte and cannot perturb later replay comparisons.
    expect(canonicalSerialize(view)).toBe(canonicalSerialize({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
      candidateId: 'quest-public-open',
      openingProvenanceId: 'consequence-public-37',
      legallyVisibleParties: ['player', 'warden'],
      legallyVisiblePublicStakes: 'restore-public-trust',
      legallyVisibleOriginConsequenceReference: 'consequence-public-37',
    }))
  })

  it('leaves repeated accessor reads and A-prime constructions deterministic and frozen', () => {
    const sources = buildA1Sources()
    expect(canonicalSerialize(readLegalViews(sources))).toBe(canonicalSerialize(readLegalViews(sources)))

    const surface = buildSurface()
    expect(canonicalSerialize(buildSurface())).toBe(canonicalSerialize(surface))
    expect(Object.isFrozen(surface)).toBe(true)
    expect(Object.isFrozen(surface.questCandidateViews)).toBe(true)
    expect(Object.isFrozen(surface.questCandidateViews[0])).toBe(true)
  })
})

describe('A2 / S2 [runtime corroboration] — every excluded input class is refused, never repaired', () => {
  const forbiddenInputs: [string, unknown][] = [
    ['raw QuestCandidate', buildA1Sources().publicOpenCandidate],
    ['raw hidden-open QuestCandidate', buildA1Sources().hiddenOpenCandidate],
    ['raw resolved QuestCandidate', buildA1Sources().resolvedCandidate],
    ['raw proof snapshot', buildA1Sources().snapshot],
    ['generic authoritative record', genericAuthoritativeRecord],
    ['serialized envelope', serializedEnvelope],
    ['private Belief', privateBelief],
    ['private IntentionCommitment', privateIntentionCommitment],
    ['unreadable TruthEvent', unreadableTruthEvent],
    ['Attention Ledger record', attentionLedgerRecord],
    ['engine-only diagnostic', engineOnlyDiagnostic],
    ['null', null],
    ['array', []],
    ['string', 'quest-public-open'],
  ]

  it.each(forbiddenInputs)('refuses %s at the A-prime constructor', (_label, forbidden) => {
    const result = constructAttentionReadableSurface(A1_REQUEST, asViewList([forbidden]))
    expect(result).toEqual({ kind: 'refused', reason: 'input-not-attention-readable' })
  })

  it('refuses a legal-looking view that also carries a private field, rather than trimming it', () => {
    // Structural width subtyping is why the *shape* half of the boundary has to
    // catch this class on its own: the value has every legal field, plus
    // private ones. The exhaustive own-key check refuses it before origin is
    // ever consulted, so the reported reason stays the S2 input class.
    const smuggled = {
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
      candidateId: 'quest-public-open',
      openingProvenanceId: 'consequence-public-37',
      legallyVisibleParties: ['player'],
      privateParties: ['warden-confidant'],
      secretOpeningDetail: 'private-belief-overturn',
    }

    const result = constructAttentionReadableSurface(A1_REQUEST, asViewList([smuggled]))

    expect(result).toEqual({ kind: 'refused', reason: 'input-not-attention-readable' })
    expect(result).not.toHaveProperty('surface')
  })

  it('refuses a minted view that was given an extra private field afterwards', () => {
    // Defence in depth: even if a mark-carrying object somehow acquired a
    // private field, the own-key check refuses it before origin is consulted.
    const legalView = readLegalViews(buildA1Sources())[0]!
    const widened = Object.create(
      Object.getPrototypeOf(legalView) as object,
      Object.getOwnPropertyDescriptors(legalView),
    ) as Record<string, unknown>
    widened.secretOpeningDetail = 'private-belief-overturn'

    const result = constructAttentionReadableSurface(A1_REQUEST, asViewList([widened]))

    expect(result).toEqual({ kind: 'refused', reason: 'input-not-attention-readable' })
  })

  it('refuses malformed legal fields (empty ids, negative or non-integer coordinates, non-string parties)', () => {
    const legalView = readLegalViews(buildA1Sources())[0]!
    const malformed: readonly Record<string, unknown>[] = [
      { ...legalView, candidateId: '' },
      { ...legalView, openingProvenanceId: '   ' },
      { ...legalView, rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN + 0.5 },
      { ...legalView, legallyVisibleParties: ['player', 42] },
      { ...legalView, legallyVisiblePublicStakes: '' },
    ]

    for (const candidateView of malformed) {
      expect(constructAttentionReadableSurface(A1_REQUEST, asViewList([candidateView])).kind).toBe('refused')
    }
  })
})

describe('A2 — A-prime has no reverse write path into authoritative candidate state', () => {
  it('is frozen at every level and rejects mutation, leaving source candidates byte-identical', () => {
    const sources = buildA1Sources()
    const before = canonicalSourceBytes(sources)
    const result = constructAttentionReadableSurface(A1_REQUEST, readLegalViews(sources))
    if (result.kind !== 'ok') throw new Error('expected an A-prime surface')
    const surface = result.surface

    expect(Object.isFrozen(surface)).toBe(true)
    expect(Object.isFrozen(surface.questCandidateViews)).toBe(true)
    expect(Object.isFrozen(surface.questCandidateViews[0])).toBe(true)
    expect(Object.isFrozen(surface.questCandidateViews[0]!.legallyVisibleParties)).toBe(true)
    expect(() => {
      // @ts-expect-error -- A' exposes no write path: questCandidateViews is read-only.
      surface.questCandidateViews = []
    }).toThrow(TypeError)
    expect(() => {
      // @ts-expect-error -- A' exposes no write path: legallyVisibleParties is a readonly array.
      surface.questCandidateViews[0]!.legallyVisibleParties.push('smuggled-party')
    }).toThrow(TypeError)

    expect(surface.questCandidateViews.map((view) => view.candidateId)).toEqual(['quest-public-open'])
    expectSourceLifecycleAndBytesUnchanged(sources, before)
  })

  it('cannot have its accessor-origin mark overwritten or removed', () => {
    const view = readLegalViews(buildA1Sources())[0]!
    const marker = Object.getOwnPropertySymbols(view)[0]!

    expect(() => {
      Object.defineProperty(view, marker, { value: false })
    }).toThrow(TypeError)
    expect((view as unknown as Record<symbol, unknown>)[marker]).toBe(true)
  })

  it('leaves the A1 accessor result and candidate lifecycle unchanged after A-prime construction', () => {
    const sources = buildA1Sources()
    const beforeAccess = readAttentionReadableQuestCandidateViews(sources.snapshot, A1_REQUEST)
    const beforeBytes = canonicalSourceBytes(sources)

    constructAttentionReadableSurface(A1_REQUEST, readLegalViews(sources))

    const afterAccess = readAttentionReadableQuestCandidateViews(sources.snapshot, A1_REQUEST)
    expect(afterAccess).toEqual(beforeAccess)
    expectSourceLifecycleAndBytesUnchanged(sources, beforeBytes)
  })
})
