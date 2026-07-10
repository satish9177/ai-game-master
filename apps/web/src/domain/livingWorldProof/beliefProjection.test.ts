import { describe, expect, it } from 'vitest'
import { currentBeliefForKey, currentBeliefs, effectiveEnd, isConflictActive } from './beliefProjection'
import { canonicalKeyOf } from './canonicalProposition'
import { beliefC1, beliefC1Prime } from './compactionScenario'
import type { CanonicalClaim } from './conflictContracts'
import { buildConflictScenario, claimRegistry, nightTick, REVISION_VALID_FROM } from './conflictScenario'
import { beliefB1 } from './conflictScenario'
import { commitBelief, initConflictStore, mintEdge } from './conflictStore'

/**
 * Bitemporal as-of queries (ADR-0008 D4/D5/D8, spec conflict-edge-replay-
 * v0.md §1.6). Covers P3-P6, the D8 never-silently-inconsistent unit test,
 * and N7's projection-level half (NPC_B's projection is byte-unaffected).
 */

describe('effectiveEnd (P3 -- derived, never stored)', () => {
  it('derives Bel_C1\'s effective end from the committed transition, at-most-one-outgoing, no tiebreak', () => {
    const scenario = buildConflictScenario()
    const end = effectiveEnd(beliefC1.id, scenario.store.transitions, scenario.store.nextSeq)
    expect(end).toEqual(REVISION_VALID_FROM)
    // The belief's own bytes carry no end -- effectiveEnd is a pure derivation, never written back.
    expect(Object.keys(beliefC1)).not.toContain('validTo')
  })
})

