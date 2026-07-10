import { describe, expect, it } from 'vitest'
import { canonicalHash, canonicalSerialize } from './canonicalSerialization'
import { beliefC1, beliefC1Prime } from './compactionScenario'
import { buildConflictScenario, beliefB1 } from './conflictScenario'
import { JudgeProbe } from './conflictReplay'
import { beliefA1, beliefD1 } from './evidenceScenario'
import { admitRumorAsCorroboration, deriveOptions, provenancePathHolders, scopedOptionInputs } from './intentionRules'
import {
  ADOPTION_TIME,
  beliefC1DoublePrime,
  beliefD2,
  buildIntentionBase,
  intentionUniverse,
  objectiveAtoms,
  objectiveMetadataByHolder,
  omWarnDanger,
  rumorDToB,
  runCompleteFork,
  runForbiddenFork,
  runImpossibleFork,
  runReturnedRumorFork,
  runScenario1,
  runScenario2,
  runTierOneRoutine,
  runUnrelatedNoOpFork,
  routineAttemptRequestFor,
} from './intentionScenario'
import { captureIntentionSnapshot, replayIntentionLog } from './intentionReplay'
import { currentSupportOf, initIntentionStore, intentionTxBound, isIntentionOpen } from './intentionStore'

/**
 * Integration rig for Intention Lifecycle Replay v0 (ADR-0009, spec
 * intention-lifecycle-replay-v0.md §5). This file carries the scenario-arc
 * properties P1-P9 (scenario 1), P10-P12 (scenario 2), P21-P22 (replay),
 * P26 (tier baseline), P27 (returned circular rumor), and faults F10 and
 * F12-F14. The remaining P/F cases live in their dedicated files:
 * intentionContracts.test.ts, intentionStore.test.ts (F1-F3, F5-F7,
 * F15-F20), intentionRules.test.ts, intentionPipeline.test.ts (P4/P5/P9
 * twins, F4), intentionActions.test.ts (P13-P20, F8/F9),
 * intentionCompactionAdapter.test.ts (P23/P24, F11), and
 * intentionScope.test.ts (P25).
 */

