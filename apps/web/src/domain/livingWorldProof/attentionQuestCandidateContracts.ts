/**
 * Stage A proof-local authoritative QuestCandidate input and its legal view.
 * This is not a production quest API, WorldEvent, WorldState field, or
 * persistence contract.
 */
export const ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION = 'attention-quest-candidate-accessor-v1' as const

export type QuestCandidateStatus = 'open' | 'resolved'

export type QuestCandidateOpeningProvenance =
  | { readonly visibility: 'public' | 'declassified'; readonly provenanceId: string }
  | { readonly visibility: 'private' | 'unobserved' }

/** Authoritative only inside this proof rig. */
export interface QuestCandidate {
  readonly id: string
  readonly type: 'reputation_repair'
  readonly status: QuestCandidateStatus
  readonly openedAtLsn: number
  readonly openingProvenance: QuestCandidateOpeningProvenance
  readonly legallyVisibleParties: readonly string[]
  readonly legallyVisiblePublicStakes?: string
  readonly legallyVisibleOriginConsequenceReference?: string
  readonly privateParties: readonly string[]
  readonly secretOpeningDetail?: string
}

export interface QuestCandidateInput {
  readonly id: string
  readonly type: 'reputation_repair'
  readonly status: QuestCandidateStatus
  readonly openedAtLsn: number
  readonly openingProvenance: QuestCandidateOpeningProvenance
  readonly legallyVisibleParties: readonly string[]
  readonly legallyVisiblePublicStakes?: string
  readonly legallyVisibleOriginConsequenceReference?: string
  readonly privateParties?: readonly string[]
  readonly secretOpeningDetail?: string
}

export interface ProofQuestCandidateSnapshot {
  readonly accessorContractVersion: string
  readonly snapshotLsn: number
  readonly candidates: readonly QuestCandidate[]
}

export interface ProofQuestCandidateSnapshotInput {
  readonly accessorContractVersion: string
  readonly snapshotLsn: number
  readonly candidates: readonly QuestCandidate[]
}

/** The only Stage A value that may leave the proof-local candidate owner. */
export interface AttentionReadableQuestCandidateView {
  readonly accessorContractVersion: string
  readonly rankingSnapshotLsn: number
  readonly candidateId: string
  readonly openingProvenanceId: string
  readonly legallyVisibleParties: readonly string[]
  readonly legallyVisiblePublicStakes?: string
  readonly legallyVisibleOriginConsequenceReference?: string
}

export interface AttentionQuestCandidateAccessRequest {
  readonly accessorContractVersion: string
  readonly rankingSnapshotLsn: number
}

export type AttentionQuestCandidateAccessRefusal =
  | 'missing-accessor-contract-version'
  | 'accessor-contract-version-mismatch'
  | 'missing-ranking-snapshot-lsn'
  | 'ranking-snapshot-lsn-mismatch'

export type AttentionQuestCandidateAccessResult =
  | { readonly kind: 'ok'; readonly views: readonly AttentionReadableQuestCandidateView[] }
  | { readonly kind: 'refused'; readonly reason: AttentionQuestCandidateAccessRefusal }

function requireNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error('attentionQuestCandidateContracts: ' + name + ' must be non-empty')
  }
}

function requireLsn(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('attentionQuestCandidateContracts: ' + name + ' must be a non-negative integer')
  }
}

function requireSupportedAccessorContractVersion(value: string): void {
  requireNonEmptyString(value, 'accessor contract version')
  if (value !== ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION) {
    throw new Error('attentionQuestCandidateContracts: unsupported accessor contract version')
  }
}

function freezeStrings(values: readonly string[], name: string): readonly string[] {
  values.forEach((value) => requireNonEmptyString(value, name))
  return Object.freeze([...values])
}

function freezeOpeningProvenance(provenance: QuestCandidateOpeningProvenance): QuestCandidateOpeningProvenance {
  if (provenance.visibility === 'public' || provenance.visibility === 'declassified') {
    requireNonEmptyString(provenance.provenanceId, 'opening provenance id')
    return Object.freeze({ visibility: provenance.visibility, provenanceId: provenance.provenanceId })
  }
  return Object.freeze({ visibility: provenance.visibility })
}

export function createProofQuestCandidate(input: QuestCandidateInput): QuestCandidate {
  requireNonEmptyString(input.id, 'candidate id')
  requireLsn(input.openedAtLsn, 'opened-at LSN')
  if (input.legallyVisiblePublicStakes !== undefined) {
    requireNonEmptyString(input.legallyVisiblePublicStakes, 'legally visible public stakes')
  }
  if (input.legallyVisibleOriginConsequenceReference !== undefined) {
    requireNonEmptyString(input.legallyVisibleOriginConsequenceReference, 'legally visible origin consequence reference')
  }

  return Object.freeze({
    id: input.id,
    type: input.type,
    status: input.status,
    openedAtLsn: input.openedAtLsn,
    openingProvenance: freezeOpeningProvenance(input.openingProvenance),
    legallyVisibleParties: freezeStrings(input.legallyVisibleParties, 'legally visible party'),
    ...(input.legallyVisiblePublicStakes === undefined ? {} : { legallyVisiblePublicStakes: input.legallyVisiblePublicStakes }),
    ...(input.legallyVisibleOriginConsequenceReference === undefined
      ? {}
      : { legallyVisibleOriginConsequenceReference: input.legallyVisibleOriginConsequenceReference }),
    privateParties: freezeStrings(input.privateParties ?? [], 'private party'),
    ...(input.secretOpeningDetail === undefined ? {} : { secretOpeningDetail: input.secretOpeningDetail }),
  })
}

export function createProofQuestCandidateSnapshot(
  input: ProofQuestCandidateSnapshotInput,
): ProofQuestCandidateSnapshot {
  requireSupportedAccessorContractVersion(input.accessorContractVersion)
  requireLsn(input.snapshotLsn, 'snapshot LSN')
  return Object.freeze({
    accessorContractVersion: input.accessorContractVersion,
    snapshotLsn: input.snapshotLsn,
    candidates: Object.freeze([...input.candidates]),
  })
}
