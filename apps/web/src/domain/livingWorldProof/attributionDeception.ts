/**
 * The six-way deception taxonomy (research vault ADR-0011 D12, spec §8
 * Phase 9): every classification is a derived comparison over committed,
 * bitemporally-anchored data -- never a stored flag, never an LLM
 * judgment. `classifyDeception` is a pure, total function of exactly three
 * already-derived inputs, none of which is itself stored anywhere:
 *
 *  - `settledStance`: the speaker's OWN world-belief settledness at the
 *    utterance's dispatch commit bound, from `currentBeliefForKey`
 *    (beliefProjection.ts) -- 'affirmative' (status 'resolved', the
 *    asserted-consistent claim), 'rejecting' (status 'resolved', the
 *    incompatible claim), or 'none' (status 'none' OR 'unresolved' --
 *    both collapse to "no settled stance", §8 Phase 9 correction);
 *  - `worldTruthMatches`: an ENGINE/AUDIT-ONLY comparison against world
 *    truth, consulted only to distinguish sincere assertion from honest
 *    mistake -- never read by any holder, never an ascription-rule input;
 *  - `recordedIntention`: whether the speaker's own `IntentionCommitment`
 *    carries an `induce-belief`/`preserve-belief` objective toward this
 *    listener and proposition -- engine-side, never listener-readable
 *    (D6/D12).
 */

export type SettledStance = 'affirmative' | 'rejecting' | 'none'

export type DeceptionClassification =
  | 'sincere-assertion'
  | 'honest-mistake'
  | 'counter-belief-assertion'
  | 'deceptive-lie'
  | 'non-committal-assertion'
  | 'deceptive-non-committal-assertion'

export interface DeceptionClassificationInput {
  settledStance: SettledStance
  /** Audit-only; undefined when not applicable (never consulted outside the affirmative case). */
  worldTruthMatches?: boolean
  recordedIntention?: 'induce-belief' | 'preserve-belief'
}

/** No `isLie`/deception flag anywhere (D12) -- every case is recomputed identically by re-running this same comparison (P55). */
export function classifyDeception(input: DeceptionClassificationInput): DeceptionClassification {
  if (input.settledStance === 'affirmative') {
    return input.worldTruthMatches === false ? 'honest-mistake' : 'sincere-assertion'
  }
  if (input.settledStance === 'rejecting') {
    return input.recordedIntention !== undefined ? 'deceptive-lie' : 'counter-belief-assertion'
  }
  return input.recordedIntention !== undefined ? 'deceptive-non-committal-assertion' : 'non-committal-assertion'
}
