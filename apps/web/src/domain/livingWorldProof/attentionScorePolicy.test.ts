import { describe, expect, it } from 'vitest'
import { resolveAttentionScoreComponents } from './attentionScorePolicy'

const ids = ['candidate-a', 'candidate-b'] as const
const feature = (candidateId: string, publicStakesBand: number, worldTimeRecencyBand: number) => ({
  candidateId, publicStakesBand, worldTimeRecencyBand,
})

function score(publicStakesBand: number, worldTimeRecencyBand: number): number {
  const result = resolveAttentionScoreComponents({
    candidateIds: ['candidate-a'], policyRef: 'score-discriminating-c9-v1',
    declaredFeatures: [feature('candidate-a', publicStakesBand, worldTimeRecencyBand)],
  })
  if (result.kind !== 'ok') throw new Error(result.reason)
  return result.componentsByCandidateId.get('candidate-a')!.proofScore
}

describe('C9 declared ranking score policy', () => {
  it('uses the closed integer formula and bounds', () => {
    expect(score(0, 0)).toBe(0)
    expect(score(2, 3)).toBe(9)
    expect(score(2, 1) - score(1, 1)).toBe(3)
    expect(score(1, 2) - score(1, 0)).toBe(2)
    expect(score(0, 3)).toBe(3)
    expect(score(1, 0)).toBe(3)
  })

  it('keeps the disabled policy at zero while still requiring complete declarations', () => {
    const result = resolveAttentionScoreComponents({
      candidateIds: ids, policyRef: 'score-constant-zero-v0',
      declaredFeatures: [feature('candidate-a', 2, 3), feature('candidate-b', 0, 0)],
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect([...result.componentsByCandidateId.values()].map((value) => value.proofScore)).toEqual([0, 0])
  })

  it.each([
    ['missing', [feature('candidate-a', 0, 0)], 'missing-score-feature-input'],
    ['duplicate', [feature('candidate-a', 0, 0), feature('candidate-a', 1, 1), feature('candidate-b', 0, 0)], 'duplicate-score-feature-input'],
    ['unknown', [feature('candidate-a', 0, 0), feature('candidate-b', 0, 0), feature('candidate-c', 0, 0)], 'unknown-score-feature-input'],
    ['stakes range', [feature('candidate-a', 3, 0), feature('candidate-b', 0, 0)], 'invalid-score-feature-input'],
    ['recency range', [feature('candidate-a', 0, 4), feature('candidate-b', 0, 0)], 'invalid-score-feature-input'],
    ['fractional', [feature('candidate-a', 0.5, 0), feature('candidate-b', 0, 0)], 'invalid-score-feature-input'],
  ] as const)('%s declared input refuses', (_label, declaredFeatures, reason) => {
    expect(resolveAttentionScoreComponents({ candidateIds: ids, policyRef: 'score-discriminating-c9-v1', declaredFeatures }))
      .toEqual({ kind: 'refused', reason })
  })
})
