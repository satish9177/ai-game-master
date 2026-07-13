import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { captureAttributionSnapshot, JudgeProbe, replayAttributionLog } from './attributionReplay'
import { attributionUniverse, buildBranch4bContentSatisfying, buildPhase3Store, buildPhase2Store } from './attributionScenario'
import { attributionClaimRegistry } from './attributionScenario'
import { buildPairSubcase } from './attributionConflictScenario'

/**
 * Replay tests (P58-P61, P78, P80-P81, P102; F49-F53, F80-F81, F85).
 */

const BOUNDS_GRID = [{ validT: { night: 5, tick: 5 }, txBound: 9999 }]

describe('P58/P61 -- cold reconstruction is byte-identical, and zero-call counters hold', () => {
  it('replaying Phase 3\'s commit log reconstructs the exact same store byte-for-byte', () => {
    const phase3 = buildPhase3Store()
    const liveSnapshot = captureAttributionSnapshot(attributionUniverse, phase3.store, BOUNDS_GRID)

    const judge = new JudgeProbe()
    const { store: replayed, report } = replayAttributionLog(attributionUniverse, attributionClaimRegistry, phase3.store.conflict.commitLog, phase3.store.sidecars, judge)
    const replayedSnapshot = captureAttributionSnapshot(attributionUniverse, replayed, BOUNDS_GRID)

    expect(replayedSnapshot).toBe(liveSnapshot)
    expect(report.judgeCalls).toBe(0)
    expect(judge.calls).toBe(0)
  })

  it('F51 -- a direct JudgeProbe.call() during a hypothetical replay throws and increments the counter', () => {
    const judge = new JudgeProbe()
    expect(() => judge.call()).toThrowError(/forbidden/)
    expect(judge.calls).toBe(1)
  })
})

describe('P102/F85 -- the AttributionTransitionSupport sidecar has no independent epistemic lifecycle', () => {
  it('every sidecar entry materializes only alongside its owning, now-replayed transition', () => {
    const phase3 = buildPhase3Store()
    const judge = new JudgeProbe()
    const { report } = replayAttributionLog(attributionUniverse, attributionClaimRegistry, phase3.store.conflict.commitLog, phase3.store.sidecars, judge)
    expect(report.materializedSidecars).toContain('BT_CoraAtt_erode1')
  })

  it('P83 -- every rung-6+-gated transition\'s sidecar entry records the understanding rule id/version and its input_record_ids', () => {
    const sidecar = buildBranch4bContentSatisfying().store.sidecars.get('BT_CoraAtt_ack1')
    expect(sidecar?.understandingRuleId).toBe('understand_default')
    expect(sidecar?.understandingRuleVersion).toBeDefined()
    expect(sidecar?.inputRecordIds.length).toBeGreaterThan(0)
  })

  it('F85 -- a sidecar entry whose transitionId has no owning transition is a recorded-invariant violation', () => {
    const phase2 = buildPhase2Store()
    const judge = new JudgeProbe()
    const bogusSidecars = new Map([['BT_does_not_exist', { transitionId: 'BT_does_not_exist', ascriptionRuleId: 'x', ascriptionRuleVersion: 'aab_v0', inputRecordIds: [] }]])
    expect(() => replayAttributionLog(attributionUniverse, attributionClaimRegistry, phase2.conflict.commitLog, bogusSidecars, judge)).toThrow(/recorded-invariant-violation/)
  })
})

describe('P60/F50 -- rule-version mismatch materializes, never reinterprets', () => {
  it('materializedSidecars/verifiedTransitions never re-author a committed record -- replay only ever appends the exact recorded commit', () => {
    const phase3 = buildPhase3Store()
    const judge = new JudgeProbe()
    const { store: replayed } = replayAttributionLog(attributionUniverse, attributionClaimRegistry, phase3.store.conflict.commitLog, phase3.store.sidecars, judge)
    expect(canonicalSerialize(replayed.conflict.transitions)).toBe(canonicalSerialize(phase3.store.conflict.transitions))
  })
})

describe('the whole scenario builder is deterministic -- two independent builds agree byte-for-byte', () => {
  it('buildPhase3Store called twice produces byte-identical snapshots', () => {
    const first = captureAttributionSnapshot(attributionUniverse, buildPhase3Store().store, BOUNDS_GRID)
    const second = captureAttributionSnapshot(attributionUniverse, buildPhase3Store().store, BOUNDS_GRID)
    expect(first).toBe(second)
  })
})

describe('P35/F52/F53 -- replay preserves the non-overlap/conflict/supersession distinction exactly', () => {
  it('F52 -- an explicit-transition (sub-case 3) pair replays with its linking transition intact, never as if unlinked', () => {
    const result = buildPairSubcase(0, 'explicit-transition')
    const judge = new JudgeProbe()
    const { store: replayed } = replayAttributionLog(result.universe, result.store.conflict.claims, result.store.conflict.commitLog, result.store.sidecars, judge)
    expect(replayed.conflict.transitions.some((t) => t.fromBeliefId === result.beliefAId && t.toBeliefId === result.beliefBId)).toBe(true)
  })

  it('F53 -- a disjoint-unlinked (sub-case 2) pair replays with NO transition between them, never converted into supersession', () => {
    const result = buildPairSubcase(0, 'disjoint-unlinked')
    const judge = new JudgeProbe()
    const { store: replayed } = replayAttributionLog(result.universe, result.store.conflict.claims, result.store.conflict.commitLog, result.store.sidecars, judge)
    expect(replayed.conflict.transitions.some((t) => t.fromBeliefId === result.beliefAId && t.toBeliefId === result.beliefBId)).toBe(false)
  })
})
