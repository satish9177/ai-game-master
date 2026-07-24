/**
 * Stage A / B1 — the sole A-prime (attention-readable surface) construction
 * boundary. This is not a production module, reducer, event, or persistence
 * contract; it is proof-local to `domain/livingWorldProof`.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D2 surface enumeration, D3 type-level admission, D4 accessor contract,
 *    D19 P1, D20 items 1-2);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§7 "S1", §8 "S2 — A′-construction closure");
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§5 A2 obligations, §9 A2 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * Its three accepted input classes are the separately authoritative legal
 * `AttentionReadableQuestCandidateView`,
 * `AttentionReadableQuestOpeningCoordinateView`, and
 * `AttentionReadablePatternEvidenceView` mints. It imports
 * no authoritative record, reducer, event, world session, store, persistence,
 * cognition, planner, action, scheduler, RNG, ledger, or diagnostic module, and
 * it evaluates no candidate lifecycle: the lifecycle stays owned by the A1
 * candidate seam.
 *
 * Closure rules enforced here (ADR-0013 D2/D3/D4; Attention Ledger Replay v0
 * §8 "S2 — A′-construction closure"):
 *
 *  - a raw QuestCandidate, proof snapshot, generic authoritative record or
 *    event envelope, serialized envelope, private Belief, private
 *    IntentionCommitment, unreadable TruthEvent, attention-ledger record, or
 *    engine-only diagnostic is not accepted at the input type, and is refused
 *    at runtime rather than trimmed, coerced, or repaired into a surface;
 *  - a value carrying any own field outside the closed legally-visible set is
 *    refused, so a private field can never be copied in and hidden downstream;
 *  - a value the A1 accessor did not mint is refused however legal its shape.
 *    D2 admits only views "obtained from the engine-owned snapshot accessor",
 *    so structural legality alone is not admission: a fabricated view would
 *    otherwise re-admit a candidate that never passed D4's open-plus-public /
 *    declassified-opening-provenance gate;
 *  - the accessor-contract version and the pinned ranking snapshot coordinate
 *    must match the request on every accepted view; a mismatch is a typed
 *    refusal, never a repaired surface.
 *
 * Accepted views are retained exactly as the accessor minted them rather than
 * rebuilt. A minted view is already deeply frozen, carries only the closed
 * legal field set, and shares no mutable state with the authoritative candidate
 * it was projected from, so retaining it neither widens what is observable nor
 * opens a write path — whereas rebuilding would strip the accessor-origin mark
 * that D2 requires A-prime membership to carry.
 *
 * Deliberately absent (later, separately approved slices): normalized
 * attention candidates, candidate identity/canonicalization, ranking,
 * tie-break or ordering policy, caches, RevealPackage, templates, the
 * Attention Ledger, and replay traces. Accepted views are kept in the order
 * the accessor supplied them; A-prime construction imposes no order of its
 * own.
 */
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
  isAccessorMintedAttentionReadableQuestCandidateView,
  isAccessorMintedAttentionReadableQuestOpeningCoordinateView,
  isStructurallyValidAttentionReadableQuestOpeningCoordinateView,
} from './attentionQuestCandidateContracts'
import type {
  AttentionReadableQuestCandidateView,
  AttentionReadableQuestOpeningCoordinateView,
} from './attentionQuestCandidateContracts'
import {
  ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
  isStructurallyValidAttentionReadablePatternEvidenceView,
} from './attentionPatternEvidenceContracts'
import type { AttentionReadablePatternEvidenceView } from './attentionPatternEvidenceContracts'
import {
  isAttentionReadablePatternEvidenceViewFromAccessor,
} from './attentionPatternEvidenceAccessor'

/**
 * The committed B1-B3 common surface schema: exactly `questCandidateViews` and
 * `patternEvidenceViews`. Retained as a named pin so a v1 surface is never
 * silently reinterpreted as v2 (RN019 §4.3).
 */
export const ATTENTION_READABLE_SURFACE_SCHEMA_V1 =
  'attention-readable-surface-schema-v1' as const

