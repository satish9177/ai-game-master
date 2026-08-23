import type { Belief } from '../domain/livingWorldProof/contracts'

/**
 * The spike's closed epistemic-strength ladder:
 *
 *     unknown < rumoured < possible < probable < confirmed
 *
 * It is NOT a new confidence model. Every rung is a deterministic projection
 * of the proof engine's existing (Confidence x BeliefSourceType) pairs
 * (contracts.ts), exactly as the belief-update calculus (beliefUpdate.ts)
 * mints them:
 *
 *   confirmed <- confidence 'high'   (full observation, beliefUpdate.ts:27;
 *                hard-evidence grounding, beliefUpdate.ts:88)
 *   probable  <- confidence 'medium' (NOT mintable by the belief-update
 *                calculus: beliefFromObservation/beliefFromRumor/
 *                applyEvidenceCorrection only ever mint 'low' or 'high'.
 *                'medium' exists in the engine only via the attribution
 *                erosion ladder, attributionRules.ts. Kept for totality;
 *                in this spike 'probable' is an ASSERTABLE strength (the
 *                hedge lexicon can grade a claim 'probable') that no packet
 *                record can license -- a deliberate, documented consequence
 *                of reusing the engine as-is.)
 *   rumoured  <- confidence 'low' + sourceType 'rumor'
 *                (beliefFromRumor pins 'low' regardless of speakerTrust or
 *                hops, beliefUpdate.ts:45 -- so rumours can never climb this
 *                ladder by repetition)
 *   possible  <- confidence 'low' + any other sourceType
 *                (partial observation -> 'low'/'inference',
 *                beliefUpdate.ts:27-28; soft evidence -> 'low'/'evidence',
 *                beliefUpdate.ts:88)
 *   unknown   <- no belief at all (absence, never a stored value)
 *
 * No probabilities anywhere: the engine has none (ADR-0002), and source
 * trust (sourceTrustProjection.ts) deliberately never raises confidence --
 * consistent with that, trust plays no role in this ladder.
 */

export type Strength = 'unknown' | 'rumoured' | 'possible' | 'probable' | 'confirmed'

export const STRENGTH_ORDER: readonly Strength[] = ['unknown', 'rumoured', 'possible', 'probable', 'confirmed']

const RANK: Readonly<Record<Strength, number>> = {
  unknown: 0,
  rumoured: 1,
  possible: 2,
  probable: 3,
  confirmed: 4,
}

export function strengthRank(strength: Strength): number {
  return RANK[strength]
}

export function strengthAtMost(a: Strength, b: Strength): boolean {
  return RANK[a] <= RANK[b]
}

export function minStrength(a: Strength, b: Strength): Strength {
  return RANK[a] <= RANK[b] ? a : b
}

export function maxStrength(a: Strength, b: Strength): Strength {
  return RANK[a] >= RANK[b] ? a : b
}

/**
 * The single projection from an engine belief to a ladder rung. Total over
 * the full (Confidence x BeliefSourceType) grid; the mapping table above is
 * the specification, this is its only implementation.
 */
export function strengthFromBelief(belief: Pick<Belief, 'confidence' | 'sourceType'>): Strength {
  if (belief.confidence === 'high') return 'confirmed'
  if (belief.confidence === 'medium') return 'probable'
  return belief.sourceType === 'rumor' ? 'rumoured' : 'possible'
}
