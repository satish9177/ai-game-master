/**
 * Stage A / A3 — the normalized derived (B-domain) attention candidate and the
 * sole normalization step that produces it. Proof-local to
 * `domain/livingWorldProof`; not a production module, reducer, event, or
 * persistence contract.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D2 surface enumeration, D4 legal-view field set, D5 normalization that
 *    preserves source kind and source authority, D6 identity);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§8 "S2 — A′-construction closure", §12 public `QuestCandidate` fixture,
 *    §14 candidate identity fixtures);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6 A3 normalized-candidate obligations, §9 A3 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * Its single accepted input is the A2 A-prime surface produced by
 * `constructAttentionReadableSurface`. It imports neither the A1 contracts
 * module nor the A1 accessor, so it cannot name a raw `QuestCandidate`, a proof
 * snapshot, a private field, the `open | resolved` lifecycle, or the
 * accessor-origin mint — there is no second path around the A2 constructor, and
 * the accessor-origin authority A1/A2 established is what admitted every view
 * this module reads. It evaluates no lifecycle and repairs nothing: an input
 * that A2 refused simply never reaches here.
 *
 * ADR-0013 D5 fixes what normalization preserves and what it must not erase:
 * source kind and source authority survive, so a later slice can never lose
 * that this candidate came from an authoritative record rather than a derived
 * one. The legal fields are copied from the view only — never re-derived from
 * the A domain, which this module cannot reach anyway — and the collection
 * field is put into the canonicalization version's stated order.
 *
 * The normalized candidate's own `candidateId` is the derived
 * attention-candidate identity (D6); `sourceId` is the engine-owned quest
 * candidate ID it was projected from. They are deliberately separate fields:
 * conflating them would let a ranking-only or schema change move an ID that
 * exposure history is joined on, or vice versa.
 *
 * Deliberately absent, because the controlling A3 plan section does not
 * authorize them: monitor verdicts, narrative annotations, bindings, forks,
 * pattern versions, ranking features or scores, resource budgets, caches,
 * `RevealPackage`, templates, the Attention Ledger, and replay traces.
 */
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_SOURCE_AUTHORITY,
  isAttentionRankingSnapshotLsnInRange,
} from './attentionCandidatePolicy'
import type {
  AttentionCandidateSourceAuthority,
  AttentionCandidateSourceKind,
} from './attentionCandidatePolicy'
import {
  canonicalizeAttentionCandidateStringList,
  computeAttentionCandidateIdentity,
} from './attentionCandidateIdentity'
import type { AttentionReadableSurface } from './attentionQuestCandidateBoundary'

/** The one legal input record: an A-prime member, reached only through A2. */
type AttentionReadableSurfaceView = AttentionReadableSurface['questCandidateViews'][number]

/** The closed normalized field set. */
export interface AttentionCandidate {
  readonly sourceKind: AttentionCandidateSourceKind
  readonly sourceAuthority: AttentionCandidateSourceAuthority
  readonly sourceId: string
  readonly candidateId: string
  readonly accessorContractVersion: string
  readonly canonicalizationVersion: string
  readonly identitySchemaVersion: string
  readonly rankingSnapshotLsn: number
  readonly openingProvenanceId: string
  readonly legallyVisibleParties: readonly string[]
  readonly legallyVisiblePublicStakes?: string
  readonly legallyVisibleOriginConsequenceReference?: string
}

export type AttentionCandidateNormalizationRefusal =
  | 'ranking-snapshot-lsn-out-of-range'
  | 'duplicate-source-id'
  | 'candidate-identity-collision'

export type AttentionCandidateNormalizationResult =
  | { readonly kind: 'ok'; readonly attentionCandidates: readonly AttentionCandidate[] }
  | { readonly kind: 'refused'; readonly reason: AttentionCandidateNormalizationRefusal }

const STAGE_A_SOURCE_KIND: AttentionCandidateSourceKind = 'quest_candidate'

