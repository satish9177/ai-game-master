import { describe, expect, it } from 'vitest'
import { currentBeliefForKey, currentBeliefs } from './beliefProjection'
import { canonicalKeyOf } from './canonicalProposition'
import {
  attributionUniverse,
  Bel_CoraAtt1b,
  Bel_CoraAtt2,
  BORIN,
  buildBranch4bContentSatisfying,
  buildPhase3Store,
  CORA,
  T_ACK,
} from './attributionScenario'

/**
 * Bitemporal projection tests (P36-P40). Reuses ADR-0008's two axes
 * verbatim -- effective/world time (`validT`) and recorded/commit time
 * (`txBound`) -- no third temporal axis is introduced anywhere in this
 * proof.
 */

describe('P36 -- valid-time as-of query', () => {
  it('current(Cora, valid_t < night_5b) returns the pre-acknowledgment attribution; valid_t >= night_5b returns the post-acknowledgment attribution', () => {
    const branch = buildBranch4bContentSatisfying()
    const boundsBeforeAck = { validT: { night: 5, tick: 0 }, txBound: branch.store.conflict.nextSeq - 1 }
    const boundsAfterAck = { validT: T_ACK, txBound: branch.store.conflict.nextSeq - 1 }

    const before = currentBeliefs(CORA, attributionUniverse, branch.store.conflict, boundsBeforeAck)
    const after = currentBeliefs(CORA, attributionUniverse, branch.store.conflict, boundsAfterAck)

    expect(before.beliefs.some((b) => b.id === Bel_CoraAtt1b.id)).toBe(true)
    expect(before.beliefs.some((b) => b.id === Bel_CoraAtt2.id)).toBe(false)
    expect(after.beliefs.some((b) => b.id === Bel_CoraAtt2.id)).toBe(true)
    expect(after.beliefs.some((b) => b.id === Bel_CoraAtt1b.id)).toBe(false)
  })
})

describe('P37 -- transaction-time as-of query', () => {
  it('at a tx_bound before BT_AB1 commits, Borin\'s belief reads uncorrected; after, corrected -- Cora\'s attribution is unaffected at any tx_bound (no synchronization)', () => {
    const phase3 = buildPhase3Store()
    const btAB1 = phase3.store.conflict.transitions.find((t) => t.transitionId === 'BT_AB1')!
    const txBoundBefore = btAB1.commitSeq - 1
    const txBoundAfter = phase3.store.conflict.nextSeq - 1

    const borinBefore = currentBeliefs(BORIN, attributionUniverse, phase3.store.conflict, { validT: { night: 5, tick: 0 }, txBound: txBoundBefore })
    const borinAfter = currentBeliefs(BORIN, attributionUniverse, phase3.store.conflict, { validT: { night: 5, tick: 0 }, txBound: txBoundAfter })
    expect(borinBefore.beliefs.some((b) => b.proposition.includes('involved'))).toBe(true)
    expect(borinAfter.beliefs.some((b) => b.proposition.includes('zombie'))).toBe(true)

    const coraBefore = currentBeliefs(CORA, attributionUniverse, phase3.store.conflict, { validT: { night: 4, tick: 3 }, txBound: txBoundBefore })
    const coraAfter = currentBeliefs(CORA, attributionUniverse, phase3.store.conflict, { validT: { night: 4, tick: 3 }, txBound: txBoundAfter })
    expect(coraBefore.beliefs.some((b) => b.id === Bel_CoraAtt1b.id || b.id.startsWith('Bel_CoraAtt1'))).toBe(
      coraAfter.beliefs.some((b) => b.id === Bel_CoraAtt1b.id || b.id.startsWith('Bel_CoraAtt1')),
    )
  })
})

describe('P39 -- combined bitemporal query returns the intersection of the two single-axis results', () => {
  it('bounding both valid_t and tx_bound narrows to exactly the records satisfying both', () => {
    const branch = buildBranch4bContentSatisfying()
    const combined = currentBeliefForKey(
      CORA,
      canonicalKeyOf(branch.store.conflict.claims.get(Bel_CoraAtt2.id)!),
      attributionUniverse,
      branch.store.conflict,
      { validT: T_ACK, txBound: branch.store.conflict.nextSeq - 1 },
    )
    expect(combined.status).toBe('resolved')
    if (combined.status === 'resolved') {
      expect(combined.belief.id).toBe(Bel_CoraAtt2.id)
    }
  })
})

describe('P40 -- no third temporal axis exists', () => {
  it('every bitemporal fact in this rig is expressed on the existing two ADR-0008 axes (WorldInstant + commitSeq)', () => {
    const phase3 = buildPhase3Store()
    const transition = phase3.store.conflict.transitions[0]!
    expect(Object.keys(transition).filter((k) => k.toLowerCase().includes('time') || k === 'commitSeq')).toEqual(
      expect.arrayContaining(['effectiveValidTime', 'commitSeq']),
    )
    // No wall-clock, no frame counter, no third field anywhere on the
    // transition or its sidecar shape.
    expect('wallClockTime' in transition).toBe(false)
    expect('frameCount' in transition).toBe(false)
  })
})
