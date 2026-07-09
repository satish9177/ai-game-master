import { describe, expect, it } from 'vitest'
import type { Belief, Observation } from './contracts'
import { applyEvidenceCorrection, beliefFromObservation, beliefFromRumor } from './beliefUpdate'
import { clawEvidence, rumorAToB, rumorBToC } from './scenario'

function fullObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    schemaVersion: 1,
    id: 'O_NPC_D_T1',
    observer: 'NPC_D',
    truthRef: 'T1',
    channels: ['sight'],
    perceived: { actor: 'zombie_17', action: 'attacked', target: 'guard_malik', location: 'cellar' },
    missing: [],
    fidelity: 'full',
    time: 'night_3',
    ...overrides,
  }
}

function partialObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    schemaVersion: 1,
    id: 'O_NPC_A_T1',
    observer: 'NPC_A',
    truthRef: 'T1',
    channels: ['sound'],
    perceived: { sound_signature: 'scream', direction: 'cellar' },
    missing: ['actor', 'action', 'target', 'location'],
    fidelity: 'partial',
    time: 'night_3',
    ...overrides,
  }
}

describe('beliefFromObservation', () => {
  it('grounds a full observation at high confidence, sourced as observation', () => {
    const belief = beliefFromObservation(fullObservation(), 'Bel_D1')
    expect(belief.confidence).toBe('high')
    expect(belief.sourceType).toBe('observation')
    expect(belief.proposition).toBe('zombie_17 attacked guard_malik')
    expect(belief.supporting).toEqual(['O_NPC_D_T1'])
    expect(belief.contradicting).toEqual([])
  })

  it('grounds a partial observation only at low confidence, sourced as inference', () => {
    const belief = beliefFromObservation(partialObservation(), 'Bel_A1')
    expect(belief.confidence).toBe('low')
    expect(belief.sourceType).toBe('inference')
    expect(belief.holder).toBe('NPC_A')
  })

  it('never names an actor/action/target the observer did not perceive', () => {
    const belief = beliefFromObservation(partialObservation(), 'Bel_A1')
    expect(belief.proposition).not.toContain('zombie_17')
    expect(belief.proposition).not.toContain('guard_malik')
  })
})

describe('beliefFromRumor', () => {
  it('pins confidence at low regardless of speaker trust or hop', () => {
    const belA = beliefFromRumor(rumorAToB, 'Bel_B1')
    const belB = beliefFromRumor(rumorBToC, 'Bel_C1')
    expect(belA.confidence).toBe('low')
    expect(belB.confidence).toBe('low')
    expect(belA.sourceType).toBe('rumor')
    expect(belB.sourceType).toBe('rumor')
  })

  it('lets retelling sharpen specificity while confidence stays flat', () => {
    const belA = beliefFromRumor(rumorAToB, 'Bel_B1')
    const belB = beliefFromRumor(rumorBToC, 'Bel_C1')
    // A's proposition hedges ("was involved in"); B's is a direct accusation
    // ("attacked") -- specificity increased across the hop...
    expect(belA.proposition).toContain('was involved in')
    expect(belB.proposition).toContain('attacked')
    // ...but confidence did not move.
    expect(belA.confidence).toBe(belB.confidence)
  })

  it('carries the transmission id as sourceRef, not the upstream belief', () => {
    const belief = beliefFromRumor(rumorBToC, 'Bel_C1')
    expect(belief.sourceRef).toBe('R_B_to_C')
    expect(belief.holder).toBe('NPC_C')
  })
})

describe('applyEvidenceCorrection', () => {
  const rumorBelief: Belief = {
    schemaVersion: 1,
    id: 'Bel_C1',
    holder: 'NPC_C',
    proposition: 'the player attacked guard_malik',
    confidence: 'low',
    sourceType: 'rumor',
    sourceRef: 'R_B_to_C',
    supporting: ['R_B_to_C'],
    contradicting: [],
    lastUpdated: 'night_4',
  }

  it('corrects a belief the evidence contradicts', () => {
    const outcome = applyEvidenceCorrection(rumorBelief, clawEvidence, 'Bel_C2')
    expect(outcome.status).toBe('corrected')
    if (outcome.status !== 'corrected') throw new Error('unreachable')

    expect(outcome.contradicted.id).toBe('Bel_C1')
    expect(outcome.contradicted.contradicting).toEqual(['E_claw'])
    expect(outcome.contradicted.confidence).toBe('low')

    expect(outcome.corrected.id).toBe('Bel_C2')
    expect(outcome.corrected.holder).toBe('NPC_C')
    expect(outcome.corrected.proposition).toBe('zombie_17 attacked guard_malik')
    expect(outcome.corrected.confidence).toBe('high')
    expect(outcome.corrected.sourceType).toBe('evidence')
    expect(outcome.corrected.sourceRef).toBe('E_claw')
  })

  it('grounds only soft-strength evidence at low confidence, not high', () => {
    const softEvidence = { ...clawEvidence, strength: 'soft' as const }
    const outcome = applyEvidenceCorrection(rumorBelief, softEvidence, 'Bel_C2')
    expect(outcome.status).toBe('corrected')
    if (outcome.status !== 'corrected') throw new Error('unreachable')
    expect(outcome.corrected.confidence).toBe('low')
  })

  it('is a no-op when the evidence does not contradict this belief', () => {
    const unrelatedBelief: Belief = { ...rumorBelief, proposition: 'the tavern is out of ale' }
    const outcome = applyEvidenceCorrection(unrelatedBelief, clawEvidence, 'Bel_X')
    expect(outcome).toEqual({ status: 'not-contradicted' })
  })

  it('does not mutate the prior belief or evidence objects', () => {
    const beliefSnapshot = structuredClone(rumorBelief)
    const evidenceSnapshot = structuredClone(clawEvidence)

    applyEvidenceCorrection(rumorBelief, clawEvidence, 'Bel_C2')

    expect(rumorBelief).toEqual(beliefSnapshot)
    expect(clawEvidence).toEqual(evidenceSnapshot)
  })
})
