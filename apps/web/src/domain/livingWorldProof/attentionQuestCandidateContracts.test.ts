import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  createProofQuestCandidate,
  createProofQuestCandidateSnapshot,
} from './attentionQuestCandidateContracts'

describe('Stage A proof-local QuestCandidate contract', () => {
  it('preserves the closed open | resolved lifecycle', () => {
    const openCandidate = createProofQuestCandidate({
      id: 'quest-open',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 4,
      openingProvenance: { visibility: 'public', provenanceId: 'public-4' },
      legallyVisibleParties: ['player'],
    })
    const resolvedCandidate = createProofQuestCandidate({
      id: 'quest-resolved',
      type: 'reputation_repair',
      status: 'resolved',
      openedAtLsn: 5,
      openingProvenance: { visibility: 'declassified', provenanceId: 'declassified-5' },
      legallyVisibleParties: ['player'],
    })

    expect(openCandidate.status).toBe('open')
    expect(resolvedCandidate.status).toBe('resolved')
    expect(Object.isFrozen(openCandidate)).toBe(true)
    expect(Object.isFrozen(openCandidate.legallyVisibleParties)).toBe(true)
  })

  it('builds an immutable proof-rig snapshot at an explicit committed coordinate', () => {
    const candidate = createProofQuestCandidate({
      id: 'quest-snapshot',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 8,
      openingProvenance: { visibility: 'public', provenanceId: 'public-8' },
      legallyVisibleParties: ['player'],
    })
    const snapshot = createProofQuestCandidateSnapshot({
      accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      snapshotLsn: 9,
      candidates: [candidate],
    })

    expect(snapshot.snapshotLsn).toBe(9)
    expect(snapshot.candidates).toEqual([candidate])
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.candidates)).toBe(true)
  })

  it('rejects unsupported snapshot accessor versions without mutating source candidates', () => {
    const candidate = createProofQuestCandidate({
      id: 'quest-version-rejection',
      type: 'reputation_repair',
      status: 'open',
      openedAtLsn: 10,
      openingProvenance: { visibility: 'public', provenanceId: 'public-10' },
      legallyVisibleParties: ['player'],
      privateParties: ['private-witness'],
      secretOpeningDetail: 'private-opening-detail',
    })
    const before = canonicalSerialize(candidate)

    expect(() => createProofQuestCandidateSnapshot({
      accessorContractVersion: 'unknown-accessor-version',
      snapshotLsn: 11,
      candidates: [candidate],
    })).toThrow('unsupported accessor contract version')

    expect(candidate.status).toBe('open')
    expect(canonicalSerialize(candidate)).toBe(before)
  })
})
