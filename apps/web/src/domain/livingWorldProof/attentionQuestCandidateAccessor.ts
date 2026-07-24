import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
  mintAttentionReadableQuestCandidateView,
  mintAttentionReadableQuestOpeningCoordinateView,
} from './attentionQuestCandidateContracts'
import type {
  AttentionQuestCandidateAccessRequest,
  AttentionQuestCandidateAccessResult,
  AttentionReadableQuestCandidateView,
  AttentionReadableQuestOpeningCoordinateView,
  ProofQuestCandidateSnapshot,
  QuestCandidate,
} from './attentionQuestCandidateContracts'

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function legalOpeningProvenanceId(candidate: QuestCandidate): string | null {
  const provenance = candidate.openingProvenance
  if (provenance.visibility !== 'public' && provenance.visibility !== 'declassified') return null
  return provenance.provenanceId.trim().length > 0 ? provenance.provenanceId : null
}

/**
 * One admitted candidate's complete A-prime projection: its legal view and the
 * B4 opening-coordinate sidecar minted from the same gated candidate. The two
 * are produced together and never independently, so a candidate that fails the
 * open-plus-public/declassified gate contributes neither.
 */
interface AdmittedQuestCandidateProjection {
  readonly view: AttentionReadableQuestCandidateView
  readonly openingCoordinateView: AttentionReadableQuestOpeningCoordinateView
}

function toAttentionReadableProjection(
  candidate: QuestCandidate,
  rankingSnapshotLsn: number,
  accessorContractVersion: string,
): AdmittedQuestCandidateProjection | null {
  if (candidate.status !== 'open') return null
  const openingProvenanceId = legalOpeningProvenanceId(candidate)
  if (openingProvenanceId === null) return null

  // The mint is the sole origin of an attention-readable view (ADR-0013
  // D2/D4): the lifecycle and opening-provenance gates above are the only
  // route to it, so no view can exist that did not pass them.
  const view = mintAttentionReadableQuestCandidateView({
    accessorContractVersion,
    rankingSnapshotLsn,
    candidateId: candidate.id,
    openingProvenanceId,
    legallyVisibleParties: candidate.legallyVisibleParties,
    ...(candidate.legallyVisiblePublicStakes === undefined
      ? {}
      : { legallyVisiblePublicStakes: candidate.legallyVisiblePublicStakes }),
    ...(candidate.legallyVisibleOriginConsequenceReference === undefined
      ? {}
      : { legallyVisibleOriginConsequenceReference: candidate.legallyVisibleOriginConsequenceReference }),
  })

  // B4 / RN019 §4.3 — this is the only place the committed opening coordinate
  // becomes legally readable. It is minted behind the same gate as the view
  // above, from the authoritative record, and carries exactly four fields; the
  // ordering module never reads an authoritative record, and the legal view
  // never gains `openedAtLsn`.
  const openingCoordinateView = mintAttentionReadableQuestOpeningCoordinateView({
    openingCoordinateContractVersion: ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
    candidateId: candidate.id,
    openingProvenanceId,
    openedAtLsn: candidate.openedAtLsn,
  })

  return { view, openingCoordinateView }
}

/**
 * The sole proof-rig snapshot seam. It returns only immutable legal views and
 * their index-aligned opening-coordinate sidecars, both in stable candidate-id
 * order, and never mutates candidate lifecycle.
 */
export function readAttentionReadableQuestCandidateViews(
  snapshot: ProofQuestCandidateSnapshot,
  request: AttentionQuestCandidateAccessRequest,
): AttentionQuestCandidateAccessResult {
  if (typeof request.accessorContractVersion !== 'string' || request.accessorContractVersion.trim().length === 0) {
    return { kind: 'refused', reason: 'missing-accessor-contract-version' }
  }
  if (
    request.accessorContractVersion !== ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION
    || snapshot.accessorContractVersion !== ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION
    || request.accessorContractVersion !== snapshot.accessorContractVersion
  ) {
    return { kind: 'refused', reason: 'accessor-contract-version-mismatch' }
  }
  if (!isNonNegativeInteger(request.rankingSnapshotLsn)) {
    return { kind: 'refused', reason: 'missing-ranking-snapshot-lsn' }
  }
  if (request.rankingSnapshotLsn !== snapshot.snapshotLsn) {
    return { kind: 'refused', reason: 'ranking-snapshot-lsn-mismatch' }
  }

  const projections = snapshot.candidates
    .map((candidate) => (
      toAttentionReadableProjection(candidate, request.rankingSnapshotLsn, request.accessorContractVersion)
    ))
    .filter((projection): projection is AdmittedQuestCandidateProjection => projection !== null)
    .sort((left, right) => (
      left.view.candidateId < right.view.candidateId
        ? -1
        : left.view.candidateId > right.view.candidateId ? 1 : 0
    ))

  return {
    kind: 'ok',
    views: Object.freeze(projections.map((projection) => projection.view)),
    openingCoordinateViews: Object.freeze(projections.map((projection) => projection.openingCoordinateView)),
  }
}
