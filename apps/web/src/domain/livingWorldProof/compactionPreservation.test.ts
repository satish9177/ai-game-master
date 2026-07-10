import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { initStore, materialize, readEvidenceTiered, resolveRecord, withCorruptedSegment } from './coldStore'
import { derivePinSet, evaluateProposal } from './compactionGates'
import { replayCompaction, runCompactionPass } from './compactionPass'
import {
  arcCellarPostEvidence,
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
  pantryConsequence,
} from './compactionScenario'
import { replayConsequence } from './consequenceReplay'
import { beliefC2, observationB_T2, observationC_T2 } from './hierarchyScenario'
import { clawEvidence } from './scenario'
import { captureNavigationSnapshot, captureRecoverySnapshot } from './suiteSnapshot'

/**
 * The fused Compaction Preservation Test v0 rig (ADR-0007, spec
 * compaction-preservation-test.md §0/§5): Phase A baselines both
 * committed suites over the uncompacted universe; Phase B runs one
 * deterministic compaction pass; Phase C re-runs both suites against the
 * materialized (residence-resolved) post-compaction universe and asserts
 * byte-identity, plus the compaction-specific assertions P3-P8 and fault
 * injections F1-F5. No LLM anywhere in this file. Every reused function
 * (readable, readEvidence, buildDigest, projectTree, openNode, ...) comes
 * from the unedited, already-passed modules.
 */

// ---- Phase A: baseline, pre-compaction --------------------------------

const phaseARecovery = captureRecoverySnapshot(compactionUniverse)
const phaseANavigation = captureNavigationSnapshot(compactionArcs, compactionUniverse)

// ---- Phase B: the compaction pass --------------------------------------

const { store: compactedStore, result: passResult } = runCompactionPass(
  compactionUniverse,
  compactionArcs,
  contradictionEdges,
  compactionConsequences,
  happyPathProposals,
  HAPPY_PATH_BUDGET,
)

// ---- Phase C: re-proof against the compacted (materialized) store -----

const compactedUniverse = materialize(compactedStore)
const phaseCRecovery = captureRecoverySnapshot(compactedUniverse)
const phaseCNavigation = captureNavigationSnapshot(compactionArcs, compactedUniverse)

describe('Compaction Preservation Test v0 -- Phase B pass sanity', () => {
  it('completes with no budget-pressure alarm and demotes exactly the two pantry observations', () => {
    expect(passResult.alarm).toBeUndefined()
    expect(compactedStore.residence.get(observationB_T2.id)).not.toBe('hot')
    expect(compactedStore.residence.get(observationC_T2.id)).not.toBe('hot')
    expect(compactedStore.residence.get(beliefC2.id)).toBe('hot')
  })
})

