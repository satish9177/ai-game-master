import { canonicalSerialize, mintHash } from './canonicalSerialization'

export type ScorePolicyRef = 'score-constant-zero-v0' | 'score-discriminating-c9-v1'

export interface AttentionDeclaredScoreFeatures {
  readonly candidateId: string
  readonly publicStakesBand: number
  readonly worldTimeRecencyBand: number
}

export type AttentionScorePolicyRefusal =
  | 'missing-score-feature-input'
  | 'duplicate-score-feature-input'
  | 'unknown-score-feature-input'
  | 'invalid-score-feature-input'
  | 'unsupported-score-policy'

export interface AttentionScoreComponents {
  readonly publicStakesBand: number
  readonly worldTimeRecencyBand: number
  readonly proofScore: number
}

/** A score component bound to the one candidate identity it scores. */
export type AttentionCandidateScoreComponents = AttentionScoreComponents & {
  readonly candidateId: string
}

export const ATTENTION_SCORE_POLICY_VERSION = 'attention-score-policy-c9-v1' as const
export const ATTENTION_SCORE_POLICY_HASH = mintHash(canonicalSerialize({
  version: ATTENTION_SCORE_POLICY_VERSION,
  features: ['public_stakes_band:0..2', 'world_time_recency_band:0..3'],
  formula: '3*public_stakes_band+world_time_recency_band',
}))

function validBand(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum
}

function isDeclaredFeature(value: unknown): value is AttentionDeclaredScoreFeatures {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const feature = value as Record<string, unknown>
  const keys = Object.keys(feature).sort()
  if (keys.length !== 3 || keys[0] !== 'candidateId' || keys[1] !== 'publicStakesBand' || keys[2] !== 'worldTimeRecencyBand') {
    return false
  }
  return typeof feature.candidateId === 'string'
    && feature.candidateId.trim().length > 0
    && validBand(feature.publicStakesBand, 2)
    && validBand(feature.worldTimeRecencyBand, 3)
}

/** Validate the complete declared input set before any candidate is scored. */
export function resolveAttentionScoreComponents(input: {
  readonly candidateIds: readonly string[]
  readonly policyRef: ScorePolicyRef
  readonly declaredFeatures: readonly AttentionDeclaredScoreFeatures[]
}):
  | { readonly kind: 'ok'; readonly componentsByCandidateId: ReadonlyMap<string, AttentionScoreComponents> }
  | { readonly kind: 'refused'; readonly reason: AttentionScorePolicyRefusal } {
  if (input.policyRef !== 'score-constant-zero-v0' && input.policyRef !== 'score-discriminating-c9-v1') {
    return { kind: 'refused', reason: 'unsupported-score-policy' }
  }
  if (
    input.candidateIds.some((candidateId) => typeof candidateId !== 'string' || candidateId.trim().length === 0)
    || new Set(input.candidateIds).size !== input.candidateIds.length
  ) return { kind: 'refused', reason: 'invalid-score-feature-input' }
  const candidates = new Set(input.candidateIds)
  const components = new Map<string, AttentionScoreComponents>()
  for (const feature of input.declaredFeatures as readonly unknown[]) {
    if (!isDeclaredFeature(feature)) return { kind: 'refused', reason: 'invalid-score-feature-input' }
    if (!candidates.has(feature.candidateId)) return { kind: 'refused', reason: 'unknown-score-feature-input' }
    if (components.has(feature.candidateId)) return { kind: 'refused', reason: 'duplicate-score-feature-input' }
    components.set(feature.candidateId, Object.freeze({
      publicStakesBand: feature.publicStakesBand,
      worldTimeRecencyBand: feature.worldTimeRecencyBand,
      proofScore: input.policyRef === 'score-constant-zero-v0'
        ? 0
        : 3 * feature.publicStakesBand + feature.worldTimeRecencyBand,
    }))
  }
  if (components.size !== candidates.size) return { kind: 'refused', reason: 'missing-score-feature-input' }
  return { kind: 'ok', componentsByCandidateId: components }
}