describe('Scenario 1 -- belief-correction reconsideration (P1-P9)', () => {
  it('P1 -- options over {Bel_C1} x OM_report_crime derive the report option; adopt mints exactly one IC_C1 and one adopt transition', () => {
    const base = buildIntentionBase()

    const inputs = scopedOptionInputs(
      'NPC_C',
      intentionUniverse,
      base.conflict,
      { validT: ADOPTION_TIME, txBound: base.conflict.nextSeq - 1 },
      objectiveAtoms,
      objectiveMetadataByHolder.get('NPC_C') ?? [],
    )
    const derived = deriveOptions(inputs)
    expect(derived.verdict).toBe('derived')
    if (derived.verdict !== 'derived') throw new Error('unreachable')
    expect(derived.options).toHaveLength(1)
    expect(derived.options[0]?.candidateObjective.objectiveType).toBe('report-crime')
    expect(derived.options[0]?.candidateObjective.roles.culprit).toBe('player')
    expect(derived.options[0]?.derivedFromBeliefs).toEqual([beliefC1.id])

    expect(base.icC1).toBe('IC_C1')
    const commitments = base.intentions.commitments.filter((commitment) => commitment.intentionId === 'IC_C1')
    expect(commitments).toHaveLength(1)
    const adopts = base.intentions.transitions.filter((transition) => transition.intentionId === 'IC_C1' && transition.kind === 'adopt')
    expect(adopts).toHaveLength(1)
    expect(adopts[0]?.currentDependencySupport).toEqual([beliefC1.id])
  })

  it('P2 -- adoption support is immutable and the commitment bytes never change across the whole arc', () => {
    const scenario2 = runScenario2()
    const commitment = scenario2.intentions.commitments.find((candidate) => candidate.intentionId === scenario2.scenario1.icC2)
    expect(commitment).toBeDefined()
    if (commitment === undefined) throw new Error('unreachable')
    // Adoption support still reads the ORIGINAL support after refresh (D5).
    expect(commitment.adoptionSupport).toEqual([beliefC1Prime.id])

    const baseCommitmentHash = canonicalHash(
      scenario2.scenario1.base.intentions.commitments.find((candidate) => candidate.intentionId === 'IC_C1'),
    )
    const finalCommitmentHash = canonicalHash(scenario2.intentions.commitments.find((candidate) => candidate.intentionId === 'IC_C1'))
    expect(finalCommitmentHash).toBe(baseCommitmentHash)
  })

  it('P3 -- E_claw commits BT_0001 byte-identically to Conflict-Edge Replay v0; no belief-layer record is modified', () => {
    const hashC1 = canonicalHash(beliefC1)
    const hashC1Prime = canonicalHash(beliefC1Prime)
    const hashA1 = canonicalHash(beliefA1)

    const reference = buildConflictScenario()
    const referenceTransition = reference.store.transitions.find((transition) => transition.transitionId === 'BT_0001')
    const scenario1 = runScenario1()
    const rigTransition = scenario1.conflict.transitions.find((transition) => transition.transitionId === 'BT_0001')

    expect(rigTransition).toBeDefined()
    expect(canonicalSerialize(rigTransition)).toBe(canonicalSerialize(referenceTransition))
    expect(canonicalHash(beliefC1)).toBe(hashC1)
    expect(canonicalHash(beliefC1Prime)).toBe(hashC1Prime)
    expect(canonicalHash(beliefA1)).toBe(hashA1)
  })

  it('P4/P6 -- BT_0001 triggers reconsideration of IC_C1 and closes it via exactly one typed terminal transition', () => {
    const scenario1 = runScenario1()
    expect(scenario1.abandonTransition.kind).toBe('abandon')
    expect(scenario1.abandonTransition.cause).toBe('unsupported')
    expect(scenario1.abandonTransition.triggeringIds).toEqual(['BT_0001'])
    expect(scenario1.abandonTransition.intentionId).toBe('IC_C1')

    const terminals = scenario1.intentions.transitions.filter(
      (transition) => transition.intentionId === 'IC_C1' && ['complete', 'fail', 'abandon'].includes(transition.kind),
    )
    expect(terminals).toHaveLength(1)
    expect(isIntentionOpen(scenario1.intentions, 'IC_C1', intentionTxBound(scenario1.intentions))).toBe(false)
  })

  it('P5 -- reconsider-before-dispatch: the pending accusation attempt for IC_C1 never dispatches in the BT_0001 tick', () => {
    const scenario1 = runScenario1()
    const attemptsForIcC1 = scenario1.dispatchedAfterCorrection.filter((attempt) => attempt.intentionId === 'IC_C1')
    expect(attemptsForIcC1).toHaveLength(0)
    // ...and no attempt for IC_C1 exists anywhere in the store either.
    expect(scenario1.intentions.attempts.filter((attempt) => attempt.intentionId === 'IC_C1')).toHaveLength(0)
  })

  it("P7 -- belief-driven re-adoption mints a NEW commitment IC_C2 from {Bel_C1'} x OM_warn_danger, not a reopen of IC_C1", () => {
    const scenario1 = runScenario1()
    expect(scenario1.icC2).toBe('IC_C2')
    const commitment = scenario1.intentions.commitments.find((candidate) => candidate.intentionId === 'IC_C2')
    expect(commitment?.canonicalObjective.objectiveType).toBe('warn-of-danger')
    expect(commitment?.canonicalObjective.roles.location).toBe('cellar')
    expect(commitment?.adoptionSupport).toEqual([beliefC1Prime.id])
    expect(commitment?.sourceObjectiveMetadataId).toBe(omWarnDanger.id)
    expect(isIntentionOpen(scenario1.intentions, 'IC_C1', intentionTxBound(scenario1.intentions))).toBe(false)
    expect(isIntentionOpen(scenario1.intentions, 'IC_C2', intentionTxBound(scenario1.intentions))).toBe(true)
  })

  it("P8 -- per-holder isolation: NPC_B's independently supported intention is byte-identical across C's entire arc", () => {
    const scenario2 = runScenario2()
    const base = scenario2.scenario1.base

    const bRecordsBefore = canonicalSerialize({
      commitments: base.intentions.commitments.filter((commitment) => commitment.holder === 'NPC_B'),
      transitions: base.intentions.transitions.filter((transition) => transition.holder === 'NPC_B'),
    })
    const bRecordsAfter = canonicalSerialize({
      commitments: scenario2.intentions.commitments.filter((commitment) => commitment.holder === 'NPC_B'),
      transitions: scenario2.intentions.transitions.filter((transition) => transition.holder === 'NPC_B'),
    })
    expect(bRecordsAfter).toBe(bRecordsBefore)
    expect(canonicalHash(beliefB1)).toBe(canonicalHash(beliefB1))
    expect(isIntentionOpen(scenario2.intentions, base.icB1, intentionTxBound(scenario2.intentions))).toBe(true)
  })

  it('P9 -- an unrelated pantry-incident correction reconsiders no intention and writes no IntentionTransition', () => {
    const scenario1 = runScenario1()
    const before = canonicalSerialize({ commitments: scenario1.intentions.commitments, transitions: scenario1.intentions.transitions })
    const fork = runUnrelatedNoOpFork(scenario1)
    expect(fork.committedTransitions).toHaveLength(0)
    const after = canonicalSerialize({ commitments: fork.intentions.commitments, transitions: fork.intentions.transitions })
    expect(after).toBe(before)
  })
})