describe('currentBeliefs / currentBeliefForKey (P4, P5, P6)', () => {
  const claimKey = canonicalKeyOf(claimRegistry.get(beliefC1.id)!)

  it('P4: per-holder divergence -- NPC_C is corrected while NPC_B legitimately retains the old rumor belief', () => {
    const scenario = buildConflictScenario()
    const bounds = { validT: nightTick('night_5'), txBound: scenario.store.nextSeq }

    const cProjection = currentBeliefForKey('NPC_C', claimKey, scenario.universe, scenario.store, bounds)
    expect(cProjection).toEqual({ status: 'resolved', belief: beliefC1Prime })

    const bBeliefs = currentBeliefs('NPC_B', scenario.universe, scenario.store, bounds).beliefs
    expect(bBeliefs.map((b) => b.id)).toEqual([beliefB1.id])
  })

  it('P5: valid-time as-of -- before night_4 tick1 sees Bel_C1, at/after sees Bel_C1\'', () => {
    const scenario = buildConflictScenario()
    const txBound = scenario.store.nextSeq

    const beforeCorrection = currentBeliefForKey('NPC_C', claimKey, scenario.universe, scenario.store, { validT: nightTick('night_4', 0), txBound })
    expect(beforeCorrection).toEqual({ status: 'resolved', belief: beliefC1 })

    const atCorrection = currentBeliefForKey('NPC_C', claimKey, scenario.universe, scenario.store, { validT: nightTick('night_4', 1), txBound })
    expect(atCorrection).toEqual({ status: 'resolved', belief: beliefC1Prime })
  })

  it('P6: transaction-time as-of -- Bel_C1\' becomes visible atomically with BT_0001, never in a partial-write phase', () => {
    const scenario = buildConflictScenario()
    const validT = nightTick('night_4', 2)
    const revisionTransition = scenario.store.transitions.find((t) => t.toBeliefId === beliefC1Prime.id)
    expect(revisionTransition).toBeDefined()
    const revisionSeq = revisionTransition!.commitSeq
    const bel1MintSeq = scenario.store.timing.get(beliefC1.id)?.mintSeq
    expect(bel1MintSeq).toBeDefined()

    for (let txBound = 0; txBound <= scenario.store.nextSeq + 1; txBound += 1) {
      const result = currentBeliefForKey('NPC_C', claimKey, scenario.universe, scenario.store, { validT, txBound })

      if (txBound < bel1MintSeq!) {
        expect(result).toEqual({ status: 'none' })
      } else if (txBound < revisionSeq) {
        expect(result).toEqual({ status: 'resolved', belief: beliefC1 })
      } else {
        expect(result).toEqual({ status: 'resolved', belief: beliefC1Prime })
      }
      // The atomicity guarantee under test: there is no txBound at which
      // both beliefs are simultaneously visible/unresolved for this key --
      // Bel_C1' timing and BT_0001 become visible together, under one
      // shared commitSeq, never as a partial write.
      expect(result.status).not.toBe('unresolved')
    }
  })

  it('D8 never-silently-inconsistent: a deliberately co-held pair (no transition) is reported unresolved, with the covering edge attached once minted', () => {
    const beliefX = {
      schemaVersion: 1 as const,
      id: 'Bel_ProjectionX',
      holder: 'NPC_PROJECTION',
      proposition: 'x',
      confidence: 'medium' as const,
      sourceType: 'observation' as const,
      sourceRef: 'O_projection',
      supporting: ['O_projection'],
      contradicting: [],
      lastUpdated: 'night_1',
    }
    const beliefY = { ...beliefX, id: 'Bel_ProjectionY' }
    const universe = [
      { kind: 'belief' as const, record: beliefX },
      { kind: 'belief' as const, record: beliefY },
    ]
    const claimX: CanonicalClaim = {
      predicate: 'attacked',
      fixedRoles: { target: 'proj_target' },
      contestedRole: 'actor',
      contestedValue: 'a',
      polarity: 'asserts',
      validity: { kind: 'instant', at: nightTick('night_1') },
      canonicalizerVersion: 'cz_v0',
    }
    const claimY: CanonicalClaim = { ...claimX, contestedValue: 'b' }
    const claims = new Map<string, CanonicalClaim>([
      [beliefX.id, claimX],
      [beliefY.id, claimY],
    ])

    let store = initConflictStore(claims)
    store = commitBelief(store, universe, beliefX.id, nightTick('night_1')).store
    store = commitBelief(store, universe, beliefY.id, nightTick('night_1', 1)).store

    const bounds = { validT: nightTick('night_1', 2), txBound: store.nextSeq }
    const beforeEdge = currentBeliefs('NPC_PROJECTION', universe, store, bounds)
    expect(beforeEdge.unresolved).toHaveLength(1)
    expect(beforeEdge.unresolved[0]?.edgeId).toBeUndefined()

    const minted = mintEdge(store, beliefX.id, beliefY.id)
    expect(minted.outcome.verdict).toBe('minted')
    if (minted.outcome.verdict !== 'minted') throw new Error('unreachable')
    const afterEdge = currentBeliefs('NPC_PROJECTION', universe, minted.store, bounds)
    expect(afterEdge.unresolved).toHaveLength(1)
    expect(afterEdge.unresolved[0]?.edgeId).toBe(minted.outcome.edge.edgeId)
  })
})

describe('isConflictActive (§1.4 derived activity)', () => {
  it('CE_0001 remains active after correction -- Bel_C1\' carries the same (evidence-matching) claim as its evidence endpoint', () => {
    const scenario = buildConflictScenario()
    const [edge] = scenario.store.edges
    expect(edge).toBeDefined()
    if (edge === undefined) throw new Error('unreachable')
    const bounds = { validT: nightTick('night_5'), txBound: scenario.store.nextSeq }
    expect(isConflictActive(edge, scenario.universe, scenario.store, bounds)).toBe(true)
  })

  it('a synthetic edge with no current holder on either endpoint is inactive', () => {
    const scenario = buildConflictScenario()
    const syntheticEdge = {
      ...scenario.store.edges[0]!,
      edgeId: 'CE_synthetic',
      endpoints: [
        { claimKey: 'nonexistent-claim-key-a', witnessRecordId: 'nowhere' },
        { claimKey: 'nonexistent-claim-key-b', witnessRecordId: 'nowhere-else' },
      ] satisfies [{ claimKey: string; witnessRecordId: string }, { claimKey: string; witnessRecordId: string }],
      pairKey: 'synthetic-pair-key',
    }
    const bounds = { validT: nightTick('night_5'), txBound: scenario.store.nextSeq }
    expect(isConflictActive(syntheticEdge, scenario.universe, scenario.store, bounds)).toBe(false)
  })
})
