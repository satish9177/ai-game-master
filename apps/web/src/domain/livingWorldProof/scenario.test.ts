import { describe, expect, it } from 'vitest'
import { applyEvidenceCorrection, beliefFromObservation, beliefFromRumor } from './beliefUpdate'
import { computeObservations } from './observationScope'
import { clawEvidence, events, positions, rumorAToB, rumorBToC, topology } from './scenario'

/**
 * The fused deterministic pass: SceneEvent -> scoped Observation ->
 * Belief/Rumor -> Evidence correction, run end to end in one test. This is
 * the "note 004 §10" combined run the research vault recommended: proving
 * perception and belief-update together instead of in isolation. No LLM
 * anywhere in this file.
 */
describe('fused observation-scope + belief-update pipeline', () => {
  it('carries a partial observation through a two-hop rumor to a low-confidence false belief, then corrects it with hard evidence', () => {
    // 1. TruthEvent -> scoped Observation. NPC_A only hears the attack.
    const observations = computeObservations(events, topology, positions)
    const npcAHearsAttack = observations.find((o) => o.observer === 'NPC_A' && o.truthRef === 'T1')
    expect(npcAHearsAttack).toBeDefined()
    expect(npcAHearsAttack?.fidelity).toBe('partial')

    // 2. Observation -> Belief. A's belief is hedged and low-confidence --
    // it names no actor, because A never perceived one.
    const beliefA = beliefFromObservation(npcAHearsAttack!, 'Bel_A1')
    expect(beliefA.confidence).toBe('low')
    expect(beliefA.proposition).not.toContain('player')
    expect(beliefA.proposition).not.toContain('zombie_17')

    // 3. Belief -> Rumor -> Belief, twice (A -> B -> C). Confidence is
    // pinned at `low` the whole way down even as the proposition sharpens
    // from "was involved in" to a direct, specific, and false accusation.
    const beliefB = beliefFromRumor(rumorAToB, 'Bel_B1')
    const beliefC = beliefFromRumor(rumorBToC, 'Bel_C1')
    expect(beliefB.confidence).toBe('low')
    expect(beliefC.confidence).toBe('low')
    expect(beliefC.proposition).toBe('the player attacked guard_malik')

    // 4. Evidence -> correction. Hard evidence contradicts C's belief and
    // grounds the true proposition at high confidence; the false belief is
    // downgraded and annotated, never deleted.
    const outcome = applyEvidenceCorrection(beliefC, clawEvidence, 'Bel_C2')
    expect(outcome.status).toBe('corrected')
    if (outcome.status !== 'corrected') throw new Error('unreachable')

    expect(outcome.contradicted.proposition).toBe('the player attacked guard_malik')
    expect(outcome.contradicted.contradicting).toEqual(['E_claw'])
    expect(outcome.corrected.proposition).toBe('zombie_17 attacked guard_malik')
    expect(outcome.corrected.confidence).toBe('high')
  })

  it('never lets a directly-observed truth (NPC_D) end up less certain than a rumor-only belief (NPC_C)', () => {
    const observations = computeObservations(events, topology, positions)
    const npcDSeesAttack = observations.find((o) => o.observer === 'NPC_D' && o.truthRef === 'T1')
    expect(npcDSeesAttack?.fidelity).toBe('full')

    const beliefD = beliefFromObservation(npcDSeesAttack!, 'Bel_D1')
    const beliefC = beliefFromRumor(rumorBToC, 'Bel_C1')

    expect(beliefD.confidence).toBe('high')
    expect(beliefD.proposition).toBe('zombie_17 attacked guard_malik')
    expect(beliefC.confidence).toBe('low')
  })

  it('confirms NPC_B, out of sight and earshot, never enters the pipeline at all', () => {
    const observations = computeObservations(events, topology, positions)
    expect(observations.some((o) => o.observer === 'NPC_B')).toBe(false)
  })

  it('is byte-identical across two independent runs of the whole pipeline', () => {
    function runPipeline() {
      const observations = computeObservations(events, topology, positions)
      const npcAObservation = observations.find((o) => o.observer === 'NPC_A' && o.truthRef === 'T1')!
      const beliefA = beliefFromObservation(npcAObservation, 'Bel_A1')
      const beliefC = beliefFromRumor(rumorBToC, 'Bel_C1')
      const outcome = applyEvidenceCorrection(beliefC, clawEvidence, 'Bel_C2')
      return { observations, beliefA, beliefC, outcome }
    }

    expect(runPipeline()).toEqual(runPipeline())
  })
})
