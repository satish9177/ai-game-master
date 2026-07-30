/**
 * C8's three independently typed, proof-local private-state families.  They
 * deliberately have no visibility marker, accessor mint, or conversion into
 * an attention-readable view: their only use is to establish P3 world pairs
 * whose private differences cannot cross the A-prime boundary.
 */
export interface ProofPrivateBeliefRecord {
  readonly kind: 'proof_private_belief'
  readonly holderId: string
  readonly proposition: string
  readonly confidence: number
}

export interface ProofPrivateIntentionCommitmentRecord {
  readonly kind: 'proof_private_intention_commitment'
  readonly holderId: string
  readonly goal: string
  readonly commitmentState: 'formed' | 'abandoned'
}

export interface ProofUnobservedTruthEventRecord {
  readonly kind: 'proof_unobserved_truth_event'
  readonly eventKind: string
  readonly participantIds: readonly string[]
  /** There is intentionally no observation record or visibility provenance. */
  readonly observationRecord: null
}

export function privateBelief(input: Omit<ProofPrivateBeliefRecord, 'kind'>): ProofPrivateBeliefRecord {
  return Object.freeze({ ...input, kind: 'proof_private_belief' })
}

export function privateIntentionCommitment(
  input: Omit<ProofPrivateIntentionCommitmentRecord, 'kind'>,
): ProofPrivateIntentionCommitmentRecord {
  return Object.freeze({ ...input, kind: 'proof_private_intention_commitment' })
}

export function unobservedTruthEvent(
  input: Omit<ProofUnobservedTruthEventRecord, 'kind'>,
): ProofUnobservedTruthEventRecord {
  return Object.freeze({
    ...input,
    kind: 'proof_unobserved_truth_event',
    participantIds: Object.freeze([...input.participantIds]),
    observationRecord: null,
  })
}
