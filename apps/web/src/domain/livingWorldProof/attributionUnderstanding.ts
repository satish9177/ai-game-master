import type { Observation } from './contracts'
import { UNDERSTANDING_RULE_VERSION } from './attributionContracts'
import type { UnderstandingResult } from './attributionContracts'

/**
 * The mandatory, proof-local, deterministic UnderstandingResult contract
 * (research vault ADR-0011 §5.3): a pure, derived projection -- never a
 * committed authoritative record (F66) -- distinguishing rung 5
 * (canonicalized content) from rung 6 (understood content) over the
 * existing, unmodified `ObservationSchema`. Communication-receipt fragments
 * are encoded as ordinary `perceived`/`missing`/`channels` values on the
 * existing Observation shape (D10's emission-metadata table: speaker/
 * addressee are sight-gated, act-kind/payload/proposition content are
 * sound-gated) -- no new record family, no SceneEvent schema change.
 *
 * Rung encoding used throughout this proof's fixture:
 *   rungs 1-2 (occurrence, speaker identified): `channels` includes 'sight',
 *     `perceived.speaker` set; no 'sound' channel at all -- occurrence-level
 *     only, no content fragments (NPC_R's case).
 *   rung 3 (addressee identified): `perceived.addressee` additionally set.
 *   rung 5 (canonicalized content): `channels` includes 'sound', and
 *     `perceived.act` (+ `perceived.actPayload`/`perceived.propositionKey`
 *     for content-bearing acts) is present.
 *   rung 6 (understood content): a POSITIVE UnderstandingResult derived
 *     below -- never a fact stored on the Observation itself.
 */

export type ReceiptRung = 'below-rung-5' | 'rung-5'

export function receiptRungOf(observation: Observation): ReceiptRung {
  if (!observation.channels.includes('sound')) {
    return 'below-rung-5'
  }
  if (observation.perceived.act === undefined) {
    return 'below-rung-5'
  }
  return 'rung-5'
}

export const UNDERSTAND_DEFAULT_RULE_ID = 'understand_default' as const
export const UNDERSTAND_DISTRACTED_RULE_ID = 'understand_distracted' as const

/**
 * The positive case (Cora/Daren/NPC_E, §8 Phase 1): understood iff the
 * holder's own committed Observation reached rung 5. Input signature is
 * closed to exactly one committed Observation -- it cannot name another
 * holder's state, engine truth, or an LLM result (static source-contract
 * closure, F65).
 */
export function understandDefault(holderId: string, observation: Observation): UnderstandingResult {
  return {
    holderId,
    observationId: observation.id,
    understood: receiptRungOf(observation) === 'rung-5',
    understandingRuleId: UNDERSTAND_DEFAULT_RULE_ID,
    understandingRuleVersion: UNDERSTANDING_RULE_VERSION,
    inputRecordIds: [observation.id],
  }
}

/**
 * NPC_A's negative case (§8 Phase 1/§5.3 amendment): a pure function of
 * EXACTLY two committed Observations, both hers -- her canonicalizable-but-
 * unprocessed Observation of the accusation, and her simultaneous
 * Observation of a competing interaction. `understood` is false whenever
 * the two Observations share the same effective time (she was
 * simultaneously attending elsewhere), regardless of whether the primary
 * Observation itself reached rung 5 -- never derived from her receipt
 * history, memory, or any other holder's state.
 */
export function understandDistracted(holderId: string, observation: Observation, competingObservation: Observation): UnderstandingResult {
  const reachedRung5 = receiptRungOf(observation) === 'rung-5'
  const simultaneouslyDistracted = competingObservation.time === observation.time
  return {
    holderId,
    observationId: observation.id,
    understood: reachedRung5 && !simultaneouslyDistracted,
    understandingRuleId: UNDERSTAND_DISTRACTED_RULE_ID,
    understandingRuleVersion: UNDERSTANDING_RULE_VERSION,
    inputRecordIds: [observation.id, competingObservation.id],
  }
}