/**
 * B4's common surface schema: `questCandidateViews`,
 * `questOpeningCoordinateViews`, and `patternEvidenceViews`. Version v2 begins
 * exactly when the sidecar collection joins the one surface. Cross-schema
 * whole-surface byte equality is not claimed; only within-schema comparisons
 * are. The canonical bytes of every embedded
 * `AttentionReadableQuestCandidateView` remain exactly the committed Stage A
 * bytes — the sidecar is a sibling collection, never a new view field.
 */
export const ATTENTION_READABLE_SURFACE_SCHEMA_V2 =
  'attention-readable-surface-schema-v2' as const

/** The schema this build constructs and accepts. */
export const ATTENTION_READABLE_SURFACE_SCHEMA_VERSION = ATTENTION_READABLE_SURFACE_SCHEMA_V2

/**
 * Re-exported for the downstream B4 modules that must independently re-check
 * sidecar authority and contract version — the candidate normalizer's join
 * (RN019 §4.3) and the derivation cache-key bundle. They reach these through
 * this boundary rather than through `attentionQuestCandidateContracts`, so the
 * closed import allowlist keeps the raw `QuestCandidate`, the proof snapshot,
 * the `open | resolved` lifecycle, and both accessor mints out of their reach.
 */
export {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
  isAccessorMintedAttentionReadableQuestOpeningCoordinateView,
}
export type { AttentionReadableQuestOpeningCoordinateView }

export interface AttentionReadableSurfaceRequest {
  readonly surfaceSchemaVersion: string
  readonly accessorContractVersion: string
  readonly rankingSnapshotLsn: number
}

/** A-prime: the only surface downstream attention work may read. */
export interface AttentionReadableSurface {
  readonly surfaceSchemaVersion: string
  readonly accessorContractVersion: string
  readonly rankingSnapshotLsn: number
  readonly questCandidateViews: readonly AttentionReadableQuestCandidateView[]
  readonly questOpeningCoordinateViews: readonly AttentionReadableQuestOpeningCoordinateView[]
  readonly patternEvidenceViews: readonly AttentionReadablePatternEvidenceView[]
}

export type AttentionReadableSurfaceRefusal =
  | 'surface-schema-version-mismatch'
  | 'accessor-contract-version-mismatch'
  | 'ranking-snapshot-lsn-mismatch'
  | 'pattern-evidence-contract-version-mismatch'
  | 'quest-opening-coordinate-contract-version-mismatch'
  | 'input-not-attention-readable'
  | 'input-not-accessor-minted'
  | 'quest-view-order-mismatch'
  | 'quest-opening-coordinate-order-mismatch'
  | 'pattern-evidence-order-mismatch'
  | 'ambiguous-legal-identity'

export type AttentionReadableSurfaceResult =
  | { readonly kind: 'ok'; readonly surface: AttentionReadableSurface }
  | { readonly kind: 'refused'; readonly reason: AttentionReadableSurfaceRefusal }

/** The closed set of legally visible view fields. Any other own key refuses. */
const LEGALLY_VISIBLE_VIEW_KEYS: readonly string[] = [
  'accessorContractVersion',
  'rankingSnapshotLsn',
  'candidateId',
  'openingProvenanceId',
  'legallyVisibleParties',
  'legallyVisiblePublicStakes',
  'legallyVisibleOriginConsequenceReference',
]

const REQUIRED_VIEW_KEYS: readonly string[] = [
  'accessorContractVersion',
  'rankingSnapshotLsn',
  'candidateId',
  'openingProvenanceId',
  'legallyVisibleParties',
]

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isNonEmptyStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry))
}

/**
 * Runtime corroboration of the type boundary: every excluded input class fails
 * here because it either misses a required legal field or carries an own field
 * outside the closed legally-visible set. This runs before the accessor-origin
 * check so an excluded A-domain record is still reported as the S2 input class
 * it is, rather than merely as an unminted value.
 */
function hasOnlyLegalViewShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

  const keys = Object.getOwnPropertyNames(value)
  if (keys.some((key) => !LEGALLY_VISIBLE_VIEW_KEYS.includes(key))) return false
  if (REQUIRED_VIEW_KEYS.some((key) => !keys.includes(key))) return false

  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.accessorContractVersion)) return false
  if (!isNonNegativeInteger(record.rankingSnapshotLsn)) return false
  if (!isNonEmptyString(record.candidateId)) return false
  if (!isNonEmptyString(record.openingProvenanceId)) return false
  if (!isNonEmptyStringList(record.legallyVisibleParties)) return false
  if (keys.includes('legallyVisiblePublicStakes') && !isNonEmptyString(record.legallyVisiblePublicStakes)) return false
  if (
    keys.includes('legallyVisibleOriginConsequenceReference')
    && !isNonEmptyString(record.legallyVisibleOriginConsequenceReference)
  ) {
    return false
  }
  return true
}

function comparePatternEvidence(
  left: AttentionReadablePatternEvidenceView,
  right: AttentionReadablePatternEvidenceView,
): number {
  if (left.commitLsn < right.commitLsn) return -1
  if (left.commitLsn > right.commitLsn) return 1
  if (left.recordId < right.recordId) return -1
  if (left.recordId > right.recordId) return 1
  return 0
}

/**
 * The sole A-prime constructor — still one function with one exported name. B4
 * adds a third required readonly input (the accessor-minted quest
 * opening-coordinate sidecars) and a surface-schema version; it does not add a
 * second boundary, a second accessor seam, or an alternative construction path.
 *
 * Every class the constructor already refuses for the view collections is
 * refused for the sidecar collection too: an unsupported contract version, any
 * own key outside the closed four-field set, a structurally legal but unminted
 * value (an object literal, a spread copy, or a serialized round-trip), and a
 * duplicate stable identity.
 */