describe('Scenario 2 -- support-refresh chain (P10-P12)', () => {
  it('P10 -- a re-entailing supersession produces exactly one refresh-support (never rebind), IC_C2 stays open, adoption support unchanged', () => {
    const scenario2 = runScenario2()
    expect(scenario2.refreshTransition.kind).toBe('refresh-support')
    expect(scenario2.refreshTransition.triggeringIds).toEqual(['BT_0002'])
    expect(scenario2.refreshTransition.previousDependencySupport).toEqual([beliefC1Prime.id])
    expect(scenario2.refreshTransition.currentDependencySupport).toEqual([beliefC1DoublePrime.id])
    expect(scenario2.refreshTransition.planBinding).toBeUndefined()

    const refreshes = scenario2.intentions.transitions.filter(
      (transition) => transition.intentionId === 'IC_C2' && transition.kind === 'refresh-support',
    )
    expect(refreshes).toHaveLength(1)

    const afterRefreshBound = intentionTxBound(scenario2.afterRefresh.intentions)
    expect(isIntentionOpen(scenario2.afterRefresh.intentions, 'IC_C2', afterRefreshBound)).toBe(true)
    const commitment = scenario2.intentions.commitments.find((candidate) => candidate.intentionId === 'IC_C2')
    expect(commitment?.adoptionSupport).toEqual([beliefC1Prime.id])
    // Plan binding unchanged across the refresh.
    const bindings = scenario2.intentions.transitions.filter(
      (transition) => transition.intentionId === 'IC_C2' && transition.planBinding !== undefined,
    )
    expect(bindings).toHaveLength(1)
  })

  it("P11 -- current dependency support derives to [Bel_C1''] deterministically (adoption support folded with the latest refresh)", () => {
    const scenario2 = runScenario2()
    const bound = intentionTxBound(scenario2.afterRefresh.intentions)
    const first = currentSupportOf(scenario2.afterRefresh.intentions, 'IC_C2', bound)
    const second = currentSupportOf(scenario2.afterRefresh.intentions, 'IC_C2', bound)
    expect(first).toEqual([beliefC1DoublePrime.id])
    expect(canonicalSerialize(second)).toBe(canonicalSerialize(first))
  })

  it("P12 -- the second correction is caught because the index watches CURRENT support [Bel_C1''], and abandons IC_C2", () => {
    const scenario2 = runScenario2()
    expect(scenario2.removalTransition.kind).toBe('abandon')
    expect(scenario2.removalTransition.cause).toBe('unsupported')
    expect(scenario2.removalTransition.triggeringIds).toEqual(['BT_0003'])
    expect(isIntentionOpen(scenario2.intentions, 'IC_C2', intentionTxBound(scenario2.intentions))).toBe(false)
  })
})

describe('Terminal behaviour -- belief-recognized completion, forbiddenness, impossibility (D12)', () => {
  it('a belief entailing achievement completes the intention (complete, believed-achieved)', () => {
    const fork = runCompleteFork()
    expect(fork.completeTransition.kind).toBe('complete')
    expect(fork.completeTransition.cause).toBe('believed-achieved')
    expect(fork.completeTransition.triggeringIds).toEqual(['Bel_C_warned'])
  })

  it('a forbidden-condition belief abandons the intention (abandon, forbidden-by-belief)', () => {
    const fork = runForbiddenFork()
    expect(fork.abandonTransition.kind).toBe('abandon')
    expect(fork.abandonTransition.cause).toBe('forbidden-by-belief')
  })

  it('an impossibility belief abandons the intention (abandon, impossible-by-belief)', () => {
    const fork = runImpossibleFork()
    expect(fork.abandonTransition.kind).toBe('abandon')
    expect(fork.abandonTransition.cause).toBe('impossible-by-belief')
  })
})

