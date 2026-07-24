/**
 * Stage A / A3 + Stage B / B4 — the normalized derived (B-domain) attention
 * candidate as one discriminated two-family union, and the single common
 * normalization step that produces it. Proof-local to
 * `domain/livingWorldProof`; not a production module, reducer, event, or
 * persistence contract.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research`:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D5 normalization preserves source kind and source authority, D6 identity);
 *  - `docs/research-notes/2026-07-23-019-narrative-pattern-instances-stage-b.md`
 *    (RN019 §9.1 the common candidate that discriminates but never erases);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-23-attention-ledger-replay-stage-b-implementation-plan.md`
 *    (§4.5 one two-family pipeline, §9 B4 obligations).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * **One common pipeline, two families.** The candidate is a discriminated union
 * over `sourceKind`. Both families share a common field set (source kind and
 * authority, source id, candidate id, accessor/canonicalization/identity-schema
 * versions, ranking snapshot coordinate, legally-visible participants, and an
 * eligibility flag). The quest branch keeps its committed opening-provenance and
 * legally-visible fields; the pattern branch keeps its engine-only pattern type,
 * semantic version, canonical binding/supporting tuples, and `lastProgressLsn`.
 * Normalization discriminates; it never flattens a pattern instance into a
 * pretend-authoritative quest, and it never erases a quest field.
 *
 * Quest candidate identity bytes and IDs are byte-identical to committed Stage
 * A. The pattern candidate ID is minted under the disjoint pattern schema and
 * never invents an `openingProvenanceId` sentinel.
 */
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
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
import type {
  AttentionPatternCandidateBindingTupleEntry,
  AttentionPatternCandidateSupportingTupleEntry,
} from './attentionCandidateIdentity'
import {
  ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
  isAccessorMintedAttentionReadableQuestOpeningCoordinateView,
} from './attentionReadableBoundary'
import type {
  AttentionReadableQuestOpeningCoordinateView,
  AttentionReadableSurface,
} from './attentionReadableBoundary'
import { ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION } from './attentionPatternEvidenceContracts'
import type {
  NarrativePatternInstance,
} from './attentionNarrativePatternContracts'
import type { NarrativePatternType } from './attentionNarrativePatternIdentity'

/** The one legal quest input record: an A-prime member, reached only through B1. */
type AttentionReadableSurfaceView = AttentionReadableSurface['questCandidateViews'][number]

/** Whether a candidate is eligible for ranking/presentation at this evaluation. */
export type AttentionCandidateEligibility = 'eligible' | 'ineligible'

/** The common field set both families share (RN019 §9.1). */
export interface AttentionCandidateCommon {
  readonly sourceKind: AttentionCandidateSourceKind
  readonly sourceAuthority: AttentionCandidateSourceAuthority
  readonly sourceId: string
  readonly candidateId: string
  readonly eligibility: AttentionCandidateEligibility
  readonly accessorContractVersion: string
  readonly canonicalizationVersion: string
  readonly identitySchemaVersion: string
  readonly rankingSnapshotLsn: number
  readonly legallyVisibleParties: readonly string[]
}

/**
 * The authoritative quest-family branch — committed Stage A fields preserved,
 * plus the numeric committed opening coordinate joined one-to-one from the
 * accessor-minted `AttentionReadableQuestOpeningCoordinateView` (RN019 §4.3).
 *
 * `openedAtLsn` is a *ranking* coordinate, not an identity input: the quest
 * identity branch's canonical input remains exactly
 * `canonicalizationVersion`, `identitySchemaVersion`, `openingProvenanceId`,
 * `sourceId`, `sourceKind`, so quest candidate IDs stay byte-identical to
 * committed Stage A (ADR-0013 D6).
 */
export type AttentionQuestCandidate = AttentionCandidateCommon & {
  readonly sourceKind: 'quest_candidate'
  readonly sourceAuthority: 'authoritative'
  readonly openingProvenanceId: string
  readonly openedAtLsn: number
  readonly legallyVisiblePublicStakes?: string
  readonly legallyVisibleOriginConsequenceReference?: string
}

/** The derived pattern-family branch — engine-only pattern fields. */
export type AttentionPatternCandidate = AttentionCandidateCommon & {
  readonly sourceKind: 'narrative_pattern_instance'
  readonly sourceAuthority: 'derived'
  readonly patternType: NarrativePatternType
  readonly patternSemanticVersion: number
  readonly canonicalBindingTuple: readonly AttentionPatternCandidateBindingTupleEntry[]
  readonly canonicalSupportingRecordIdentityTuple:
    readonly AttentionPatternCandidateSupportingTupleEntry[]
  readonly lastProgressLsn: number
}

/** The closed discriminated two-family candidate. */
export type AttentionCandidate = AttentionQuestCandidate | AttentionPatternCandidate

/**
 * The closed normalization refusal set. The seven `*-quest-opening-coordinate*`
 * / `unsafe-quest-opened-at-lsn` reasons are RN019 §4.3's join refusals,
 * verbatim. Every one of them refuses deterministically: there is no repair, no
 * fallback, no default, no string parsing, and no fabricated numeric sentinel,
 * so ordering never receives a quest candidate lacking a real numeric
 * coordinate.
 */
