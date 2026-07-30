import { describe, expect, it } from 'vitest'
import { orderAttentionCandidates } from './attentionCandidateOrdering'
import type { AttentionQuestCandidate } from './attentionCandidate'
import { createAttentionLedger } from './attentionLedger'
import { buildB6PatternOnlyEvaluationInput } from './attentionReplayScenario'
import { runAttentionMixedFamilyEvaluation } from './attentionReplay'

function candidate(candidateId: string, sourceId: string): AttentionQuestCandidate {
  return Object.freeze({
    sourceKind: 'quest_candidate', sourceAuthority: 'authoritative', sourceId, candidateId,
    eligibility: 'eligible', accessorContractVersion: 'accessor-v1', canonicalizationVersion: 'canon-v1',
    identitySchemaVersion: 'identity-v1', rankingSnapshotLsn: 20, legallyVisibleParties: Object.freeze([]),
    openingProvenanceId: `opening-${sourceId}`, openedAtLsn: 10,
  })
}

describe('C9 score tie-break', () => {
  it('makes proof-score the forceable second ordering key under reversed insertion', () => {
    const lower = candidate('candidate-lower', 'source-lower')
    const higher = candidate('candidate-higher', 'source-higher')
    const scoreInput = {
      policyRef: 'score-discriminating-c9-v1' as const,
      declaredFeatures: [
        { candidateId: lower.candidateId, publicStakesBand: 0, worldTimeRecencyBand: 3 },
        { candidateId: higher.candidateId, publicStakesBand: 1, worldTimeRecencyBand: 1 },
      ],
    }
    const forward = orderAttentionCandidates([lower, higher], scoreInput)
    const reversed = orderAttentionCandidates([higher, lower], scoreInput)
    expect(forward.kind).toBe('ok')
    expect(reversed).toEqual(forward)
    if (forward.kind !== 'ok') return
    expect(forward.orderedCandidates.map((entry) => entry.candidateId)).toEqual([higher.candidateId, lower.candidateId])
    expect(forward.comparisons[0]).toMatchObject({ decidingKey: 'proof-score', leftValue: '4', rightValue: '3' })
    expect(forward.scoreComponents).toEqual([
      { candidateId: higher.candidateId, publicStakesBand: 1, worldTimeRecencyBand: 1, proofScore: 4 },
      { candidateId: lower.candidateId, publicStakesBand: 0, worldTimeRecencyBand: 3, proofScore: 3 },
    ])
  })

  it('preserves the existing later deterministic key at equal scores', () => {
    const left = candidate('candidate-left', 'a-source')
    const right = candidate('candidate-right', 'b-source')
    const result = orderAttentionCandidates([right, left], {
      policyRef: 'score-discriminating-c9-v1',
      declaredFeatures: [
        { candidateId: left.candidateId, publicStakesBand: 1, worldTimeRecencyBand: 0 },
        { candidateId: right.candidateId, publicStakesBand: 0, worldTimeRecencyBand: 3 },
      ],
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.comparisons[0]?.decidingKey).toBe('source-id')
  })

  it('carries declared score inputs only in trusted reproducibility evidence', () => {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: 'attention-ledger-policy-v1' })
    if (ledger.kind !== 'ok') throw new Error('expected ledger')
    const input = buildB6PatternOnlyEvaluationInput('c9-trace', ledger.ledger)
    const candidateId = input.patternPresentationInputs[0]!.candidateId
    const result = runAttentionMixedFamilyEvaluation({
      ...input,
      scorePolicy: { policyRef: 'score-discriminating-c9-v1', declaredFeatures: [
        { candidateId, publicStakesBand: 2, worldTimeRecencyBand: 3 },
      ] },
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.result.trace.scorePolicyEvidence).toEqual({
      policyRef: 'score-discriminating-c9-v1',
      declaredFeatures: [{ candidateId, publicStakesBand: 2, worldTimeRecencyBand: 3 }],
    })
    expect(result.result.trace.orderedAttentionCandidates[0]?.orderingKeyValues[1])
      .toEqual({ key: 'proof-score', value: '9' })
    expect(result.result.trace.playerObservable).not.toHaveProperty('scorePolicyEvidence')
  })
})