describe('P21/P22 -- byte-identical replay with zero stochastic calls', () => {
  it('P21 -- replaying the recorded log reconstructs commitments, transitions, and projections byte-for-byte, including the support chain', () => {
    const scenario2 = runScenario2()
    const judge = new JudgeProbe()
    const replayed = replayIntentionLog(scenario2.intentions.commitLog, judge)

    const boundsGrid = Array.from({ length: scenario2.intentions.nextSeq }, (_, index) => index)
    expect(captureIntentionSnapshot(replayed.store, boundsGrid)).toBe(captureIntentionSnapshot(scenario2.intentions, boundsGrid))

    // The projected current-dependency-support chain reproduces
    // {Bel_C1'} -> {Bel_C1''} on the replayed store exactly (D5/P21).
    const refreshSeq = scenario2.refreshTransition.commitSeq
    expect(currentSupportOf(replayed.store, 'IC_C2', refreshSeq - 1)).toEqual([beliefC1Prime.id])
    expect(currentSupportOf(replayed.store, 'IC_C2', refreshSeq)).toEqual([beliefC1DoublePrime.id])
    expect(currentSupportOf(scenario2.intentions, 'IC_C2', refreshSeq - 1)).toEqual([beliefC1Prime.id])
    expect(currentSupportOf(scenario2.intentions, 'IC_C2', refreshSeq)).toEqual([beliefC1DoublePrime.id])

    // Two independent replays agree byte-for-byte as well.
    const secondReplay = replayIntentionLog(scenario2.intentions.commitLog, new JudgeProbe())
    expect(captureIntentionSnapshot(secondReplay.store, boundsGrid)).toBe(captureIntentionSnapshot(replayed.store, boundsGrid))
  })

  it('P22 -- proposer/judge invocation count during replay is exactly zero (explicit call-count assertion)', () => {
    const scenario2 = runScenario2()
    const judge = new JudgeProbe()
    const replayed = replayIntentionLog(scenario2.intentions.commitLog, judge)
    expect(judge.calls).toBe(0)
    expect(replayed.report.judgeCalls).toBe(0)
  })

  it('F10 -- any proposer/judge call during replay is a hard failure', () => {
    const judge = new JudgeProbe()
    expect(() => judge.call()).toThrowError(/forbidden/)
    expect(judge.calls).toBe(1)
  })

  it('the whole scenario builder is deterministic -- two independent runs agree byte-for-byte', () => {
    const first = runScenario2()
    const second = runScenario2()
    const grid = Array.from({ length: first.intentions.nextSeq }, (_, index) => index)
    expect(captureIntentionSnapshot(second.intentions, grid)).toBe(captureIntentionSnapshot(first.intentions, grid))
  })
})

describe('P26 -- Tier-1 baseline: routine behaviour mints zero intention records (D15)', () => {
  it('NPC_R patrols across the run with zero IntentionCommitments and zero IntentionTransitions, and replay re-derives its behaviour', () => {
    const routine = runTierOneRoutine(initIntentionStore(), 4)

    expect(routine.intentions.commitments.filter((commitment) => commitment.holder === 'NPC_R')).toHaveLength(0)
    expect(routine.intentions.transitions.filter((transition) => transition.holder === 'NPC_R')).toHaveLength(0)
    expect(routine.intentions.commitments).toHaveLength(0)
    expect(routine.attempts.every((attempt) => attempt.intentionId === null)).toBe(true)

    // Replay materializes the recorded attempts byte-for-byte...
    const replayed = replayIntentionLog(routine.intentions.commitLog, new JudgeProbe())
    expect(canonicalSerialize(replayed.store.attempts)).toBe(canonicalSerialize(routine.intentions.attempts))
    // ...and the behaviour itself re-derives from routine rules + the tick
    // alone (derive-don't-store): the pure function reproduces each step.
    routine.attempts.forEach((attempt, tick) => {
      const derived = routineAttemptRequestFor(tick)
      expect(attempt.actor).toBe(derived.actor)
      expect(attempt.action).toBe(derived.action)
      expect(attempt.target).toBe(derived.target)
    })
  })
})

