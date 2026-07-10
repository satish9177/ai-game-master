import { describe, expect, it } from 'vitest'
import { canonicalHash, canonicalSerialize } from './canonicalSerialization'
import { readConflictRecord } from './conflictScope'
import { buildConflictScenario } from './conflictScenario'
import { readEvidence } from './evidenceRecords'
import { beliefA1, beliefD1 } from './evidenceScenario'
import { beliefC1, beliefC1Prime } from './compactionScenario'
import { beliefC2 } from './hierarchyScenario'

/**
 * Integration rig for Conflict-Edge Replay v0 (ADR-0008, spec conflict-
 * edge-replay-v0.md). Covers P2 (losing and winning beliefs both survive,
 * byte-identically) and P10 (core-retainment: every bystander belief is
 * byte-identical across the correction). The remaining P/N/F cases are
 * covered in their dedicated files: canonicalProposition.test.ts,
 * conflictStore.test.ts, beliefProjection.test.ts, conflictScope.test.ts,
 * conflictReplay.test.ts, conflictCompactionAdapter.test.ts,
 * worldStateSuccession.test.ts.
 */

describe('P2 -- losing and winning beliefs both survive, byte-identically', () => {
  it("Bel_C1 and Bel_C1' both remain addressable and byte-identical (mint hash unchanged) after correction", () => {
    const hashC1Before = canonicalHash(beliefC1)
    const hashC1PrimeBefore = canonicalHash(beliefC1Prime)

    const scenario = buildConflictScenario()

    expect(canonicalHash(beliefC1)).toBe(hashC1Before)
    expect(canonicalHash(beliefC1Prime)).toBe(hashC1PrimeBefore)

    const readOld = readEvidence('NPC_C', beliefC1.id, scenario.universe)
    const readNew = readEvidence('NPC_C', beliefC1Prime.id, scenario.universe)
    expect(readOld.verdict).toBe('granted')
    expect(readNew.verdict).toBe('granted')
    if (readOld.verdict !== 'granted' || readNew.verdict !== 'granted') throw new Error('unreachable')
    expect(canonicalSerialize(readOld.record)).toBe(canonicalSerialize({ kind: 'belief', record: beliefC1 }))
    expect(canonicalSerialize(readNew.record)).toBe(canonicalSerialize({ kind: 'belief', record: beliefC1Prime }))
  })
})

describe('P10 -- core-retainment: bystander beliefs are byte-identical across the correction', () => {
  it("NPC_A's, NPC_D's, and the pantry belief are unaffected by the Bel_C1 -> Bel_C1' correction", () => {
    const hashA1Before = canonicalHash(beliefA1)
    const hashD1Before = canonicalHash(beliefD1)
    const hashC2Before = canonicalHash(beliefC2)

    buildConflictScenario()

    expect(canonicalHash(beliefA1)).toBe(hashA1Before)
    expect(canonicalHash(beliefD1)).toBe(hashD1Before)
    expect(canonicalHash(beliefC2)).toBe(hashC2Before)
  })

  it('the conflict edge and transition are readable to their authorized holder and cite only real records', () => {
    const scenario = buildConflictScenario()
    const edgeRead = readConflictRecord('NPC_C', scenario.conflictEdgeId, scenario.store, scenario.universe)
    const transitionRead = readConflictRecord('NPC_C', scenario.transitionId, scenario.store, scenario.universe)
    expect(edgeRead.verdict).toBe('granted')
    expect(transitionRead.verdict).toBe('granted')
  })

  it('replaying the scenario builder itself is deterministic -- two independent builds agree byte-for-byte', () => {
    const first = buildConflictScenario()
    const second = buildConflictScenario()
    expect(canonicalSerialize(first.store.edges)).toBe(canonicalSerialize(second.store.edges))
    expect(canonicalSerialize(first.store.transitions)).toBe(canonicalSerialize(second.store.transitions))
    expect(first.conflictEdgeId).toBe(second.conflictEdgeId)
    expect(first.transitionId).toBe(second.transitionId)
  })
})