function normalizeOne(
  view: AttentionReadableSurfaceView,
  surface: AttentionReadableSurface,
): AttentionCandidate {
  return Object.freeze({
    sourceKind: STAGE_A_SOURCE_KIND,
    sourceAuthority: ATTENTION_CANDIDATE_SOURCE_AUTHORITY[STAGE_A_SOURCE_KIND],
    sourceId: view.candidateId,
    candidateId: computeAttentionCandidateIdentity({
      sourceKind: STAGE_A_SOURCE_KIND,
      sourceId: view.candidateId,
      openingProvenanceId: view.openingProvenanceId,
    }),
    accessorContractVersion: surface.accessorContractVersion,
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    rankingSnapshotLsn: surface.rankingSnapshotLsn,
    openingProvenanceId: view.openingProvenanceId,
    legallyVisibleParties: canonicalizeAttentionCandidateStringList(view.legallyVisibleParties),
    ...(view.legallyVisiblePublicStakes === undefined
      ? {}
      : { legallyVisiblePublicStakes: view.legallyVisiblePublicStakes }),
    ...(view.legallyVisibleOriginConsequenceReference === undefined
      ? {}
      : { legallyVisibleOriginConsequenceReference: view.legallyVisibleOriginConsequenceReference }),
  })
}

/**
 * Normalize an A-prime surface into derived attention candidates.
 *
 * The ranking snapshot coordinate is range-checked first. A2 admits any
 * non-negative integer, so a coordinate past the safe-integer ceiling reaches
 * here intact — and past that ceiling integers stop being distinct values, so
 * two different coordinates could serialize and compare identically. Plan §6
 * requires "checked range validation and a typed refusal on overflow" and that
 * "Zero/negative/overflow ... return a typed ineligible/refusal outcome, never
 * an unbounded fallback", so the value is refused, never clamped or truncated.
 *
 * Two further fail-closed uniqueness rules, both typed refusals rather than a
 * silent drop or a repaired set, because either would let one candidate stand in
 * for another downstream:
 *
 *  - `duplicate-source-id` — the surface carries two views for one engine-owned
 *    candidate. Reachable whenever the pinned snapshot holds a repeated ID;
 *  - `candidate-identity-collision` — two *distinct* identity inputs produce one
 *    ID. The reused proof hash is documented as not collision-resistant, so this
 *    guard exists to refuse rather than alias (ADR-0013 D6 / replay spec I7). It
 *    is unreachable from the fixture set by construction, and is kept precisely
 *    because the alternative to refusing is silent identity aliasing.
 *
 * The two `Set`s below are membership tests only; neither is ever iterated, so
 * no insertion-order accident can reach the output. Input order is preserved,
 * unchanged and unsorted: imposing an order is `attentionCandidateOrdering.ts`'s
 * job, and identity is order-independent by construction.
 *
 * The surface and its views are already deeply frozen by A1/A2; this function
 * reads them and writes nothing back.
 */
export function normalizeAttentionCandidates(
  surface: AttentionReadableSurface,
): AttentionCandidateNormalizationResult {
  if (!isAttentionRankingSnapshotLsnInRange(surface.rankingSnapshotLsn)) {
    return { kind: 'refused', reason: 'ranking-snapshot-lsn-out-of-range' }
  }

  const attentionCandidates: AttentionCandidate[] = []
  const seenSourceIds = new Set<string>()
  const seenCandidateIds = new Set<string>()

  for (const view of surface.questCandidateViews) {
    if (seenSourceIds.has(view.candidateId)) {
      return { kind: 'refused', reason: 'duplicate-source-id' }
    }
    seenSourceIds.add(view.candidateId)

    const attentionCandidate = normalizeOne(view, surface)
    if (seenCandidateIds.has(attentionCandidate.candidateId)) {
      return { kind: 'refused', reason: 'candidate-identity-collision' }
    }
    seenCandidateIds.add(attentionCandidate.candidateId)
    attentionCandidates.push(attentionCandidate)
  }

  return { kind: 'ok', attentionCandidates: Object.freeze(attentionCandidates) }
}