export function constructAttentionReadableSurface(
  request: AttentionReadableSurfaceRequest,
  questCandidateViews: readonly AttentionReadableQuestCandidateView[],
  questOpeningCoordinateViews: readonly AttentionReadableQuestOpeningCoordinateView[],
  patternEvidenceViews: readonly AttentionReadablePatternEvidenceView[],
): AttentionReadableSurfaceResult {
  if (request.surfaceSchemaVersion !== ATTENTION_READABLE_SURFACE_SCHEMA_VERSION) {
    return { kind: 'refused', reason: 'surface-schema-version-mismatch' }
  }
  if (request.accessorContractVersion !== ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION) {
    return { kind: 'refused', reason: 'accessor-contract-version-mismatch' }
  }
  if (!isNonNegativeInteger(request.rankingSnapshotLsn)) {
    return { kind: 'refused', reason: 'ranking-snapshot-lsn-mismatch' }
  }
  if (
    !Array.isArray(questCandidateViews)
    || !Array.isArray(questOpeningCoordinateViews)
    || !Array.isArray(patternEvidenceViews)
  ) {
    return { kind: 'refused', reason: 'input-not-attention-readable' }
  }

  const acceptedQuestViews: AttentionReadableQuestCandidateView[] = []
  const questIdentities = new Set<string>()
  for (const view of questCandidateViews) {
    if (!hasOnlyLegalViewShape(view)) {
      return { kind: 'refused', reason: 'input-not-attention-readable' }
    }
    if (!isAccessorMintedAttentionReadableQuestCandidateView(view)) {
      return { kind: 'refused', reason: 'input-not-accessor-minted' }
    }
    if (Object.getOwnPropertySymbols(view).length !== 1) {
      return { kind: 'refused', reason: 'input-not-attention-readable' }
    }
    if (view.accessorContractVersion !== request.accessorContractVersion) {
      return { kind: 'refused', reason: 'accessor-contract-version-mismatch' }
    }
    if (view.rankingSnapshotLsn !== request.rankingSnapshotLsn) {
      return { kind: 'refused', reason: 'ranking-snapshot-lsn-mismatch' }
    }
    if (questIdentities.has(view.candidateId)) {
      return { kind: 'refused', reason: 'ambiguous-legal-identity' }
    }
    questIdentities.add(view.candidateId)
    acceptedQuestViews.push(view)
  }

  // B4 / RN019 §4.3 — the sidecar collection. It is admitted in the same
  // canonical `candidateId` order the accessor already uses for quest views, so
  // whole-surface bytes stay insertion-order independent. Structural legality is
  // owned by the contracts module's closed four-field predicate: this
  // constructor never names a raw authoritative field.
  const acceptedOpeningCoordinateViews: AttentionReadableQuestOpeningCoordinateView[] = []
  const openingCoordinateIdentities = new Set<string>()
  let previousOpeningCoordinateId: string | null = null
  for (const sidecar of questOpeningCoordinateViews) {
    if (!isStructurallyValidAttentionReadableQuestOpeningCoordinateView(sidecar)) {
      return { kind: 'refused', reason: 'input-not-attention-readable' }
    }
    if (!isAccessorMintedAttentionReadableQuestOpeningCoordinateView(sidecar)) {
      return { kind: 'refused', reason: 'input-not-accessor-minted' }
    }
    if (Object.getOwnPropertySymbols(sidecar).length !== 1) {
      return { kind: 'refused', reason: 'input-not-attention-readable' }
    }
    if (sidecar.openingCoordinateContractVersion !== ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION) {
      return { kind: 'refused', reason: 'quest-opening-coordinate-contract-version-mismatch' }
    }
    if (openingCoordinateIdentities.has(sidecar.candidateId)) {
      return { kind: 'refused', reason: 'ambiguous-legal-identity' }
    }
    if (previousOpeningCoordinateId !== null && previousOpeningCoordinateId >= sidecar.candidateId) {
      return { kind: 'refused', reason: 'quest-opening-coordinate-order-mismatch' }
    }
    openingCoordinateIdentities.add(sidecar.candidateId)
    previousOpeningCoordinateId = sidecar.candidateId
    acceptedOpeningCoordinateViews.push(sidecar)
  }

  const acceptedPatternViews: AttentionReadablePatternEvidenceView[] = []
  const patternRecordIds = new Set<string>()
  let previousPatternView: AttentionReadablePatternEvidenceView | null = null
  for (const view of patternEvidenceViews) {
    if (!isStructurallyValidAttentionReadablePatternEvidenceView(view)) {
      return { kind: 'refused', reason: 'input-not-attention-readable' }
    }
    if (!isAttentionReadablePatternEvidenceViewFromAccessor(view)) {
      return { kind: 'refused', reason: 'input-not-accessor-minted' }
    }
    if (Object.getOwnPropertySymbols(view).length !== 1) {
      return { kind: 'refused', reason: 'input-not-attention-readable' }
    }
    if (view.evidenceViewContractVersion !== ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION) {
      return { kind: 'refused', reason: 'pattern-evidence-contract-version-mismatch' }
    }
    if (patternRecordIds.has(view.recordId)) {
      return { kind: 'refused', reason: 'ambiguous-legal-identity' }
    }
    if (previousPatternView !== null && comparePatternEvidence(previousPatternView, view) >= 0) {
      return { kind: 'refused', reason: 'pattern-evidence-order-mismatch' }
    }
    patternRecordIds.add(view.recordId)
    previousPatternView = view
    acceptedPatternViews.push(view)
  }

  return {
    kind: 'ok',
    surface: Object.freeze({
      surfaceSchemaVersion: request.surfaceSchemaVersion,
      accessorContractVersion: request.accessorContractVersion,
      rankingSnapshotLsn: request.rankingSnapshotLsn,
      questCandidateViews: Object.freeze(acceptedQuestViews),
      questOpeningCoordinateViews: Object.freeze(acceptedOpeningCoordinateViews),
      patternEvidenceViews: Object.freeze(acceptedPatternViews),
    }),
  }
}
