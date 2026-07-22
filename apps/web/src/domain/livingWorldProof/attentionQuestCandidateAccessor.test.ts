import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import { A1_RANKING_SNAPSHOT_LSN, buildAttentionQuestCandidateA1Scenario } from './attentionQuestCandidateScenario'

function buildA1Sources() {
  const publicSourceParties = ['player', 'warden']
  const publicOpenCandidate = createProofQuestCandidate({
    id: 'quest-public-open',
    type: 'reputation_repair',
    status: 'open',
    openedAtLsn: 37,
    openingProvenance: { visibility: 'public', provenanceId: 'consequence-public-37' },
    legallyVisibleParties: publicSourceParties,
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

  return { publicSourceParties, publicOpenCandidate, hiddenOpenCandidate, resolvedCandidate, snapshot }
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

function containsObjectReference(value: unknown, target: object): boolean {
  if (value === target) return true
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).some((nested) => containsObjectReference(nested, target))
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

describe('readAttentionReadableQuestCandidateViews', () => {
  it('keeps the deterministic scenario API limited to safe legal values', () => {
    const scenario = buildAttentionQuestCandidateA1Scenario()

    expect(scenario).toEqual({
      expectedVisibleCandidateIds: ['quest-public-open'],
      views: [{
        accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
        rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
        candidateId: 'quest-public-open',
        openingProvenanceId: 'consequence-public-37',
        legallyVisibleParties: ['player', 'warden'],
        legallyVisiblePublicStakes: 'restore-public-trust',
        legallyVisibleOriginConsequenceReference: 'consequence-public-37',
      }],
    })
    expect(scenario).not.toHaveProperty('snapshot')
    expect(scenario).not.toHaveProperty('publicOpenCandidate')
    expect(containsRawCandidateOrSnapshot(scenario)).toBe(false)
    expect(JSON.stringify(scenario)).not.toContain('private-belief-overturn')
  })

  it('projects a public open candidate without leaking or sharing raw source state', () => {
    const sources = buildA1Sources()
    sources.publicSourceParties.push('late-source-change')
    const before = canonicalSourceBytes(sources)
    const result = readAttentionReadableQuestCandidateViews(sources.snapshot, {
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    })

    expect(result).toEqual({
      kind: 'ok',
      views: [{
        accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
        rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
        candidateId: 'quest-public-open',
        openingProvenanceId: 'consequence-public-37',
        legallyVisibleParties: ['player', 'warden'],
        legallyVisiblePublicStakes: 'restore-public-trust',
        legallyVisibleOriginConsequenceReference: 'consequence-public-37',
      }],
    })
    if (result.kind !== 'ok') throw new Error('expected legal view result')
    const view = result.views[0]!
    expect(view).not.toBe(sources.publicOpenCandidate)
    expect(view.legallyVisibleParties).not.toBe(sources.publicOpenCandidate.legallyVisibleParties)
    expect(containsObjectReference(view, sources.publicOpenCandidate)).toBe(false)
    expect(view).not.toHaveProperty('privateParties')
    expect(view).not.toHaveProperty('secretOpeningDetail')
    expect(Object.isFrozen(result.views)).toBe(true)
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.legallyVisibleParties)).toBe(true)
    expectSourceLifecycleAndBytesUnchanged(sources, before)
  })

  it('excludes hidden-open and resolved candidates while preserving complete source bytes', () => {
    const sources = buildA1Sources()
    const before = canonicalSourceBytes(sources)
    const result = readAttentionReadableQuestCandidateViews(sources.snapshot, {
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    })

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected legal view result')
    expect(result.views.map((view) => view.candidateId)).toEqual(['quest-public-open'])
    expectSourceLifecycleAndBytesUnchanged(sources, before)
  })

  it('returns legal views in stable candidate-id order', () => {
    const sources = buildA1Sources()
    const earlierCandidate = createProofQuestCandidate({
      id: 'quest-alpha-open',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 40,
      openingProvenance: { visibility: 'declassified', provenanceId: 'declassification-40' },
      legallyVisibleParties: ['player'],
    })
    const unorderedSnapshot = {
      ...sources.snapshot,
      candidates: [sources.snapshot.candidates[0]!, earlierCandidate, ...sources.snapshot.candidates.slice(1)],
    }
    const result = readAttentionReadableQuestCandidateViews(unorderedSnapshot, {
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    })

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected legal view result')
    expect(result.views.map((view) => view.candidateId)).toEqual(['quest-alpha-open', 'quest-public-open'])
  })

  it('rejects missing, mismatched, and unsupported version or snapshot requests without mutation', () => {
    const sources = buildA1Sources()
    const before = canonicalSourceBytes(sources)
    const unknownSnapshot = {
      ...sources.snapshot,
      accessorContractVersion: 'unknown-accessor-version',
    }

    expect(readAttentionReadableQuestCandidateViews(sources.snapshot, {
      accessorContractVersion: '' as never,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    })).toEqual({ kind: 'refused', reason: 'missing-accessor-contract-version' })
    expect(readAttentionReadableQuestCandidateViews(sources.snapshot, {
      accessorContractVersion: 'unknown-accessor-version',
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    })).toEqual({ kind: 'refused', reason: 'accessor-contract-version-mismatch' })
    expect(readAttentionReadableQuestCandidateViews(unknownSnapshot, {
      accessorContractVersion: 'unknown-accessor-version',
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    })).toEqual({ kind: 'refused', reason: 'accessor-contract-version-mismatch' })
    expect(readAttentionReadableQuestCandidateViews(sources.snapshot, {
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN + 1,
    })).toEqual({ kind: 'refused', reason: 'ranking-snapshot-lsn-mismatch' })
    expect(readAttentionReadableQuestCandidateViews(sources.snapshot, {
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: undefined as never,
    })).toEqual({ kind: 'refused', reason: 'missing-ranking-snapshot-lsn' })
    expectSourceLifecycleAndBytesUnchanged(sources, before)
  })

  it('returns deeply equal repeated views without sharing mutable arrays or mutating lifecycle', () => {
    const sources = buildA1Sources()
    const before = canonicalSourceBytes(sources)
    const request = {
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      rankingSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
    }
    const first = readAttentionReadableQuestCandidateViews(sources.snapshot, request)
    const second = readAttentionReadableQuestCandidateViews(sources.snapshot, request)

    expect(first).toEqual(second)
    if (first.kind !== 'ok' || second.kind !== 'ok') throw new Error('expected legal view results')
    expect(first.views).not.toBe(second.views)
    expect(first.views[0]!.legallyVisibleParties).not.toBe(second.views[0]!.legallyVisibleParties)
    expect(Object.isFrozen(first.views[0]!.legallyVisibleParties)).toBe(true)
    expect(Object.isFrozen(second.views[0]!.legallyVisibleParties)).toBe(true)
    expectSourceLifecycleAndBytesUnchanged(sources, before)
  })
})