export type AttentionCandidateNormalizationRefusal =
  | 'ranking-snapshot-lsn-out-of-range'
  | 'duplicate-source-id'
  | 'candidate-identity-collision'
  | 'missing-quest-opening-coordinate'
  | 'duplicate-quest-opening-coordinate'
  | 'quest-opening-coordinate-identity-mismatch'
  | 'quest-opening-provenance-mismatch'
  | 'unsafe-quest-opened-at-lsn'
  | 'unsupported-quest-opening-coordinate-version'
  | 'quest-opening-coordinate-not-accessor-minted'

export type AttentionCandidateNormalizationResult =
  | { readonly kind: 'ok'; readonly attentionCandidates: readonly AttentionCandidate[] }
  | { readonly kind: 'refused'; readonly reason: AttentionCandidateNormalizationRefusal }

function bindingTupleOf(
  instance: NarrativePatternInstance,
): readonly AttentionPatternCandidateBindingTupleEntry[] {
  return Object.freeze(instance.bindingMap.map((binding) => (
    Object.freeze([binding.role, binding.entityId] as const)
  )))
}

function supportingTupleOf(
  instance: NarrativePatternInstance,
): readonly AttentionPatternCandidateSupportingTupleEntry[] {
  return Object.freeze(instance.supportingRecordIdentityTuple.map((entry) => (
    Object.freeze([
      entry.semanticRole,
      entry.recordKind,
      entry.recordId,
      entry.visibilityProvenanceId,
      entry.commitLsn,
    ] as const)
  )))
}

/**
 * RN019 §4.3's one-to-one view/sidecar join, performed inside the one common
 * normalizer on the one common A-prime surface. It is not a second pipeline, a
 * second accessor call, or a lookup against anything outside A-prime.
 *
 * The join is total and injective in both directions and refuses with a typed
 * reason on each of the seven listed conditions. Checks run in a declared order
 * so the reason a caller receives is stable: per-sidecar legality first
 * (authority, version, coordinate safety, duplication), then the two directions
 * of the bijection, then field agreement.
 */
function joinQuestOpeningCoordinates(
  surface: AttentionReadableSurface,
):
  | { readonly kind: 'ok'; readonly byCandidateId: ReadonlyMap<string, AttentionReadableQuestOpeningCoordinateView> }
  | { readonly kind: 'refused'; readonly reason: AttentionCandidateNormalizationRefusal } {
  const byCandidateId = new Map<string, AttentionReadableQuestOpeningCoordinateView>()

  for (const sidecar of surface.questOpeningCoordinateViews) {
    if (!isAccessorMintedAttentionReadableQuestOpeningCoordinateView(sidecar)) {
      return { kind: 'refused', reason: 'quest-opening-coordinate-not-accessor-minted' }
    }
    if (sidecar.openingCoordinateContractVersion !== ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION) {
      return { kind: 'refused', reason: 'unsupported-quest-opening-coordinate-version' }
    }
    // A *safe* non-negative integer. The mint and the A-prime boundary already
    // require an integer coordinate; this stricter check is what guarantees key
    // 7 compares two genuinely distinct numbers, and it is reachable through the
    // legal accessor path for an authoritative coordinate past the safe ceiling.
    if (!Number.isSafeInteger(sidecar.openedAtLsn) || sidecar.openedAtLsn < 0) {
      return { kind: 'refused', reason: 'unsafe-quest-opened-at-lsn' }
    }
    if (byCandidateId.has(sidecar.candidateId)) {
      return { kind: 'refused', reason: 'duplicate-quest-opening-coordinate' }
    }
    byCandidateId.set(sidecar.candidateId, sidecar)
  }

  const legalViewIds = new Set(surface.questCandidateViews.map((view) => view.candidateId))
  for (const candidateId of byCandidateId.keys()) {
    if (!legalViewIds.has(candidateId)) {
      return { kind: 'refused', reason: 'quest-opening-coordinate-identity-mismatch' }
    }
  }

  for (const view of surface.questCandidateViews) {
    const sidecar = byCandidateId.get(view.candidateId)
    if (sidecar === undefined) {
      return { kind: 'refused', reason: 'missing-quest-opening-coordinate' }
    }
    if (sidecar.openingProvenanceId !== view.openingProvenanceId) {
      return { kind: 'refused', reason: 'quest-opening-provenance-mismatch' }
    }
  }

  return { kind: 'ok', byCandidateId }
}

