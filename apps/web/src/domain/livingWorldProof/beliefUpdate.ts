import type { Belief, Evidence, Observation, RumorTransmission } from './contracts'

/**
 * Deterministic belief-update calculus. Full observation grounds a belief
 * at high confidence; partial observation only grounds a hedged
 * low-confidence inference; a rumor can sharpen a proposition's specificity
 * (the `mutation` field) but can never lift confidence above `low` without
 * independent evidence -- trust in the speaker does not buy certainty; hard
 * evidence contradicting a belief corrects it, downgrading the contradicted
 * belief and grounding the evidence-implied proposition at high confidence.
 * No LLM, no randomness, no I/O -- every id and timestamp is supplied by
 * the caller so every function here stays pure and total.
 */

export function beliefFromObservation(observation: Observation, beliefId: string): Belief {
  const isFull = observation.fidelity === 'full'

  const proposition = isFull
    ? `${observation.perceived.actor} ${observation.perceived.action} ${observation.perceived.target}`
    : `something happened involving a ${observation.perceived.sound_signature ?? 'sound'} near ${observation.perceived.direction ?? 'nearby'}`

  return {
    schemaVersion: 1,
    id: beliefId,
    holder: observation.observer,
    proposition,
    confidence: isFull ? 'high' : 'low',
    sourceType: isFull ? 'observation' : 'inference',
    sourceRef: observation.id,
    supporting: [observation.id],
    contradicting: [],
    lastUpdated: observation.time,
  }
}

export function beliefFromRumor(transmission: RumorTransmission, beliefId: string): Belief {
  return {
    schemaVersion: 1,
    id: beliefId,
    holder: transmission.to,
    proposition: transmission.proposition,
    // Governing rule (the calculus's central claim): retelling can sharpen
    // specificity but never raises confidence above `low`, regardless of
    // `speakerTrust` or how many hops the rumor has traveled.
    confidence: 'low',
    sourceType: 'rumor',
    sourceRef: transmission.id,
    supporting: [transmission.id],
    contradicting: [],
    lastUpdated: transmission.time,
  }
}

export type EvidenceCorrectionOutcome =
  | { status: 'corrected'; contradicted: Belief; corrected: Belief }
  | { status: 'not-contradicted' }

/**
 * Applies evidence against the belief it targets. If the evidence does not
 * contradict that belief's proposition, this is a no-op (`not-contradicted`)
 * -- the caller is never trusted to have picked the right belief. On a
 * match, the prior belief is not deleted (history is preserved) but is
 * downgraded and annotated with the contradicting evidence id; a new belief
 * grounds the evidence-implied proposition, at `high` confidence only for
 * `hard` evidence.
 */
export function applyEvidenceCorrection(
  priorBelief: Belief,
  evidence: Evidence,
  correctedBeliefId: string,
): EvidenceCorrectionOutcome {
  if (evidence.contradicts !== priorBelief.proposition) {
    return { status: 'not-contradicted' }
  }

  const contradicted: Belief = {
    ...priorBelief,
    confidence: 'low',
    contradicting: [...priorBelief.contradicting, evidence.id],
    lastUpdated: evidence.time,
  }

  const corrected: Belief = {
    schemaVersion: 1,
    id: correctedBeliefId,
    holder: priorBelief.holder,
    proposition: evidence.implies,
    confidence: evidence.strength === 'hard' ? 'high' : 'low',
    sourceType: 'evidence',
    sourceRef: evidence.id,
    supporting: [evidence.id],
    contradicting: [],
    lastUpdated: evidence.time,
  }

  return { status: 'corrected', contradicted, corrected }
}
