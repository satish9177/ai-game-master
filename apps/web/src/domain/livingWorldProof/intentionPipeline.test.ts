import { describe, expect, it } from 'vitest'
import { beliefC1, beliefC1Prime } from './compactionScenario'
import {
  beliefC1DoublePrime,
  runScenario1,
  runScenario2,
} from './intentionScenario'
import { detectStaleSupportIndex, identifyAffectedIntentions } from './intentionPipeline'

/**
 * Support-addressed reconsideration and the stale-index fault (ADR-0009
 * D5/D8, spec §5). F4 is the negative twin of P12: an index frozen on
 * immutable adoption support misses the second-hop supersession that the
 * current-support index catches.
 */

describe('P4 twin -- reconsideration is triggered through current dependency support, not by scanning all intentions', () => {
  it('BT_0001 (superseding Bel_C1) identifies IC_C1 as affected, and touches no other holder', () => {
    const scenario1 = runScenario1()
    const bt0001 = scenario1.conflict.transitions.find((transition) => transition.transitionId === 'BT_0001')
    expect(bt0001).toBeDefined()
    if (bt0001 === undefined) throw new Error('unreachable')

    // Using the base store (before the abandon) to see IC_C1 as still open.
    const base = scenario1.base
    const affected = identifyAffectedIntentions(base.intentions, bt0001)
    expect(affected).toEqual(['IC_C1'])
    // NPC_B's intention IC_B1 is never in the affected set for a C transition.
    expect(affected).not.toContain(base.icB1)
  })
})

describe('F4 -- stale current dependency support (the P12 negative twin)', () => {
  it("an index watching only adoption support misses BT_0003 (which supersedes the refreshed support Bel_C1''); the current-support index catches it", () => {
    const scenario2 = runScenario2()
    // In the afterRefresh state, IC_C2's adoption support is still [Bel_C1']
    // (immutable) while its CURRENT support is [Bel_C1'']. BT_0003
    // supersedes Bel_C1''.
    const bt0003 = scenario2.conflict.transitions.find((transition) => transition.transitionId === 'BT_0003')
    expect(bt0003).toBeDefined()
    if (bt0003 === undefined) throw new Error('unreachable')

    const afterRefresh = scenario2.afterRefresh.intentions

    const correct = identifyAffectedIntentions(afterRefresh, bt0003, 'current-support')
    expect(correct).toEqual(['IC_C2'])

    const staleView = identifyAffectedIntentions(afterRefresh, bt0003, 'adoption-support-only')
    expect(staleView).toEqual([]) // adoption support [Bel_C1'] does not contain Bel_C1''

    const report = detectStaleSupportIndex(afterRefresh, bt0003)
    expect(report).toEqual({ stale: true, fault: 'stale-support-index', missedIntentionIds: ['IC_C2'] })
  })

  it('the first-hop correction BT_0002 is caught by both indices (adoption support still names Bel_C1\' there)', () => {
    const scenario1 = runScenario1()
    // scenario1.intentions has IC_C2 open with current support [Bel_C1'] and
    // adoption support [Bel_C1']; a transition superseding Bel_C1' is caught
    // by both -- there is no stale-index divergence yet.
    const pseudoBt = {
      schemaVersion: 1 as const,
      transitionId: 'BT_0002',
      holder: 'NPC_C',
      fromBeliefId: beliefC1Prime.id,
      toBeliefId: beliefC1DoublePrime.id,
      effectiveValidTime: { night: 5, tick: 0 },
      commitSeq: 999,
      cause: 'superseded-by-update' as const,
      ruleId: 'x',
      ruleVersion: 'r_v0',
      canonicalizerVersion: 'cz_v0' as const,
      inputEvidenceIds: [],
      conflictEdgeIds: [],
    }
    const report = detectStaleSupportIndex(scenario1.intentions, pseudoBt)
    expect(report).toEqual({ stale: false })
    expect(identifyAffectedIntentions(scenario1.intentions, pseudoBt, 'adoption-support-only')).toEqual(['IC_C2'])
  })
})

describe('per-holder identification (D7)', () => {
  it('a transition on a belief no open intention depends on identifies nothing', () => {
    const scenario1 = runScenario1()
    const unrelated = {
      schemaVersion: 1 as const,
      transitionId: 'BT_pantry',
      holder: 'NPC_C',
      fromBeliefId: 'Bel_C2',
      toBeliefId: 'Bel_C2_prime',
      effectiveValidTime: { night: 4, tick: 2 },
      commitSeq: 999,
      cause: 'superseded-by-update' as const,
      ruleId: 'x',
      ruleVersion: 'r_v0',
      canonicalizerVersion: 'cz_v0' as const,
      inputEvidenceIds: [],
      conflictEdgeIds: [],
    }
    expect(identifyAffectedIntentions(scenario1.intentions, unrelated)).toEqual([])
    void beliefC1
  })
})