describe('Compaction Preservation Test v0 -- positive assertions (spec §5 P1-P8)', () => {
  it('P1 -- the bounded evidence recovery suite is byte-identical pre/post compaction', () => {
    expect(canonicalSerialize(phaseCRecovery)).toBe(canonicalSerialize(phaseARecovery))
  })

  it('P2 -- the hierarchical evidence navigation suite is byte-identical pre/post compaction', () => {
    expect(canonicalSerialize(phaseCNavigation)).toBe(canonicalSerialize(phaseANavigation))
  })

  it('P3 -- exact recovery of a demoted record, byte-identical to its pre-demotion hot copy', () => {
    const preDemotionStore = initStore(compactionUniverse)

    const beforeC = readEvidenceTiered('NPC_C', observationC_T2.id, preDemotionStore)
    const afterC = readEvidenceTiered('NPC_C', observationC_T2.id, compactedStore)
    expect(beforeC.verdict).toBe('granted')
    expect(afterC.verdict).toBe('granted')
    if (beforeC.verdict !== 'granted' || afterC.verdict !== 'granted') throw new Error('unreachable')
    expect(canonicalSerialize(afterC.record)).toBe(canonicalSerialize(beforeC.record))

    const beforeB = readEvidenceTiered('NPC_B', observationB_T2.id, preDemotionStore)
    const afterB = readEvidenceTiered('NPC_B', observationB_T2.id, compactedStore)
    expect(beforeB.verdict).toBe('granted')
    expect(afterB.verdict).toBe('granted')
    if (beforeB.verdict !== 'granted' || afterB.verdict !== 'granted') throw new Error('unreachable')
    expect(canonicalSerialize(afterB.record)).toBe(canonicalSerialize(beforeB.record))
  })

  it('P4 -- citations to demoted records still resolve; no citation dangles, no id changed', () => {
    const mergeRecord = compactedStore.compactionLog.find((record) => record.action === 'merge_projection')
    expect(mergeRecord?.verdict).toBe('committed')
    for (const memberId of mergeRecord?.memberIds ?? []) {
      const resolved = resolveRecord(compactedStore, memberId)
      expect(resolved.verdict === 'hot' || resolved.verdict === 'paged-back').toBe(true)
    }

    // arc_pantry's own memberIds (the ADR-0006 structure) still resolve, unchanged.
    const arcPantryArc = compactionArcs.find((arc) => arc.id === 'arc_pantry')
    for (const memberId of arcPantryArc?.memberIds ?? []) {
      const resolved = resolveRecord(compactedStore, memberId)
      expect(resolved.verdict === 'hot' || resolved.verdict === 'paged-back').toBe(true)
    }
  })

  it('P5 -- consequence point-replay reproduces byte-identical outputs from paged-back inputs', () => {
    const preDemotionStore = initStore(compactionUniverse)
    const before = replayConsequence(pantryConsequence, preDemotionStore)
    const after = replayConsequence(pantryConsequence, compactedStore)
    expect(before.status).toBe('replayed')
    expect(canonicalSerialize(after)).toBe(canonicalSerialize(before))
  })

  it('P6 -- the historical NPC_C challenge yields the same evidence set and answer post-compaction', () => {
    const beforeDigest = phaseARecovery.perNpc.NPC_C!.digest
    const afterDigest = phaseCRecovery.perNpc.NPC_C!.digest
    expect(canonicalSerialize(afterDigest)).toBe(canonicalSerialize(beforeDigest))
    expect(phaseCRecovery.perNpc.NPC_C!.explanation).toContain('zombie_17')
    expect(afterDigest.clauses.some((clause) => clause.citations.includes(clawEvidence.id))).toBe(true)

    // arc_cellar (undemoted) is unaffected, and any demoted read pages back transparently.
    const oracleBefore = phaseANavigation.provenanceOracles[beliefC1.id]
    const oracleAfter = phaseCNavigation.provenanceOracles[beliefC1.id]
    expect(oracleAfter).toEqual(oracleBefore)
  })

  it('P7 -- byte-identical replay of the committed CompactionRecords, without re-running any gate', () => {
    const replayed = replayCompaction(compactionUniverse, compactedStore.compactionLog)
    expect(canonicalSerialize(replayed.segments)).toBe(canonicalSerialize(compactedStore.segments))
    expect(canonicalSerialize([...replayed.residence.entries()].sort())).toBe(
      canonicalSerialize([...compactedStore.residence.entries()].sort()),
    )
    expect(canonicalSerialize(materialize(replayed))).toBe(canonicalSerialize(materialize(compactedStore)))
  })

  it('P8 -- no NPC-visible surface reveals residence; a demoted record reads identically to a hot one', () => {
    const indexEntryBefore = phaseARecovery.perNpc.NPC_C!.indexMap.find((entry) => entry.recordId === observationC_T2.id)
    const indexEntryAfter = phaseCRecovery.perNpc.NPC_C!.indexMap.find((entry) => entry.recordId === observationC_T2.id)
    expect(canonicalSerialize(indexEntryAfter)).toBe(canonicalSerialize(indexEntryBefore))

    const readBefore = phaseARecovery.perNpc.NPC_C!.reads.find((entry) => entry.recordId === observationC_T2.id)
    const readAfter = phaseCRecovery.perNpc.NPC_C!.reads.find((entry) => entry.recordId === observationC_T2.id)
    expect(canonicalSerialize(readAfter)).toBe(canonicalSerialize(readBefore))
    if (readAfter?.outcome.verdict === 'granted') {
      expect(Object.keys(readAfter.outcome).sort()).toEqual(['call', 'record', 'verdict'])
    }
  })
})