describe('P27/F14 -- returned circular rumor boundary (D16)', () => {
  it('P27 -- the returned rumor restores no belief and re-adopts no accusation intention; the correct-rumor alternative derives instead', () => {
    const fork = runReturnedRumorFork()

    // B's accusation intention was abandoned by the authoritative correction...
    expect(fork.bAbandonTransition.kind).toBe('abandon')
    expect(fork.bAbandonTransition.holder).toBe('NPC_B')
    // ...and hearing D's returned rumor commits NO BeliefTransition
    // restoring the old belief: B's only transition remains BT_0006.
    const bBeliefTransitions = fork.conflict.transitions.filter((transition) => transition.holder === 'NPC_B')
    expect(bBeliefTransitions.map((transition) => transition.transitionId)).toEqual(['BT_0006'])

    // No accusation-based intention is re-adopted from the returned rumor.
    expect(fork.postRumorAdoption.adopted).toBeUndefined()
    const bReportCommitments = fork.intentions.commitments.filter(
      (commitment) => commitment.holder === 'NPC_B' && commitment.canonicalObjective.objectiveType === 'report-crime',
    )
    expect(bReportCommitments).toHaveLength(1) // only the original IC_B1, never a re-adoption

    // B derives the deterministic correct-the-rumor option from its CURRENT beliefs.
    expect(fork.correctRumorAdoption.adopted?.verdict).toBe('committed')
    if (fork.correctRumorAdoption.adopted?.verdict !== 'committed') throw new Error('unreachable')
    expect(fork.correctRumorAdoption.adopted.commitment.canonicalObjective.objectiveType).toBe('correct-rumor')
  })

  it("F14 -- a circular rumor descending through B's own claim is rejected as independent corroboration by the provenance check", () => {
    const path = provenancePathHolders(rumorDToB, intentionUniverse)
    expect(path).toContain('NPC_B')

    const outcome = admitRumorAsCorroboration('NPC_B', rumorDToB, intentionUniverse)
    expect(outcome).toEqual({ admitted: false, fault: 'circular-corroboration' })
  })

  it('control -- a genuinely independent report (rooted in an eyewitness belief) is admitted as corroboration', () => {
    const independentRumor = { ...rumorDToB, id: 'R_D_to_B_independent', sourceBelief: beliefD1.id, proposition: beliefD1.proposition }
    const outcome = admitRumorAsCorroboration('NPC_B', independentRumor, intentionUniverse)
    expect(outcome).toEqual({ admitted: true })
    expect(provenancePathHolders(independentRumor, intentionUniverse)).toEqual(['NPC_D'])
  })
})

describe('F12/F13 -- truth-boundary and uncommitted-rumor injections into option generation (D6/D16)', () => {
  it('F12 -- an option generator input carrying a TruthEvent or a truth-derived feasibility quantity is rejected', () => {
    const base = buildIntentionBase()
    const inputs = scopedOptionInputs(
      'NPC_C',
      intentionUniverse,
      base.conflict,
      { validT: ADOPTION_TIME, txBound: base.conflict.nextSeq - 1 },
      objectiveAtoms,
      objectiveMetadataByHolder.get('NPC_C') ?? [],
    )

    const withTruth = deriveOptions({ ...inputs, extraSignals: [{ kind: 'truth-event', recordId: 'T1' }] })
    expect(withTruth).toEqual({ verdict: 'rejected', fault: 'truth-event-input' })

    const withFeasibility = deriveOptions({ ...inputs, extraSignals: [{ kind: 'truth-derived-feasibility', value: 0.9 }] })
    expect(withFeasibility).toEqual({ verdict: 'rejected', fault: 'truth-derived-feasibility' })
  })

  it('F13 -- an incoming rumor consumed before the belief calculus commits is rejected', () => {
    const base = buildIntentionBase()
    const inputs = scopedOptionInputs(
      'NPC_B',
      intentionUniverse,
      base.conflict,
      { validT: ADOPTION_TIME, txBound: base.conflict.nextSeq - 1 },
      objectiveAtoms,
      objectiveMetadataByHolder.get('NPC_B') ?? [],
    )
    const withRawRumor = deriveOptions({ ...inputs, extraSignals: [{ kind: 'raw-rumor', rumorId: rumorDToB.id }] })
    expect(withRawRumor).toEqual({ verdict: 'rejected', fault: 'uncommitted-rumor-input' })
  })

  it("F12 sibling -- another holder's belief smuggled into the projection input is rejected", () => {
    const base = buildIntentionBase()
    const inputs = scopedOptionInputs(
      'NPC_C',
      intentionUniverse,
      base.conflict,
      { validT: ADOPTION_TIME, txBound: base.conflict.nextSeq - 1 },
      objectiveAtoms,
      objectiveMetadataByHolder.get('NPC_C') ?? [],
    )
    const withForeignBelief = deriveOptions({ ...inputs, beliefs: [...inputs.beliefs, beliefD2] })
    expect(withForeignBelief).toEqual({ verdict: 'rejected', fault: 'cross-holder-belief-input' })
  })
})
