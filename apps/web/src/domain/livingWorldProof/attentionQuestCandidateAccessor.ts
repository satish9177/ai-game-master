import { ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION } from './attentionQuestCandidateContracts'
import type {
  AttentionQuestCandidateAccessRequest,
  AttentionQuestCandidateAccessResult,
  AttentionReadableQuestCandidateView,
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

function toAttentionReadableView(
  candidate: QuestCandidate,
  rankingSnapshotLsn: number,
  accessorContractVersion: string,
): AttentionReadableQuestCandidateView | null {
  if (candidate.status !== 'open') return null
  const openingProvenanceId = legalOpeningProvenanceId(candidate)
  if (openingProvenanceId === null) return null

  return Object.freeze({
    accessorContractVersion,
    rankingSnapshotLsn,
    candidateId: candidate.id,
    openingProvenanceId,
    legallyVisibleParties: Object.freeze([...candidate.legallyVisibleParties]),
    ...(candidate.legallyVisiblePublicStakes === undefined
      ? {}
      : { legallyVisiblePublicStakes: candidate.legallyVisiblePublicStakes }),
    ...(candidate.legallyVisibleOriginConsequenceReference === undefined
      ? {}
      : { legallyVisibleOriginConsequenceReference: candidate.legallyVisibleOriginConsequenceReference }),
  })
}

/**
 * The sole proof-rig snapshot seam. It returns only immutable legal views in
 * stable candidate-id order and never mutates candidate lifecycle.
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

  const views = snapshot.candidates
    .map((candidate) => toAttentionReadableView(candidate, request.rankingSnapshotLsn, request.accessorContractVersion))
    .filter((view): view is AttentionReadableQuestCandidateView => view !== null)
    .sort((left, right) => (
      left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0
    ))

  return { kind: 'ok', views: Object.freeze(views) }
}