function normalizeQuestView(
  view: AttentionReadableSurfaceView,
  surface: AttentionReadableSurface,
  openingCoordinate: AttentionReadableQuestOpeningCoordinateView,
): AttentionQuestCandidate {
  return Object.freeze({
    sourceKind: 'quest_candidate',
    sourceAuthority: 'authoritative',
    sourceId: view.candidateId,
    candidateId: computeAttentionCandidateIdentity({
      sourceKind: 'quest_candidate',
      sourceId: view.candidateId,
      openingProvenanceId: view.openingProvenanceId,
    }),
    eligibility: 'eligible',
    accessorContractVersion: surface.accessorContractVersion,
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    rankingSnapshotLsn: surface.rankingSnapshotLsn,
    legallyVisibleParties: canonicalizeAttentionCandidateStringList(view.legallyVisibleParties),
    openingProvenanceId: view.openingProvenanceId,
    openedAtLsn: openingCoordinate.openedAtLsn,
    ...(view.legallyVisiblePublicStakes === undefined
      ? {}
      : { legallyVisiblePublicStakes: view.legallyVisiblePublicStakes }),
    ...(view.legallyVisibleOriginConsequenceReference === undefined
      ? {}
      : { legallyVisibleOriginConsequenceReference: view.legallyVisibleOriginConsequenceReference }),
  })
}

function normalizePatternInstance(
  instance: NarrativePatternInstance,
  surface: AttentionReadableSurface,
): AttentionPatternCandidate {
  const canonicalBindingTuple = bindingTupleOf(instance)
  const canonicalSupportingRecordIdentityTuple = supportingTupleOf(instance)
  return Object.freeze({
    sourceKind: 'narrative_pattern_instance',
    sourceAuthority: 'derived',
    sourceId: instance.patternInstanceId,
    candidateId: computeAttentionCandidateIdentity({
      sourceKind: 'narrative_pattern_instance',
      sourceId: instance.patternInstanceId,
      patternSemanticVersion: instance.patternSemanticVersion,
      canonicalBindingTuple,
      canonicalSupportingRecordIdentityTuple,
    }),
    eligibility: 'eligible',
    accessorContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    rankingSnapshotLsn: surface.rankingSnapshotLsn,
    legallyVisibleParties: canonicalizeAttentionCandidateStringList(
      instance.bindingMap.map((binding) => binding.entityId),
    ),
    patternType: instance.patternType,
    patternSemanticVersion: instance.patternSemanticVersion,
    canonicalBindingTuple,
    canonicalSupportingRecordIdentityTuple,
    lastProgressLsn: instance.lastProgressLsn,
  })
}

/**
 * Normalize an A-prime surface (quest views joined one-to-one with their
 * opening-coordinate sidecars) and the already-retained rankable pattern
 * instances into one discriminated candidate set.
 *
 * The ranking snapshot coordinate is range-checked first, exactly as committed
 * Stage A. The RN019 §4.3 join runs next, so a surface whose sidecars are
 * missing, duplicated, mismatched, unsafe, unsupported, or unminted refuses here
 * — before any candidate is built and long before ordering. Two typed
 * uniqueness refusals then apply across both families: a
 * repeated source id (`duplicate-source-id`) and a candidate-identity collision
 * over distinct inputs (`candidate-identity-collision`). The reused proof hash
 * is documented as not collision-resistant, so it refuses rather than aliases.
 *
 * Input order is preserved and unsorted: imposing an order is
 * `attentionCandidateOrdering.ts`'s job, and identity is order-independent by
 * construction. Retention (the per-type/global caps) has already been applied
 * by `attentionNarrativePatternResourcePolicy.ts`; this function receives only
 * the retained rankable instances.
 */
export function normalizeAttentionCandidates(
  surface: AttentionReadableSurface,
  retainedRankablePatternInstances: readonly NarrativePatternInstance[] = Object.freeze([]),
): AttentionCandidateNormalizationResult {
  if (!isAttentionRankingSnapshotLsnInRange(surface.rankingSnapshotLsn)) {
    return { kind: 'refused', reason: 'ranking-snapshot-lsn-out-of-range' }
  }

  const openingCoordinates = joinQuestOpeningCoordinates(surface)
  if (openingCoordinates.kind !== 'ok') {
    return { kind: 'refused', reason: openingCoordinates.reason }
  }

  const attentionCandidates: AttentionCandidate[] = []
  const seenSourceIds = new Set<string>()
  const seenCandidateIds = new Set<string>()

  const admit = (candidate: AttentionCandidate): AttentionCandidateNormalizationRefusal | null => {
    if (seenSourceIds.has(candidate.sourceId)) return 'duplicate-source-id'
    seenSourceIds.add(candidate.sourceId)
    if (seenCandidateIds.has(candidate.candidateId)) return 'candidate-identity-collision'
    seenCandidateIds.add(candidate.candidateId)
    attentionCandidates.push(candidate)
    return null
  }

  for (const view of surface.questCandidateViews) {
    // The join above already proved exactly one sidecar exists per legal view.
    const openingCoordinate = openingCoordinates.byCandidateId.get(view.candidateId)!
    const refusal = admit(normalizeQuestView(view, surface, openingCoordinate))
    if (refusal !== null) return { kind: 'refused', reason: refusal }
  }
  for (const instance of retainedRankablePatternInstances) {
    const refusal = admit(normalizePatternInstance(instance, surface))
    if (refusal !== null) return { kind: 'refused', reason: refusal }
  }

  return { kind: 'ok', attentionCandidates: Object.freeze(attentionCandidates) }
}
