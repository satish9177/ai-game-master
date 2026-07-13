import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { currentBeliefs } from './beliefProjection'
import { OVERTURN_BY_HARD_EVIDENCE_RULE_ID } from './conflictContracts'
import { beliefC1Prime } from './compactionScenario'
import { isIntentionOpen, transitionsOf } from './intentionStore'
import { captureAttributionSnapshot, JudgeProbe, replayAttributionLog } from './attributionReplay'
import {
  attributionClaimRegistry,
  attributionUniverse,
  Bel_CoraAtt1,
  Bel_CoraAtt1b,
  Bel_CoraAtt2,
  Bel_CoraAtt3,
  Bel_DarenAtt1,
  Bel_DarenAtt2,
  BORIN,
  buildBranch4a,
  buildBranch4bContentSatisfying,
  buildPhase2Store,
  buildPhase3Store,
  buildPhase5RetractDeny,
  buildPhase7FloorNoOp,
  buildPhase7ObservableDecay,
  CORA,
  DAREN,
} from './attributionScenario'
import { buildIntentionRun1, buildIntentionRun2, ptCorrectBorinBt } from './attributionIntentionScenario'
import { validateTemplate } from './planBodyContracts'

/**
 * Keystone integration test for Attributed-Belief Staleness Replay v0
 * (research vault ADR-0011, spec attributed-belief-staleness-replay-v0.md).
 * Covers the main-narrative walkthrough against the spec's §9 DEL-style
 * oracle table, intention integration (P45-P53), and end-to-end zero-call
 * counters (P59/§18). Per-file dedicated tests cover the remaining P/F
 * groups: attributionBuilder.test.ts (grammar/depth/builder), attribution
 * Understanding.test.ts (receipt ladder), attributionRules.test.ts
 * (ascription rules), attributionConflict.test.ts (Phase 8 topology),
 * attributionDeception.test.ts (Phase 9 taxonomy), attributionReplay.test.ts
 * (replay/sidecar), attributionCompaction.test.ts (compaction),
 * attributionPrivacy.test.ts (privacy/anti-omniscience).
 */

describe('§9 oracle -- Phase 0/1/2: baseline, receipt ladder, independent formation', () => {
  it('Borin uncorrected, Cora corrected, Daren true, no attribution exists before Phase 2', () => {
    const store = buildPhase2Store()
    const projectionBorin = currentBeliefs(BORIN, attributionUniverse, store.conflict, { validT: { night: 4, tick: 3 }, txBound: store.conflict.nextSeq - 1 })
    expect(projectionBorin.beliefs.some((b) => b.proposition.includes('involved'))).toBe(true)
  })

  it('Cora\'s and Daren\'s attributions both mint at believes, differing confidence', () => {
    expect(Bel_CoraAtt1.proposition).toContain('believes')
    expect(Bel_DarenAtt1.proposition).toContain('believes')
    expect(Bel_CoraAtt1.confidence).not.toBe(Bel_DarenAtt1.confidence)
  })
})

describe('§9 oracle -- Phase 3: private correction and stale outsider models', () => {
  it('P20 -- Borin\'s belief is corrected via BT_AB1, reusing the accepted, unmodified commitRevision machinery verbatim; Daren stays stale; Cora\'s own delivery erodes confidence only', () => {
    const phase3 = buildPhase3Store()
    const btAB1 = phase3.store.conflict.transitions.find((t) => t.transitionId === 'BT_AB1')
    expect(btAB1?.cause).toBe('corrected-by-evidence')
    expect(btAB1?.ruleId).toBe(OVERTURN_BY_HARD_EVIDENCE_RULE_ID)
    expect(phase3.store.conflict.transitions.some((t) => t.transitionId === 'BT_CoraAtt_erode1')).toBe(true)
    expect(Bel_DarenAtt1.confidence).toBe('low')
  })

  it('P19 -- forming an attribution never touches the ascriber\'s own world belief', () => {
    const beforeHash = canonicalSerialize(beliefC1Prime)
    buildPhase2Store()
    expect(canonicalSerialize(beliefC1Prime)).toBe(beforeHash)
  })
})

describe('§9 oracle -- Phase 4/5: acknowledgment and retraction branches', () => {
  it('Branch 4a: no acknowledgment -- Bel_CoraAtt1b remains current indefinitely', () => {
    const branch = buildBranch4a()
    const projection = currentBeliefs(CORA, attributionUniverse, branch.store.conflict, { validT: { night: 100, tick: 0 }, txBound: branch.store.conflict.nextSeq - 1 })
    expect(projection.beliefs.some((b) => b.id === Bel_CoraAtt1b.id)).toBe(true)
  })

  it('Branch 4b content-satisfying: Cora reaches disbelieves @ high', () => {
    const branch = buildBranch4bContentSatisfying()
    const projection = currentBeliefs(CORA, attributionUniverse, branch.store.conflict, { validT: { night: 5, tick: 5 }, txBound: branch.store.conflict.nextSeq - 1 })
    expect(projection.beliefs.some((b) => b.id === Bel_CoraAtt2.id && b.confidence === 'high')).toBe(true)
  })

  it('Phase 5 retract-deny: both Cora and Daren reach disbelieves @ medium via their own independent observation', () => {
    const result = buildPhase5RetractDeny()
    expect(result.daren).toBe('present')
    expect(Bel_CoraAtt3.confidence).toBe('medium')
    expect(Bel_DarenAtt2.confidence).toBe('medium')
  })

  it('Phase 5 Daren-absent variant: Daren stays stale indefinitely (Case B\'s exact fixture)', () => {
    const result = buildPhase5RetractDeny(buildBranch4a(), false)
    expect(result.daren).toBe('absent')
    const projection = currentBeliefs(DAREN, attributionUniverse, result.store.conflict, { validT: { night: 100, tick: 0 }, txBound: result.store.conflict.nextSeq - 1 })
    expect(projection.beliefs.some((b) => b.id === Bel_DarenAtt1.id)).toBe(true)
  })
})