describe('Compaction Preservation Test v0 -- fault injections (spec §5 F1-F5)', () => {
  const pinSet = derivePinSet(compactionUniverse, compactionArcs, contradictionEdges, compactionConsequences)

  it('F1 -- attempted physical deletion is rejected; the record stays recoverable', () => {
    const { store: faultStore } = runCompactionPass(
      compactionUniverse,
      compactionArcs,
      contradictionEdges,
      compactionConsequences,
      [deleteProposal],
      HAPPY_PATH_BUDGET,
    )
    const record = faultStore.compactionLog.find((entry) => entry.id === deleteProposal.id)
    expect(record?.verdict).toBe('rejected')
    expect(record?.rejectReason).toBe('deletion-forbidden')

    const outcome = readEvidenceTiered('NPC_C', observationC_T2.id, faultStore)
    expect(outcome.verdict).toBe('granted')

    // Exactly this checker fires -- no scope or contradiction rejection leaks in.
    expect(faultStore.compactionLog.every((entry) => entry.rejectReason === undefined || entry.rejectReason === 'deletion-forbidden')).toBe(
      true,
    )
  })

  it('F2 -- grouping across a contradiction/supersession edge is rejected; arc_cellar stays hot and intact', () => {
    const evaluated = evaluateProposal(contradictionGroupingProposal, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(evaluated.verdict).toBe('rejected')
    expect(evaluated.rejectReason).toBe('contradiction-edge')

    const { store: faultStore } = runCompactionPass(
      compactionUniverse,
      compactionArcs,
      contradictionEdges,
      compactionConsequences,
      [contradictionGroupingProposal],
      HAPPY_PATH_BUDGET,
    )
    for (const memberId of arcCellarPostEvidence.memberIds) {
      expect(faultStore.residence.get(memberId)).toBe('hot')
    }
    expect(faultStore.compactionLog.every((entry) => entry.rejectReason === undefined || entry.rejectReason === 'contradiction-edge')).toBe(
      true,
    )
  })

  it('F3 -- grouping across a scope boundary is rejected when evaluated atomically (the pass instead splits it, see compactionPass.test.ts)', () => {
    const evaluated = evaluateProposal(crossScopeGroupingProposal, compactionUniverse, contradictionEdges, pinSet, compactionArcs)
    expect(evaluated.verdict).toBe('rejected')
    expect(evaluated.rejectReason).toBe('scope-boundary')
  })

  it('F4 -- a page-back hash mismatch is detected and returns a typed fault, never a substituted record', () => {
    const corrupted = withCorruptedSegment(compactedStore, observationC_T2.id, '{"tampered":true}')
    const outcome = readEvidenceTiered('NPC_C', observationC_T2.id, corrupted)
    expect(outcome.verdict).toBe('hash-mismatch')

    // Unrelated reads, including the other demoted record, are unaffected.
    const otherOutcome = readEvidenceTiered('NPC_B', observationB_T2.id, corrupted)
    expect(otherOutcome.verdict).toBe('granted')
  })

  it('F5 -- budget unreachable under preservation gates emits an alarm, never deletion', () => {
    const { store: faultStore, result: faultResult } = runCompactionPass(
      compactionUniverse,
      compactionArcs,
      contradictionEdges,
      compactionConsequences,
      happyPathProposals,
      BUDGET_ALARM_BUDGET,
    )
    expect(faultResult.alarm).toBeDefined()
    expect(faultResult.alarm?.blockedBy).toContain('pinned-member')
    expect(faultStore.residence.get(beliefC2.id)).toBe('hot')
    expect(faultStore.compactionLog.some((entry) => entry.action === 'delete' && entry.verdict === 'committed')).toBe(false)
  })
})
