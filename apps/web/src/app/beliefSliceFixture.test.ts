import { describe, expect, it } from 'vitest'
import { currentBeliefs } from '../domain/livingWorldProof/beliefProjection'
import type { Belief } from '../domain/livingWorldProof/contracts'
import {
  beliefA1,
  beliefB1,
  beliefC1,
  buildPostEvidenceUniverse,
  buildPreEvidenceUniverse,
  buildThreeNpcRumorDriftFixture,
  clawMarkEvidence,
  observationAOfT0,
  observationAOfT1,
} from './beliefSliceFixture'

/**
 * S1 gate (plan §3): the Three-NPC Rumor Drift fixture, projected through
 * the real spine's `currentBeliefs`, must produce the three-way divergence
 * the experiment exists to test -- A hedged and attacker-less, B more
 * specific and no more confident, C naming the player at low confidence.
 * If these do not diverge as specified, the scenario is mis-authored and
 * no dialogue result would mean anything.
 */

const A_HEDGED_PROPOSITION = 'something happened involving a scream near cellar'
const B_SPECIFIC_PROPOSITION = 'the player was involved in what happened to guard_malik'
const C_ACCUSATION_PROPOSITION = 'the player attacked guard_malik'

function soleBelief(holder: string, beliefs: readonly Belief[]): Belief {
  expect(beliefs, holder).toHaveLength(1)
  return beliefs[0]!
}

describe('three-NPC rumor drift fixture (S1.1)', () => {
  it('builds from real spine records with A holding only scoped observations', () => {
    expect(observationAOfT0.fidelity).toBe('full')
    expect(observationAOfT0.perceived).toMatchObject({ actor: 'player', action: 'entered', target: 'cellar' })
    expect(observationAOfT1.fidelity).toBe('partial')
    expect(observationAOfT1.perceived).toEqual({ sound_signature: 'scream', direction: 'cellar' })
    expect(clawMarkEvidence.presentedTo).toBe('NPC_C')
  })

  it('differs from the pre-evidence universe by exactly the claw-mark record, presented to C only', () => {
    const pre = buildPreEvidenceUniverse()
    const post = buildPostEvidenceUniverse()
    expect(post).toHaveLength(pre.length + 1)
    const preIds = pre.map((entry) => entry.record.id)
    expect(post.filter((entry) => !preIds.includes(entry.record.id)).map((entry) => entry.record.id)).toEqual(['E_claw'])
    expect(pre.some((entry) => entry.kind === 'evidence')).toBe(false)
  })

  it('commits all three beliefs into the conflict store without edges or transitions', () => {
    const { store } = buildThreeNpcRumorDriftFixture()
    expect([...store.timing.keys()].sort()).toEqual(['Bel_A1', 'Bel_B1', 'Bel_C1'])
    expect(store.edges).toHaveLength(0)
    expect(store.transitions).toHaveLength(0)
  })
})

describe('S1 gate: three-way divergence via currentBeliefs', () => {
  const fixture = buildThreeNpcRumorDriftFixture()

  it('projects exactly one current belief per holder', () => {
    for (const holder of ['NPC_A', 'NPC_B', 'NPC_C'] as const) {
      const projection = currentBeliefs(holder, fixture.universe, fixture.store, fixture.bounds)
      expect(projection.beliefs, holder).toHaveLength(1)
      expect(projection.unresolved, holder).toHaveLength(0)
      expect(projection.beliefs[0]!.holder).toBe(holder)
    }
  })

  it('A holds a low-confidence hedged inference naming no attacker', () => {
    const projection = currentBeliefs('NPC_A', fixture.universe, fixture.store, fixture.bounds)
    const a = soleBelief('NPC_A', projection.beliefs)
    expect(a.proposition).toBe(A_HEDGED_PROPOSITION)
    expect(a.confidence).toBe('low')
    expect(a.sourceType).toBe('inference')
    expect(a.proposition).not.toContain('zombie')
    expect(a.proposition).not.toContain('zombie_17')
    expect(a.proposition).not.toContain('guard_malik')
    expect(a.proposition).not.toContain('attacked')
  })

  it('B is more specific than A but no more confident', () => {
    const b = soleBelief('NPC_B', currentBeliefs('NPC_B', fixture.universe, fixture.store, fixture.bounds).beliefs)
    expect(b.proposition).toBe(B_SPECIFIC_PROPOSITION)
    expect(b.confidence).toBe('low')
    expect(b.sourceType).toBe('rumor')
    // More specific than A: B names both the player and the victim.
    expect(b.proposition).toContain('player')
    expect(b.proposition).toContain('guard_malik')
    // No more confident: specificity drift never lifts confidence.
    expect(b.confidence).toBe(beliefA1.confidence)
  })

  it('C names the player as attacker at low confidence', () => {
    const c = soleBelief('NPC_C', currentBeliefs('NPC_C', fixture.universe, fixture.store, fixture.bounds).beliefs)
    expect(c.proposition).toBe(C_ACCUSATION_PROPOSITION)
    expect(c.confidence).toBe('low')
    expect(c.sourceType).toBe('rumor')
    expect(c.proposition).toContain('player')
    expect(c.proposition).toContain('guard_malik')
    expect(c.confidence).toBe(beliefB1.confidence)
  })

  it('diverges: three distinct propositions on one rumor chain, none naming the zombie', () => {
    const propositions = [beliefA1.proposition, beliefB1.proposition, beliefC1.proposition]
    expect(new Set(propositions).size).toBe(3)
    for (const belief of [beliefA1, beliefB1, beliefC1]) {
      expect(belief.proposition).not.toContain('zombie_17')
    }
  })

  it('is stable at later valid times before any correction exists', () => {
    const laterBounds = { ...fixture.bounds, validT: { night: 9, tick: 5 } }
    for (const holder of ['NPC_A', 'NPC_B', 'NPC_C'] as const) {
      expect(currentBeliefs(holder, fixture.universe, fixture.store, laterBounds).beliefs).toEqual(
        currentBeliefs(holder, fixture.universe, fixture.store, fixture.bounds).beliefs,
      )
    }
  })
})
