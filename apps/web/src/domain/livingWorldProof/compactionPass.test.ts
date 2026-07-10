import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { materialize } from './coldStore'
import { runCompactionPass, replayCompaction } from './compactionPass'
import {
  beliefC1,
  BUDGET_ALARM_BUDGET,
  compactionArcs,
  compactionConsequences,
  compactionUniverse,
  contradictionEdges,
  contradictionGroupingProposal,
  crossScopeGroupingProposal,
  deleteProposal,
  HAPPY_PATH_BUDGET,
  happyPathProposals,
} from './compactionScenario'
import { beliefC2, observationB_T2, observationC_T2 } from './hierarchyScenario'

function run(proposals: typeof happyPathProposals, budget: number) {
  return runCompactionPass(compactionUniverse, compactionArcs, contradictionEdges, compactionConsequences, proposals, budget)
}

describe('runCompactionPass -- happy path (spec §3)', () => {
  const { store, result } = run(happyPathProposals, HAPPY_PATH_BUDGET)

  it('completes with no budget-pressure alarm', () => {
    expect(result.alarm).toBeUndefined()
    expect(result.hotSize).toBe(HAPPY_PATH_BUDGET)
  })

  it('demotes both pantry observations', () => {
    expect(store.residence.get(observationB_T2.id)).not.toBe('hot')
    expect(store.residence.get(observationC_T2.id)).not.toBe('hot')
  })

  it('pins Bel_C2 (logs a committed pin, never demotes it)', () => {
    expect(store.residence.get(beliefC2.id)).toBe('hot')
    const pinRecord = store.compactionLog.find((r) => r.action === 'pin' && r.memberIds.includes(beliefC2.id))
    expect(pinRecord?.verdict).toBe('committed')
  })

  it('logs a committed per-scope merge_projection over each demoted pantry leaf, each riding arc_pantry', () => {
    const mergeRecords = store.compactionLog.filter((r) => r.action === 'merge_projection')
    expect(mergeRecords).toHaveLength(2)
    expect(mergeRecords.every((r) => r.verdict === 'committed')).toBe(true)
    expect(mergeRecords.every((r) => r.targetArcId === 'arc_pantry')).toBe(true)
    expect(mergeRecords.flatMap((r) => r.memberIds).sort()).toEqual([observationB_T2.id, observationC_T2.id].sort())
    // No single projection spans both scopes -- each rides one owner only.
    expect(mergeRecords.every((r) => r.memberIds.length === 1)).toBe(true)
  })

  it('never logs a delete action, committed or otherwise', () => {
    expect(store.compactionLog.some((r) => r.action === 'delete')).toBe(false)
  })

  it('leaves arc_cellar members untouched and hot', () => {
    expect(store.residence.get(beliefC1.id)).toBe('hot')
  })

  it('materialize still reconstructs the exact original universe after the pass', () => {
    expect(canonicalSerialize(materialize(store))).toBe(canonicalSerialize(compactionUniverse))
  })
})

describe('runCompactionPass -- F1 (physical deletion proposed)', () => {
  it('rejects the deletion; the targeted record stays hot and recoverable', () => {
    const { store } = run([deleteProposal], HAPPY_PATH_BUDGET)
    const record = store.compactionLog.find((r) => r.id === deleteProposal.id)
    expect(record?.verdict).toBe('rejected')
    expect(record?.rejectReason).toBe('deletion-forbidden')
    expect(store.residence.get(observationC_T2.id)).toBe('hot')
  })
})

describe('runCompactionPass -- F2 (contradiction-edge grouping proposed)', () => {
  it('rejects the grouping; arc_cellar stays hot and intact', () => {
    const { store } = run([contradictionGroupingProposal], HAPPY_PATH_BUDGET)
    const record = store.compactionLog.find((r) => r.id === contradictionGroupingProposal.id)
    expect(record?.verdict).toBe('rejected')
    expect(record?.rejectReason).toBe('contradiction-edge')
    expect(store.residence.get(beliefC1.id)).toBe('hot')
  })
})