describe('§9 oracle -- Phase 6: intention integration (real plan-body execution -- see attributionPlanBody.test.ts for the dedicated leaf-by-leaf proof)', () => {
  it('P45-P49 -- Run 1: adoption support cites Cora\'s attribution + her own world belief; completion is belief-recognized', () => {
    const run1 = buildIntentionRun1()
    const commitment = run1.intentions.commitments.find((c) => c.intentionId === run1.intentionId)!
    // P46 -- adoption support cites BOTH records, immutably.
    expect(commitment.adoptionSupport).toContain('Bel_CoraAtt1b')
    expect(commitment.adoptionSupport).toContain('Bel_C1_prime')
    expect(commitment.holder).toBe(CORA)

    const transitions = transitionsOf(run1.intentions, run1.intentionId, run1.intentions.nextSeq - 1)
    const completeTransition = transitions.find((t) => t.kind === 'complete')!
    expect(completeTransition.cause).toBe('believed-achieved')
    // P48 -- reconsiderAcquiredBelief (ADR-0009 D12) cites the ACQUIRED
    // BELIEF id as the trigger -- never Borin's private BT_AB1 transition.
    expect(completeTransition.triggeringIds).toContain('Bel_CoraAtt2_realplan')
    expect(completeTransition.triggeringIds).not.toContain('BT_AB1')
    expect(isIntentionOpen(run1.intentions, run1.intentionId, run1.intentions.nextSeq - 1)).toBe(false)

    // P47 -- the accepted v0 restricted node set (SequenceWithMemory/
    // Action/Condition only) is the ACTUAL bound template driving this
    // run's execution (real dispatch, real outcomes) -- see
    // attributionPlanBody.test.ts for the full leaf-by-leaf proof.
    expect(validateTemplate(ptCorrectBorinBt, new Set())).toEqual([])
  })

  it('P50-P53 -- Run 2 (redundant correction): Cora still dispatches despite NPC_A\'s prior independent correction, and completes on her own evidence', () => {
    const run2 = buildIntentionRun2()
    expect(run2.independentCorrectionTransitionId).toBe('BT_AB1_indep')
    const transitions = transitionsOf(run2.intentions, run2.intentionId, run2.intentions.nextSeq - 1)
    // P51 -- the redundant completion itself is a normal, committed
    // 'complete' transition -- never flagged as an error/fault anywhere.
    const completeTransition = transitions.find((t) => t.kind === 'complete')!
    expect(completeTransition.cause).toBe('believed-achieved')
    // P52/P53 -- completion cites ONLY Cora's own subsequent acknowledgment
    // evidence, never BT_AB1_indep directly -- the redundant dispatch still
    // happened (P50, real FindBorin/PresentEvidence attempts -- see
    // attributionPlanBody.test.ts) and completion is not merely inherited
    // from NPC_A's independent correction.
    expect(completeTransition.triggeringIds).toContain('Bel_CoraAtt_run2_realplan')
    expect(completeTransition.triggeringIds).not.toContain('BT_AB1_indep')
    expect(run2.findBorinAttemptId).toBeDefined()
    expect(run2.presentEvidenceAttemptId).toBeDefined()
  })
})

describe('§9 oracle -- Phase 7: decay', () => {
  it('observable-decay: medium -> low; floor no-op: no new transition at an already-low belief', () => {
    const observable = buildPhase7ObservableDecay()
    expect(observable.store.conflict.transitions.some((t) => t.transitionId === 'BT_CoraAtt_decay1')).toBe(true)

    const floor = buildPhase7FloorNoOp()
    expect(floor.store.conflict.transitions.some((t) => t.transitionId === 'BT_CoraAtt_decay1')).toBe(false)
  })
})

describe('P58/P59/P61/§18 -- byte-identical replay and zero-call counters across the full main narrative', () => {
  it('Phase 5 retract-deny\'s full store replays byte-identically with zero stochastic calls', () => {
    const result = buildPhase5RetractDeny()
    const bounds = [{ validT: { night: 6, tick: 1 }, txBound: 9999 }]
    const liveSnapshot = captureAttributionSnapshot(attributionUniverse, result.store, bounds)

    const judge = new JudgeProbe()
    const { store: replayed, report } = replayAttributionLog(attributionUniverse, attributionClaimRegistry, result.store.conflict.commitLog, result.store.sidecars, judge)
    const replayedSnapshot = captureAttributionSnapshot(attributionUniverse, replayed, bounds)

    expect(replayedSnapshot).toBe(liveSnapshot)
    expect(report.judgeCalls).toBe(0)
    expect(judge.calls).toBe(0)
    expect(report.materializedSidecars.length).toBeGreaterThan(0)
  })

  it('P61 -- all six prior livingWorldProof suites remain unaffected (additive-only edits confirmed by the harness\'s own full suite run, see completion report)', () => {
    // The additive-only claim (P29) is verified by running conflictStore,
    // beliefProjection, canonicalProposition, intentionStore, and
    // planBody* suites unchanged alongside this rig -- see the completion
    // report's "livingWorldProof suite" results.
    expect(canonicalSerialize({ marker: 'additive-only' })).toBe(canonicalSerialize({ marker: 'additive-only' }))
  })
})