describe('runCompactionPass -- cross-scope proposal is split, not rejected (spec §3 step 2)', () => {
  it('splits the unsplit pantry grouping into two per-scope commits with no scope-boundary rejection', () => {
    const { store } = run([crossScopeGroupingProposal], HAPPY_PATH_BUDGET)
    expect(store.compactionLog.some((r) => r.rejectReason === 'scope-boundary')).toBe(false)

    const demoteRecords = store.compactionLog.filter((r) => r.action === 'demote' && r.verdict === 'committed')
    expect(demoteRecords).toHaveLength(2)
    expect(demoteRecords.flatMap((r) => r.memberIds).sort()).toEqual([observationB_T2.id, observationC_T2.id].sort())

    expect(store.residence.get(observationB_T2.id)).not.toBe('hot')
    expect(store.residence.get(observationC_T2.id)).not.toBe('hot')
  })
})

describe('runCompactionPass -- F5 (budget unreachable under preservation gates)', () => {
  const { store, result } = run(happyPathProposals, BUDGET_ALARM_BUDGET)

  it('emits a typed budget-pressure alarm instead of deleting or force-demoting', () => {
    expect(result.alarm).toBeDefined()
    expect(result.alarm?.budget).toBe(BUDGET_ALARM_BUDGET)
    expect(result.alarm?.hotSize).toBeGreaterThan(BUDGET_ALARM_BUDGET)
    expect(result.alarm?.blockedBy).toContain('pinned-member')
  })

  it('never demotes the pinned Bel_C2 to close the gap', () => {
    expect(store.residence.get(beliefC2.id)).toBe('hot')
  })

  it('never logs a delete or tombstone action', () => {
    expect(store.compactionLog.some((r) => r.action === 'delete' && r.verdict === 'committed')).toBe(false)
  })
})

describe('replayCompaction (P7)', () => {
  it('reproduces byte-identical residence and segments from the committed log alone, without re-running any gate', () => {
    const { store: original } = run(happyPathProposals, HAPPY_PATH_BUDGET)
    const replayed = replayCompaction(compactionUniverse, original.compactionLog)

    expect(canonicalSerialize([...replayed.residence.entries()].sort())).toBe(canonicalSerialize([...original.residence.entries()].sort()))
    expect(canonicalSerialize(replayed.segments)).toBe(canonicalSerialize(original.segments))
    expect(canonicalSerialize(materialize(replayed))).toBe(canonicalSerialize(materialize(original)))

    // The committed merge_projection records carry their validated targetArcId
    // through replay unchanged (ADR-0007 D7 replay rule) -- and stay inert.
    const replayedMerges = replayed.compactionLog.filter((r) => r.action === 'merge_projection')
    expect(replayedMerges).toHaveLength(2)
    expect(replayedMerges.every((r) => r.targetArcId === 'arc_pantry')).toBe(true)
  })

  it('is deterministic across two independent replays', () => {
    const { store: original } = run(happyPathProposals, HAPPY_PATH_BUDGET)
    const replayA = replayCompaction(compactionUniverse, original.compactionLog)
    const replayB = replayCompaction(compactionUniverse, original.compactionLog)
    expect(canonicalSerialize(replayA.segments)).toBe(canonicalSerialize(replayB.segments))
    expect(canonicalSerialize([...replayA.residence.entries()].sort())).toBe(canonicalSerialize([...replayB.residence.entries()].sort()))
  })
})

describe('runCompactionPass determinism', () => {
  it('running the same pass twice produces byte-identical logs and residence', () => {
    const first = run(happyPathProposals, HAPPY_PATH_BUDGET)
    const second = run(happyPathProposals, HAPPY_PATH_BUDGET)
    expect(canonicalSerialize(first.store.compactionLog)).toBe(canonicalSerialize(second.store.compactionLog))
    expect(canonicalSerialize([...first.store.residence.entries()].sort())).toBe(canonicalSerialize([...second.store.residence.entries()].sort()))
  })

  it('does not mutate compactionUniverse', () => {
    const snapshot = structuredClone(compactionUniverse)
    run(happyPathProposals, HAPPY_PATH_BUDGET)
    expect(compactionUniverse).toEqual(snapshot)
  })
})
