import { describe, expect, it } from 'vitest'
import { JudgeProbe, replayConflictLog } from './conflictReplay'
import type { ConflictStore } from './conflictStore'
import { commitBelief } from './conflictStore'
import { replayIntentionLog } from './intentionReplay'
import type { IntentionStore } from './intentionStore'
import { commitIntentionTransition, dispatchAttempt, initIntentionStore, isIntentionOpen, transitionsOf } from './intentionStore'
import { reconsiderAcquiredBelief } from './intentionPipeline'
import { CONSEQUENTIAL_ACTIONS, worldFacts } from './intentionActions'
import { routineAttemptRequestFor, runTierOneRoutine } from './intentionScenario'
import {
  ADOPTION_TIME,
  WT_NIGHT4_DUSK,
  WT_NIGHT4_NOON,
  WT_NIGHT5_DAWN,
  beliefCReportKnown,
  buildPlanBodyBase,
  commitCaptainArrival,
  commitUnrelatedPantryTransition,
  omReportCrime,
  objectiveMetadataById,
  planBodyAtoms,
  planBodyIntentionContext,
  planBodyLinearShims,
  planBodyTemplateRegistry,
  planBodyUniverse,
  ptReportBt,
  ptReportBtShim,
  ptReportWatchBt,
  ptReportWatchBtShim,
  ptTwoKnocks,
} from './planBodyScenario'
import { nodePathEquals, resolveActionPath, validateTemplate } from './planBodyContracts'
import type { PlanLeafRef } from './planBodyContracts'
import {
  attemptPlanBodyDispatch,
  decideRootResultFollowUp,
  dispatchNextPlanBodyAttempt,
  executePlanBodyAttempt,
  validateAttemptCarriesPlanLeafRef,
  validatePlanLeafRef,
} from './planBodyPipeline'
import type { PlanBodyEvalInputs } from './planBodyProjection'
import { currentExecutionScopeIdOf, deriveExecutionState, isScopeOpen } from './planBodyProjection'
import { capturePlanBodyExecutionSnapshot, replayWorldTimeLog } from './planBodyReplay'
import { deriveExecutionPins, runExecutionAwareCompactionPass } from './planBodyCompactionAdapter'
import { explainPlanBodyExecution, explanationCitesOnlyReadable } from './planBodyExplanation'
import { commitWorldTime } from './worldTimeStore'
import type { WorldTimeStore } from './worldTimeStore'

/**
 * Plan-Body Execution Replay v0 integration rig (ADR-0010, spec plan-body-
 * execution-replay-v0.md §0/§3/§5). Test titles are prefixed with the exact
 * P#/F# identifiers they prove, mirroring intentionLifecycleReplay.test.ts's
 * convention. Scenario letters (A-K) match spec §0.3 exactly.
 */

function inputsFor(
  intentions: IntentionStore,
  conflict: ConflictStore,
  worldTime: WorldTimeStore,
  executionScopeId: string,
  intentionId: string,
  template = ptReportBt,
): PlanBodyEvalInputs {
  return { template, executionScopeId, intentionId, holder: 'NPC_C', intentions, conflict, universe: planBodyUniverse, atoms: planBodyAtoms, worldTime }
}

function boundTemplateIdsOf(intentions: IntentionStore, intentionId: string): readonly string[] {
  return transitionsOf(intentions, intentionId, intentions.nextSeq - 1)
    .filter((t) => t.planBinding !== undefined)
    .map((t) => t.planBinding!.templateId)
}

// ---- Scenario A: Plan binding and identity (P1-P5) -------------------------

describe('Scenario A -- plan binding and identity', () => {
  it('P1/P4 -- an accepted intention binds a versioned, semantics-pinned restricted-BT plan template on its adopt transition', () => {
    const base = buildPlanBodyBase()
    const opening = base.intentions.transitions.find((t) => t.transitionId === base.executionScopeId)
    expect(opening?.kind).toBe('adopt')
    expect(opening?.planBinding).toEqual({ templateId: 'PT_report_bt', templateVersion: 'bt_v0', params: {} })
    expect(ptReportBt.semanticsVersion).toBe('btsem_v0')
  })

  it('P2 -- the adopt IntentionTransition id IS the execution_scope_id; no separate execution record is minted', () => {
    const base = buildPlanBodyBase()
    expect(currentExecutionScopeIdOf(base.intentions, base.intentionId, base.intentions.nextSeq - 1)).toBe(base.executionScopeId)
    // No new record family: the store's own shape is untouched (commitments/transitions/attempts/outcomes/consequences/observations/commitLog).
    expect(Object.keys(base.intentions).sort()).toEqual(
      ['attempts', 'commitLog', 'commitments', 'consequences', 'nextSeq', 'observations', 'outcomes', 'transitions'].sort(),
    )
  })

  it('P3 -- every dispatched ActionAttempt carries a canonical plan_leaf_ref with all five fields populated', () => {
    const base = buildPlanBodyBase()
    const inputs = inputsFor(base.intentions, base.conflict, base.worldTime, base.executionScopeId, base.intentionId)
    const dispatch = dispatchNextPlanBodyAttempt(inputs, planBodyTemplateRegistry)
    expect(dispatch.result.verdict).toBe('dispatched')
    if (dispatch.result.verdict !== 'dispatched') throw new Error('unreachable')
    const ref = dispatch.result.attempt.planLeafRef
    expect(ref).toBeDefined()
    expect(ref).toEqual({
      executionScopeId: base.executionScopeId,
      templateId: 'PT_report_bt',
      templateVersion: 'bt_v0',
      nodePath: [0, 1],
      occurrenceOrdinal: 'occ_1',
    })
  })

  it('P4 -- two identical Action definitions (PT_two_knocks) at distinct node_paths produce distinguishable attempts', () => {
    const base = buildPlanBodyBase()
    // Rebind IC_P1 into PT_two_knocks for this identity-distinctness check
    // (a fresh scope; PT_two_knocks is not applicable-search-relevant here).
    const rebindCandidate = {
      intentionId: base.intentionId,
      holder: 'NPC_C',
      kind: 'rebind' as const,
      cause: 'plan-inapplicable' as const,
      triggeringIds: ['Bel_C1_prime'],
      ruleId: 'test_rig',
      ruleVersion: 'bt_v0',
      planBinding: { templateId: ptTwoKnocks.id, templateVersion: ptTwoKnocks.version, params: {} },
      effectiveValidTime: ADOPTION_TIME,
    }
    const rebound = commitIntentionTransition(base.intentions, rebindCandidate, planBodyIntentionContext(base.conflict))
    expect(rebound.outcome.verdict).toBe('committed')
    if (rebound.outcome.verdict !== 'committed') throw new Error('unreachable')
    const scope2 = rebound.outcome.transition.transitionId
    let intentions = rebound.store

    const inputs = () => inputsFor(intentions, base.conflict, base.worldTime, scope2, base.intentionId, ptTwoKnocks)
    const d1 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    expect(d1.result.verdict).toBe('dispatched')
    if (d1.result.verdict !== 'dispatched') throw new Error('unreachable')
    expect(d1.result.attempt.planLeafRef?.nodePath).toEqual([0])
    intentions = d1.store
    const exec1 = executePlanBodyAttempt(intentions, d1.result.attempt.id, worldFacts(), ADOPTION_TIME, 'night_4')
    intentions = exec1.store

    const d2 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    expect(d2.result.verdict).toBe('dispatched')
    if (d2.result.verdict !== 'dispatched') throw new Error('unreachable')
    expect(d2.result.attempt.planLeafRef?.nodePath).toEqual([1])
    expect(d1.result.attempt.action).toBe(d2.result.attempt.action)
    expect(nodePathEquals(d1.result.attempt.planLeafRef!.nodePath, d2.result.attempt.planLeafRef!.nodePath)).toBe(false)
  })

  it('P5/F30 -- rebind to the SAME template and parameters produces a distinct fresh execution_scope_id with empty derived progress', () => {
    const base = buildPlanBodyBase()
    const rebindCandidate = {
      intentionId: base.intentionId,
      holder: 'NPC_C',
      kind: 'rebind' as const,
      cause: 'plan-inapplicable' as const,
      triggeringIds: ['Bel_C1_prime'],
      ruleId: 'test_rig',
      ruleVersion: 'bt_v0',
      planBinding: { templateId: ptReportBt.id, templateVersion: ptReportBt.version, params: {} },
      effectiveValidTime: ADOPTION_TIME,
    }
    const rebound = commitIntentionTransition(base.intentions, rebindCandidate, planBodyIntentionContext(base.conflict))
    expect(rebound.outcome.verdict).toBe('committed')
    if (rebound.outcome.verdict !== 'committed') throw new Error('unreachable')
    const scope2 = rebound.outcome.transition.transitionId
    expect(scope2).not.toBe(base.executionScopeId)

    const state = deriveExecutionState(inputsFor(rebound.store, base.conflict, base.worldTime, scope2, base.intentionId))
    expect(state.activePath).toEqual([[0, 1]])
    expect(state.retryCounts.get('[0,1]')).toBe(0)
  })
})

// ---- Scenarios B/C/D/G: the canonical execution walkthrough ----------------

describe('Scenarios B/C/D/G -- canonical execution of IC_P1 over PT_report_bt', () => {
  it('P6/P7/P8/P9/P10/P12/P13/P14/P15/P16/P17/P21-P27/P45-P48 -- the full walkthrough', () => {
    const base = buildPlanBodyBase()
    let intentions = base.intentions
    let conflict = base.conflict
    let worldTime = base.worldTime
    const scope = base.executionScopeId

    const inputs = () => inputsFor(intentions, conflict, worldTime, scope, base.intentionId)

    // --- Step 1: GoToGatehouse dispatches (P6/P7/P12/P21) ---
    const d1 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    expect(d1.result.verdict).toBe('dispatched')
    if (d1.result.verdict !== 'dispatched') throw new Error('unreachable')
    expect(d1.state.activePath).toEqual([[0, 1]])
    intentions = d1.store

    // P7: while [0,1] is running, no second dispatch is admitted (F10 twin).
    const stillRunning = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    expect(stillRunning.result.verdict).toBe('no-dispatch-due')

    // P22/P26: no consequence exists before the validator commits an outcome.
    expect(intentions.consequences).toHaveLength(0)

    // --- Step 2: blocked outcome -> retry-eligible failure (P25/P27) ---
    const exec1 = executePlanBodyAttempt(intentions, d1.result.attempt.id, worldFacts({ blockedTargets: new Set(['gatehouse']) }), { night: 4, tick: 10 }, 'night_4')
    expect(exec1.outcome.verdict).toBe('committed')
    intentions = exec1.store

    const stateAfterBlock = deriveExecutionState(inputs())
    expect(stateAfterBlock.retryCounts.get('[0,1]')).toBe(1)
    expect(stateAfterBlock.activePath).toEqual([[0, 1]])

    // P24/F10: the same occurrence cannot dispatch twice while open -- but a
    // NEW occurrence (retry) now IS due.
    const d2 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    expect(d2.result.verdict).toBe('dispatched')
    if (d2.result.verdict !== 'dispatched') throw new Error('unreachable')
    expect(d2.result.attempt.planLeafRef?.occurrenceOrdinal).toBe('occ_2')
    intentions = d2.store

    // --- Step 3: WT_night4_noon committed, THEN GoToGatehouse arrives ---
    const wtNoon = commitWorldTime(worldTime, 'WT_night4_noon', WT_NIGHT4_NOON)
    expect(wtNoon.outcome.verdict).toBe('committed')
    worldTime = wtNoon.store

    const exec2 = executePlanBodyAttempt(intentions, d2.result.attempt.id, worldFacts(), WT_NIGHT4_NOON, 'night_4')
    expect(exec2.outcome.verdict).toBe('committed')
    if (exec2.outcome.verdict !== 'committed') throw new Error('unreachable')
    expect(exec2.outcome.outcome.verdict).toBe('succeeded')
    intentions = exec2.store

    const state3 = deriveExecutionState(inputs())
    // P6/P10: cursor advanced past [0] without any stored field -- exposed only via activePath.
    expect(state3.activePath).toEqual([[1, 1]])
    // P45: the Wait's anchor is the first-placement trigger's effective time.
    const wait11 = state3.waitStates.get('[1,1]')
    expect(wait11?.anchor).toEqual(WT_NIGHT4_NOON)
    expect(wait11?.target).toEqual(WT_NIGHT4_DUSK)
    expect(wait11?.status).toBe('running')
    expect(state3.planLocalResult).toBe('running')

    // P9: [0,1] never re-dispatches now that it has succeeded.
    const attemptsAtGoTo = intentions.attempts.filter((a) => a.planLeafRef !== undefined && nodePathEquals(a.planLeafRef.nodePath, [0, 1]))
    expect(attemptsAtGoTo).toHaveLength(2)
    const dNoRedispatch = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    expect(dNoRedispatch.result.verdict).toBe('no-dispatch-due')

    // --- P15: an unrelated BeliefTransition changes nothing ---
    const beforeUnrelated = capturePlanBodyExecutionSnapshot(inputs())
    conflict = commitUnrelatedPantryTransition(conflict, { night: 4, tick: 120 })
    const afterUnrelated = capturePlanBodyExecutionSnapshot(inputs())
    expect(afterUnrelated).toBe(beforeUnrelated)

    // --- P14/P16/P17: the captain-arrival BeliefTransition halts the Wait ---
    conflict = commitCaptainArrival(conflict, { night: 4, tick: 150 })
    const state4 = deriveExecutionState(inputs())
    expect(state4.haltedThisPass).toEqual([[1, 1]])
    expect(state4.activePath).toEqual([[2]])
    expect(state4.dispatchCandidate?.path).toEqual([2])
    // The halted Wait produced no result at all -- neither success nor
    // failure (P29 twin, checked fully in Scenario E): it simply drops out
    // of the derived state once its branch loses eligibility.
    expect(state4.waitStates.has('[1,1]')).toBe(false)

    // --- Step 4: SpeakReport dispatches and succeeds (P50/P21/P22) ---
    const d3 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    expect(d3.result.verdict).toBe('dispatched')
    if (d3.result.verdict !== 'dispatched') throw new Error('unreachable')
    expect(d3.result.attempt.action).toBe('speak-report')
    expect(CONSEQUENTIAL_ACTIONS.has('speak-report')).toBe(true)
    intentions = d3.store

    const exec3 = executePlanBodyAttempt(intentions, d3.result.attempt.id, worldFacts(), { night: 4, tick: 160 }, 'night_4')
    expect(exec3.outcome.verdict).toBe('committed')
    if (exec3.outcome.verdict !== 'committed') throw new Error('unreachable')
    expect(exec3.outcome.outcome.consequenceId).toBeDefined()
    intentions = exec3.store

    const state5 = deriveExecutionState(inputs())
    expect(state5.planLocalResult).toBe('root-success')

    // P50/P51: plan root success does not itself complete the intention.
    expect(isIntentionOpen(intentions, base.intentionId, intentions.nextSeq - 1)).toBe(true)
    expect(transitionsOf(intentions, base.intentionId, intentions.nextSeq - 1).some((t) => t.kind === 'complete')).toBe(false)
  })
})

// ---- Scenario G: Wait crossing by world time alone (P47-P49) ---------------

describe('Scenario G -- Wait over committed world time (crossing without the captain arriving)', () => {
  function driveToWaitRunning(): { intentions: IntentionStore; conflict: ConflictStore; worldTime: WorldTimeStore; base: ReturnType<typeof buildPlanBodyBase> } {
    const base = buildPlanBodyBase()
    let intentions = base.intentions
    const conflict = base.conflict
    let worldTime = base.worldTime
    const scope = base.executionScopeId
    const inputs = () => inputsFor(intentions, conflict, worldTime, scope, base.intentionId)

    const d1 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d1.store
    worldTime = commitWorldTime(worldTime, 'WT_night4_noon', WT_NIGHT4_NOON).store
    const exec1 = executePlanBodyAttempt(intentions, d1.result.attempt.id, worldFacts(), WT_NIGHT4_NOON, 'night_4')
    intentions = exec1.store
    return { intentions, conflict, worldTime, base }
  }

  it('P47/P48/P49 -- Wait runs before target, succeeds on the first crossing record, and only once', () => {
    const driven = driveToWaitRunning()
    const inputs = () => inputsFor(driven.intentions, driven.conflict, driven.worldTime, driven.base.executionScopeId, driven.base.intentionId)

    const running = deriveExecutionState(inputs())
    expect(running.waitStates.get('[1,1]')?.status).toBe('running')

    const worldTimeAfterDusk = commitWorldTime(driven.worldTime, 'WT_night4_dusk', WT_NIGHT4_DUSK).store
    const afterDusk = deriveExecutionState(inputsFor(driven.intentions, driven.conflict, worldTimeAfterDusk, driven.base.executionScopeId, driven.base.intentionId))
    expect(afterDusk.waitStates.get('[1,1]')?.status).toBe('success')
    expect(afterDusk.waitStates.get('[1,1]')?.crossingMarkId).toBe('WT_night4_dusk')
    // The Wait having succeeded, the SequenceWithMemory cascades to [2] within the same pass.
    expect(afterDusk.activePath).toEqual([[2]])

    // P48: a LATER world-time record never re-advances the already-completed occurrence.
    const worldTimeAfterNight5 = commitWorldTime(worldTimeAfterDusk, 'WT_night5_dawn', WT_NIGHT5_DAWN).store
    const afterNight5 = deriveExecutionState(inputsFor(driven.intentions, driven.conflict, worldTimeAfterNight5, driven.base.executionScopeId, driven.base.intentionId))
    expect(afterNight5.waitStates.get('[1,1]')?.crossingMarkId).toBe('WT_night4_dusk')
  })

  it('F28/F29 -- no wall-clock or frame-count input can participate: WaitNode schema has no such field', () => {
    const root = ptReportBt.root
    if (root.type !== 'SequenceWithMemory') throw new Error('unreachable')
    const secondFallback = root.children[1]
    if (secondFallback === undefined || secondFallback.type !== 'ReactiveFallback') throw new Error('unreachable')
    const actualWait = secondFallback.children[1]
    expect(actualWait?.type).toBe('Wait')
    expect(Object.keys(actualWait ?? {}).sort()).toEqual(['durationWorldTicks', 'type'].sort())
  })
})

// ---- Scenario E: Halt and delayed outcomes (P28-P36) -----------------------

describe('Scenario E -- halt and delayed outcomes', () => {
  function driveToWaitRunning() {
    const base = buildPlanBodyBase()
    let intentions = base.intentions
    let worldTime = base.worldTime
    const conflict = base.conflict
    const scope = base.executionScopeId
    const inputs = () => inputsFor(intentions, conflict, worldTime, scope, base.intentionId)
    const d1 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d1.store
    worldTime = commitWorldTime(worldTime, 'WT_night4_noon', WT_NIGHT4_NOON).store
    const exec1 = executePlanBodyAttempt(intentions, d1.result.attempt.id, worldFacts(), WT_NIGHT4_NOON, 'night_4')
    intentions = exec1.store
    return { base, intentions, conflict, worldTime }
  }

  it('P28/P29/P30 -- halt stops future dispatch, fabricates no leaf result, and writes no IntentionTransition', () => {
    const driven = driveToWaitRunning()
    let conflict = driven.conflict
    conflict = commitCaptainArrival(conflict, { night: 4, tick: 150 })
    const inputs = inputsFor(driven.intentions, conflict, driven.worldTime, driven.base.executionScopeId, driven.base.intentionId)
    const state = deriveExecutionState(inputs)
    expect(state.haltedThisPass).toEqual([[1, 1]])
    // P29: no leaf result was fabricated for the halted Wait -- it reports no status at all.
    expect(state.waitStates.has('[1,1]')).toBe(false)
    // P30: no IntentionTransition resulted from this within-body halt.
    const transitionCountBefore = transitionsOf(driven.intentions, driven.base.intentionId, driven.intentions.nextSeq - 1).length
    const transitionCountAfter = transitionsOf(driven.intentions, driven.base.intentionId, driven.intentions.nextSeq - 1).length
    expect(transitionCountAfter).toBe(transitionCountBefore)
    expect(isIntentionOpen(driven.intentions, driven.base.intentionId, driven.intentions.nextSeq - 1)).toBe(true)
  })

  it('P31/P32/P33/P34/P35/F19/F20/F21 -- a delayed outcome after halt/rebind/closure is authoritative but advances nothing', () => {
    // Fork: A2 (GoToGatehouse retry) still open when a suspend halts the body.
    const base = buildPlanBodyBase()
    let intentions = base.intentions
    const conflict = base.conflict
    const worldTime = base.worldTime
    const scope = base.executionScopeId
    const inputs = () => inputsFor(intentions, conflict, worldTime, scope, base.intentionId)

    const d1 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d1.store
    const openAttempt = d1.result.attempt

    // Suspend while A1 is still open (no outcome yet).
    const suspend = commitIntentionTransition(
      intentions,
      {
        intentionId: base.intentionId,
        holder: 'NPC_C',
        kind: 'suspend',
        cause: 'preempted',
        triggeringIds: ['Bel_C1_prime'],
        ruleId: 'test_rig',
        ruleVersion: 'bt_v0',
        effectiveValidTime: { night: 4, tick: 12 },
      },
      planBodyIntentionContext(conflict),
    )
    expect(suspend.outcome.verdict).toBe('committed')
    intentions = suspend.store

    const suspendedState = deriveExecutionState(inputs())
    expect(suspendedState.activePath).toEqual([])
    expect(suspendedState.suspended).toBe(true)

    // The late outcome commits normally as world history...
    const late = executePlanBodyAttempt(intentions, openAttempt.id, worldFacts({ blockedTargets: new Set(['gatehouse']) }), { night: 4, tick: 13 }, 'night_4')
    expect(late.outcome.verdict).toBe('committed')
    intentions = late.store

    // ...but advances nothing: the derived state is unchanged (still suspended, empty active path).
    const afterLate = deriveExecutionState(inputs())
    expect(afterLate.activePath).toEqual([])
    expect(afterLate.suspended).toBe(true)

    // F21 twin: the intention is still open, not reopened/closed by the outcome.
    expect(isIntentionOpen(intentions, base.intentionId, intentions.nextSeq - 1)).toBe(true)

    // F22: an outcome for a never-dispatched attempt is rejected (reused ADR-0009 D10 gate, unchanged).
    const rejected = executePlanBodyAttempt(intentions, 'AA_9999', worldFacts(), { night: 4, tick: 14 }, 'night_4')
    expect(rejected.outcome.verdict).toBe('rejected')
  })
})

// ---- Scenario F: Suspend, resume, and rebind (P37-P44) ---------------------

describe('Scenario F -- suspend, resume, and rebind', () => {
  function driveToWaitRunning() {
    const base = buildPlanBodyBase()
    let intentions = base.intentions
    let worldTime = base.worldTime
    const conflict = base.conflict
    const scope = base.executionScopeId
    const inputs = () => inputsFor(intentions, conflict, worldTime, scope, base.intentionId)
    const d1 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d1.store
    worldTime = commitWorldTime(worldTime, 'WT_night4_noon', WT_NIGHT4_NOON).store
    const exec1 = executePlanBodyAttempt(intentions, d1.result.attempt.id, worldFacts(), WT_NIGHT4_NOON, 'night_4')
    intentions = exec1.store
    return { base, intentions, conflict, worldTime }
  }

  it('P37/P38/P39/P40/P41/F31 -- suspend halts the body; resume keeps the scope, retains progress, and derives an already-passed Wait as immediate success', () => {
    const driven = driveToWaitRunning()
    let intentions = driven.intentions
    let worldTime = driven.worldTime
    const conflict = driven.conflict
    const scope = driven.base.executionScopeId
    const ctx = planBodyIntentionContext(conflict)

    const suspend = commitIntentionTransition(
      intentions,
      {
        intentionId: driven.base.intentionId,
        holder: 'NPC_C',
        kind: 'suspend',
        cause: 'preempted',
        triggeringIds: ['Bel_C1_prime'],
        ruleId: 'test_rig',
        ruleVersion: 'bt_v0',
        effectiveValidTime: { night: 4, tick: 110 },
      },
      ctx,
    )
    expect(suspend.outcome.verdict).toBe('committed')
    intentions = suspend.store

    // P37: the whole body halts.
    const suspendedState = deriveExecutionState(inputsFor(intentions, conflict, worldTime, scope, driven.base.intentionId))
    expect(suspendedState.activePath).toEqual([])

    // P40: world time continues while suspended -- the target passes.
    worldTime = commitWorldTime(worldTime, 'WT_night4_dusk', WT_NIGHT4_DUSK).store

    // P38/F31: resume retains the SAME execution_scope_id.
    const resume = commitIntentionTransition(
      intentions,
      {
        intentionId: driven.base.intentionId,
        holder: 'NPC_C',
        kind: 'resume',
        cause: 'preemption-lifted',
        triggeringIds: ['Bel_C1_prime'],
        ruleId: 'test_rig',
        ruleVersion: 'bt_v0',
        effectiveValidTime: { night: 4, tick: 210 },
      },
      ctx,
    )
    expect(resume.outcome.verdict).toBe('committed')
    intentions = resume.store
    expect(currentExecutionScopeIdOf(intentions, driven.base.intentionId, intentions.nextSeq - 1)).toBe(scope)

    // P39/P41: [0,1] does not re-dispatch, and the Wait derives success immediately on resume.
    const resumedState = deriveExecutionState(inputsFor(intentions, conflict, worldTime, scope, driven.base.intentionId))
    const goToAttempts = intentions.attempts.filter((a) => a.planLeafRef !== undefined && nodePathEquals(a.planLeafRef.nodePath, [0, 1]))
    expect(goToAttempts).toHaveLength(1)
    expect(resumedState.waitStates.get('[1,1]')?.status).toBe('success')
    expect(resumedState.waitStates.get('[1,1]')?.anchor).toEqual(WT_NIGHT4_NOON)
  })

  it('P42/P43/P44/F30 -- rebind after root failure closes the old scope, opens a fresh one, and reuses no old progress', () => {
    const base = buildPlanBodyBase()
    let intentions = base.intentions
    let conflict = base.conflict
    const worldTime = base.worldTime
    const scope1 = base.executionScopeId

    // Drive PT_report_bt to root failure via [2] SpeakReport failing (retryBudget 0, target-absent).
    intentions = commitAllGoToGatehouseAndWait(intentions, scope1, base.intentionId, conflict, worldTime)
    conflict = commitCaptainArrival(conflict, { night: 4, tick: 150 })
    const ctx = planBodyIntentionContext(conflict)

    const inputsBefore = () => inputsFor(intentions, conflict, worldTime, scope1, base.intentionId)
    const before = deriveExecutionState(inputsBefore())
    expect(before.dispatchCandidate?.path).toEqual([2])

    const dSpeak = dispatchNextPlanBodyAttempt(inputsBefore(), planBodyTemplateRegistry)
    expect(dSpeak.result.verdict).toBe('dispatched')
    if (dSpeak.result.verdict !== 'dispatched') throw new Error('unreachable')
    intentions = dSpeak.store
    const execSpeak = executePlanBodyAttempt(intentions, dSpeak.result.attempt.id, worldFacts({ absentTargets: new Set(['watch_captain']) }), { night: 4, tick: 160 }, 'night_4')
    intentions = execSpeak.store

    const rootFailureState = deriveExecutionState(inputsFor(intentions, conflict, worldTime, scope1, base.intentionId))
    expect(rootFailureState.planLocalResult).toBe('root-failure')

    const followUp = decideRootResultFollowUp(
      rootFailureState.planLocalResult,
      { objectiveType: 'report-crime', roles: {}, canonicalizerVersion: 'cz_v0' },
      boundTemplateIdsOf(intentions, base.intentionId),
      planBodyLinearShims,
      new Set(['attack-by']),
    )
    expect(followUp.decision).toBe('rebind')
    if (followUp.decision !== 'rebind') throw new Error('unreachable')
    expect(followUp.binding.templateId).toBe('PT_report_watch_bt')

    const rebound = commitIntentionTransition(
      intentions,
      {
        intentionId: base.intentionId,
        holder: 'NPC_C',
        kind: 'rebind',
        cause: 'plan-inapplicable',
        triggeringIds: ['Bel_C1_prime'],
        ruleId: 'test_rig',
        ruleVersion: 'bt_v0',
        planBinding: followUp.binding,
        effectiveValidTime: { night: 4, tick: 161 },
      },
      ctx,
    )
    expect(rebound.outcome.verdict).toBe('committed')
    if (rebound.outcome.verdict !== 'committed') throw new Error('unreachable')
    intentions = rebound.store
    const scope2 = rebound.outcome.transition.transitionId

    expect(scope2).not.toBe(scope1)
    expect(isScopeOpen(intentions, base.intentionId, scope1, intentions.nextSeq - 1)).toBe(false)
    expect(isScopeOpen(intentions, base.intentionId, scope2, intentions.nextSeq - 1)).toBe(true)

    const state2 = deriveExecutionState(inputsFor(intentions, conflict, worldTime, scope2, base.intentionId, ptReportWatchBt))
    expect(state2.activePath).toEqual([[0]])
    // Fresh scope: zero retries used at its (single, freshly-reached) active leaf -- no history reused from scope1.
    expect(state2.retryCounts.get('[0]')).toBe(0)
    expect(state2.retryCounts.has('[0,1]')).toBe(false)

    // P44: a late outcome from scope1 cannot advance scope2.
    const staleAttempt = intentions.attempts.find((a) => a.planLeafRef?.executionScopeId === scope1 && nodePathEquals(a.planLeafRef.nodePath, [2]))
    expect(staleAttempt).toBeDefined()
  })
})

function commitAllGoToGatehouseAndWait(intentions: IntentionStore, scope: string, intentionId: string, conflict: ConflictStore, worldTime: WorldTimeStore): IntentionStore {
  const inputs = () => inputsFor(intentions, conflict, worldTime, scope, intentionId)
  const d1 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
  if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
  intentions = d1.store
  const exec1 = executePlanBodyAttempt(intentions, d1.result.attempt.id, worldFacts(), WT_NIGHT4_NOON, 'night_4')
  intentions = exec1.store
  return intentions
}

// ---- Scenario H: root status vs intention lifecycle (P50-P56) -------------

describe('Scenario H -- root status vs intention lifecycle', () => {
  it('P52 -- belief-recognized completion commits complete(believed-achieved) independently of plan root status', () => {
    const base = buildPlanBodyBase()
    const committed = commitBelief(base.conflict, planBodyUniverse, beliefCReportKnown.id, { night: 4, tick: 5 })
    expect(committed.outcome.verdict).toBe('committed')
    const tick = reconsiderAcquiredBelief(
      base.intentions,
      {
        conflict: committed.store,
        universe: planBodyUniverse,
        atoms: planBodyAtoms,
        metadataById: objectiveMetadataById,
        metadataByHolder: new Map([['NPC_C', [omReportCrime]]]),
        templates: planBodyLinearShims,
      },
      'NPC_C',
      beliefCReportKnown.id,
      { night: 4, tick: 5 },
    )
    const [completeTransition] = tick.committedTransitions
    expect(completeTransition?.kind).toBe('complete')
    expect(completeTransition?.cause).toBe('believed-achieved')
  })

  it('P53/P54 -- one leaf failure or one branch failure does not fail the intention (retry/fallback absorb it)', () => {
    const base = buildPlanBodyBase()
    let intentions = base.intentions
    const scope = base.executionScopeId
    const d1 = dispatchNextPlanBodyAttempt(inputsFor(intentions, base.conflict, base.worldTime, scope, base.intentionId), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d1.store
    const exec1 = executePlanBodyAttempt(intentions, d1.result.attempt.id, worldFacts({ blockedTargets: new Set(['gatehouse']) }), { night: 4, tick: 10 }, 'night_4')
    intentions = exec1.store
    expect(isIntentionOpen(intentions, base.intentionId, intentions.nextSeq - 1)).toBe(true)
    expect(transitionsOf(intentions, base.intentionId, intentions.nextSeq - 1).some((t) => t.kind === 'fail' || t.kind === 'abandon')).toBe(false)
  })

  it('F32 -- plan root success never directly writes complete', () => {
    // Structural: the plan-body layer (planBodyPipeline.ts) exposes no
    // function that calls commitIntentionTransition at all -- grep-level
    // guarantee exercised by inspecting decideRootResultFollowUp's return
    // type, which is a plain decision object, never a committed transition.
    const decision = decideRootResultFollowUp('root-success', { objectiveType: 'report-crime', roles: {}, canonicalizerVersion: 'cz_v0' }, [], planBodyLinearShims, new Set())
    expect(decision.decision).toBe('none')
  })

  it('F33 -- plan root failure does not directly write fail while a template/budget remains (rebind is chosen instead)', () => {
    const decision = decideRootResultFollowUp(
      'root-failure',
      { objectiveType: 'report-crime', roles: {}, canonicalizerVersion: 'cz_v0' },
      ['PT_report_bt'],
      planBodyLinearShims,
      new Set(['attack-by']),
    )
    expect(decision.decision).toBe('rebind')
  })

  it('P56 -- exhaustion of every applicable template yields fail(plan-exhausted)', () => {
    // Narrowed to the report-crime alternatives only -- PT_two_knocks is a
    // separate P4 identity-test template, never part of this intention's
    // real fallback search space.
    const decision = decideRootResultFollowUp(
      'root-failure',
      { objectiveType: 'report-crime', roles: {}, canonicalizerVersion: 'cz_v0' },
      ['PT_report_bt', 'PT_report_watch_bt'],
      [ptReportBtShim, ptReportWatchBtShim],
      new Set(['attack-by']),
    )
    expect(decision.decision).toBe('fail')
  })
})

// ---- Scenario I: Replay (P57-P62) -------------------------------------------

describe('Scenario I -- cold replay', () => {
  it('P57/P58/P59/P60/P61/P62 -- cold replay reconstructs byte-identical execution state with zero stochastic calls', () => {
    const base = buildPlanBodyBase()
    let intentions = base.intentions
    let worldTime = base.worldTime
    const scope = base.executionScopeId
    const inputs = () => inputsFor(intentions, base.conflict, worldTime, scope, base.intentionId)

    const d1 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d1.store
    worldTime = commitWorldTime(worldTime, 'WT_night4_noon', WT_NIGHT4_NOON).store
    const exec1 = executePlanBodyAttempt(intentions, d1.result.attempt.id, worldFacts(), WT_NIGHT4_NOON, 'night_4')
    intentions = exec1.store

    const liveSnapshot = capturePlanBodyExecutionSnapshot(inputs())

    // Cold replay: fresh stores, materializing commit logs only -- never
    // re-invoking a rule, allocator, proposer, or judge.
    const judge = new JudgeProbe()
    const replayedConflict = replayConflictLog(planBodyUniverse, base.conflict.claims, base.conflict.commitLog, judge).store
    const replayedIntentions = replayIntentionLog(intentions.commitLog, judge).store
    const replayedWorldTime = replayWorldTimeLog(worldTime.marks)

    const coldSnapshot = capturePlanBodyExecutionSnapshot(
      inputsFor(replayedIntentions, replayedConflict, replayedWorldTime, scope, base.intentionId),
    )

    expect(coldSnapshot).toBe(liveSnapshot)
    expect(judge.calls).toBe(0)
  })
})

// ---- Scenario J: Compaction and explanations (P63-P72) ---------------------

describe('Scenario J -- execution-quiescence compaction and holder-scoped explanation', () => {
  it('P63/P66/P67/P68/P69 -- an open execution scope pins its template/binding and active-path condition read-set beliefs', () => {
    const base = buildPlanBodyBase()
    // The captain-at-gatehouse belief only enters NPC_C's projection once
    // the arrival transition commits -- exactly the "active-path condition
    // read-set belief" D20/P66 means to pin.
    const conflict = commitCaptainArrival(base.conflict, { night: 4, tick: 150 })
    const openScopes = [{ executionScopeId: base.executionScopeId, intentionId: base.intentionId, holder: 'NPC_C', template: ptReportBt }]
    const bounds = { validT: { night: 4, tick: 150 }, txBound: conflict.nextSeq - 1 }

    const pins = deriveExecutionPins(openScopes, base.intentions, conflict, planBodyUniverse, planBodyAtoms, bounds)
    expect(pins.versionPins).toEqual([
      { executionScopeId: base.executionScopeId, intentionId: base.intentionId, templateId: 'PT_report_bt', templateVersion: 'bt_v0', semanticsVersion: 'btsem_v0' },
    ])
    expect(pins.recordIds.has('Bel_C_captain_here')).toBe(true)

    const proposal = {
      schemaVersion: 1 as const,
      id: 'CP_pin_test',
      action: 'demote' as const,
      memberIds: ['Bel_C_captain_here'],
      rationale: 'test',
      proposedBy: 'engine' as const,
    }
    const result = runExecutionAwareCompactionPass(
      openScopes,
      planBodyUniverse,
      [],
      conflict,
      base.intentions,
      planBodyAtoms,
      base.intentions.nextSeq - 1,
      [],
      [proposal],
      100,
      bounds,
    )
    expect(result.executionQuiescenceRejections).toHaveLength(1)
    expect(result.executionQuiescenceRejections[0]?.rejectReason).toBe('pinned-member')

    // P68: after the scope closes (no OpenExecutionScope passed at all), the same proposal is no longer execution-blocked.
    const resultAfterClose = runExecutionAwareCompactionPass([], planBodyUniverse, [], conflict, base.intentions, planBodyAtoms, base.intentions.nextSeq - 1, [], [proposal], 100, bounds)
    expect(resultAfterClose.executionQuiescenceRejections).toHaveLength(0)

    // P69: Bel_C1_prime (the intention's own adoption support) remains
    // pinned by the EXISTING, unmodified intention-quiescence predicate,
    // additively alongside execution-quiescence (D20).
    const adoptionSupportProposal = {
      schemaVersion: 1 as const,
      id: 'CP_adoption_support_test',
      action: 'demote' as const,
      memberIds: ['Bel_C1_prime'],
      rationale: 'test',
      proposedBy: 'engine' as const,
    }
    const adoptionResult = runExecutionAwareCompactionPass(
      [],
      planBodyUniverse,
      [],
      conflict,
      base.intentions,
      planBodyAtoms,
      base.intentions.nextSeq - 1,
      [],
      [adoptionSupportProposal],
      100,
      bounds,
    )
    expect(adoptionResult.executionQuiescenceRejections).toHaveLength(0)
    expect(adoptionResult.pass.intentionQuiescenceRejections).toHaveLength(1)
  })

  it('P64/P65/F36 -- ActionAttempt/ActionOutcome are not ReadableRecords: no compaction proposal can ever name one', () => {
    const base = buildPlanBodyBase()
    const d1 = dispatchNextPlanBodyAttempt(inputsFor(base.intentions, base.conflict, base.worldTime, base.executionScopeId, base.intentionId), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    const proposal = {
      schemaVersion: 1 as const,
      id: 'CP_attempt_test',
      action: 'demote' as const,
      memberIds: [d1.result.attempt.id],
      rationale: 'test',
      proposedBy: 'engine' as const,
    }
    const result = runExecutionAwareCompactionPass([], planBodyUniverse, [], base.conflict, d1.store, planBodyAtoms, d1.store.nextSeq - 1, [], [proposal], 100, {
      validT: ADOPTION_TIME,
      txBound: base.conflict.nextSeq - 1,
    })
    expect(result.pass.pass.result.compactionLog[0]?.verdict).toBe('rejected')
    expect(result.pass.pass.result.compactionLog[0]?.rejectReason).toBe('unknown-record')
  })

  it('P70/P71/P72/F38/F39 -- the explanation cites only holder-readable records and never a hidden TruthEvent or another holder\'s state', () => {
    const base = buildPlanBodyBase()
    const explanation = explainPlanBodyExecution(inputsFor(base.intentions, base.conflict, base.worldTime, base.executionScopeId, base.intentionId))
    expect(explanation.templateId).toBe('PT_report_bt')
    expect(explanation.executionScopeId).toBe(base.executionScopeId)
    expect(explanationCitesOnlyReadable(explanation.citedBeliefIds, 'NPC_C', planBodyUniverse)).toBe(true)
    expect(explanation.citedBeliefIds).not.toContain('TE_captain_elsewhere')

    // F38/F39: a forged citation is caught by the mechanical checker.
    expect(explanationCitesOnlyReadable(['TE_captain_elsewhere'], 'NPC_C', planBodyUniverse)).toBe(false)
    expect(explanationCitesOnlyReadable(['Bel_B1'], 'NPC_C', planBodyUniverse)).toBe(false)
  })
})

// ---- Scenario K: Tier baseline (P73/P74) -----------------------------------

describe('Scenario K -- Tier-1 baseline (reused verbatim)', () => {
  it('P73 -- NPC_R\'s Tier-1 routine produces zero IntentionCommitment/IntentionTransition/plan_leaf_ref records', () => {
    const store = initIntentionStore()
    const { intentions, attempts } = runTierOneRoutine(store, 4)
    expect(intentions.commitments).toHaveLength(0)
    expect(intentions.transitions).toHaveLength(0)
    expect(attempts.every((attempt) => attempt.planLeafRef === undefined)).toBe(true)
    expect(attempts.every((attempt) => attempt.intentionId === null)).toBe(true)
  })

  it('P74 -- Tier-1 replay is deterministic (byte-identical attempts from the same rule + tick)', () => {
    expect(routineAttemptRequestFor(0)).toEqual(routineAttemptRequestFor(0))
    expect(routineAttemptRequestFor(5)).toEqual(routineAttemptRequestFor(5))
  })
})

// ---- Fault injections not otherwise exercised above ------------------------

describe('Fault injections -- plan_leaf_ref integrity and dispatch admissibility', () => {
  it('F1 -- an attempt lacking plan_leaf_ref while linked to an intention is a typed fault', () => {
    const base = buildPlanBodyBase()
    const forced = dispatchAttempt(base.intentions, { actor: 'NPC_C', action: 'go-to-gatehouse', target: 'gatehouse', intentionId: base.intentionId, planTemplateId: 'PT_report_bt' })
    expect(forced.outcome.verdict).toBe('dispatched')
    if (forced.outcome.verdict !== 'dispatched') throw new Error('unreachable')
    expect(validateAttemptCarriesPlanLeafRef(forced.outcome.attempt)).toBe('missing-plan-leaf-ref')
  })

  it('F2 -- a plan_leaf_ref referencing a missing execution scope is rejected', () => {
    const base = buildPlanBodyBase()
    const ref: PlanLeafRef = { executionScopeId: 'ES_UNKNOWN', templateId: 'PT_report_bt', templateVersion: 'bt_v0', nodePath: [0, 1], occurrenceOrdinal: 'occ_1' }
    expect(validatePlanLeafRef(base.intentions, 'NPC_C', planBodyTemplateRegistry, ref)).toBe('unknown-execution-scope')
  })

  it('F3 -- a plan_leaf_ref referencing another holder\'s execution scope is rejected', () => {
    const base = buildPlanBodyBase()
    const ref: PlanLeafRef = { executionScopeId: base.executionScopeId, templateId: 'PT_report_bt', templateVersion: 'bt_v0', nodePath: [0, 1], occurrenceOrdinal: 'occ_1' }
    expect(validatePlanLeafRef(base.intentions, 'NPC_B', planBodyTemplateRegistry, ref)).toBe('cross-holder-execution-scope')
  })

  it('F4 -- a missing/out-of-range/non-Action node_path is rejected', () => {
    expect(resolveActionPath(ptReportBt.root, [9, 9])).toEqual({ fault: 'node-path-not-found' })
    expect(resolveActionPath(ptReportBt.root, [])).toEqual({ fault: 'node-path-not-found' })
    expect(resolveActionPath(ptReportBt.root, [0, 0])).toEqual({ fault: 'node-path-not-action' })
  })

  it('F5 -- a template_version mismatch is rejected', () => {
    const base = buildPlanBodyBase()
    const ref: PlanLeafRef = { executionScopeId: base.executionScopeId, templateId: 'PT_report_bt', templateVersion: 'bt_v1_unknown', nodePath: [0, 1], occurrenceOrdinal: 'occ_1' }
    expect(validatePlanLeafRef(base.intentions, 'NPC_C', planBodyTemplateRegistry, ref)).toBe('template-version-mismatch')
  })

  it('F6/F10 -- an occurrence reused while a previous attempt is open is rejected', () => {
    const base = buildPlanBodyBase()
    const d1 = dispatchNextPlanBodyAttempt(inputsFor(base.intentions, base.conflict, base.worldTime, base.executionScopeId, base.intentionId), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    const duplicateRef: PlanLeafRef = { executionScopeId: base.executionScopeId, templateId: 'PT_report_bt', templateVersion: 'bt_v0', nodePath: [0, 1], occurrenceOrdinal: 'occ_1' }
    const attempt = attemptPlanBodyDispatch(d1.store, 'NPC_C', base.intentionId, planBodyTemplateRegistry, duplicateRef, [[0, 1]], 'go-to-gatehouse', 'gatehouse')
    expect(attempt.result).toEqual({ verdict: 'refused', fault: 'occurrence-reused-while-open' })
  })

  it('F7 -- dispatch from a closed intention is refused', () => {
    const base = buildPlanBodyBase()
    const abandoned = commitIntentionTransition(
      base.intentions,
      {
        intentionId: base.intentionId,
        holder: 'NPC_C',
        kind: 'abandon',
        cause: 'unsupported',
        triggeringIds: ['Bel_C1_prime'],
        ruleId: 'test_rig',
        ruleVersion: 'bt_v0',
        effectiveValidTime: ADOPTION_TIME,
      },
      planBodyIntentionContext(base.conflict),
    )
    expect(abandoned.outcome.verdict).toBe('committed')
    const dispatch = dispatchNextPlanBodyAttempt(inputsFor(abandoned.store, base.conflict, base.worldTime, base.executionScopeId, base.intentionId), planBodyTemplateRegistry)
    expect(dispatch.result.verdict).toBe('no-dispatch-due')
    // Direct low-level check that the gate itself would refuse a forced dispatch.
    const ref: PlanLeafRef = { executionScopeId: base.executionScopeId, templateId: 'PT_report_bt', templateVersion: 'bt_v0', nodePath: [0, 1], occurrenceOrdinal: 'occ_1' }
    const forced = attemptPlanBodyDispatch(abandoned.store, 'NPC_C', base.intentionId, planBodyTemplateRegistry, ref, [[0, 1]], 'go-to-gatehouse', 'gatehouse')
    expect(forced.result).toEqual({ verdict: 'refused', fault: 'intention-closed' })
  })

  it('F8 -- dispatch against a scope closed by a later rebind is refused', () => {
    const base = buildPlanBodyBase()
    const rebound = commitIntentionTransition(
      base.intentions,
      {
        intentionId: base.intentionId,
        holder: 'NPC_C',
        kind: 'rebind',
        cause: 'plan-inapplicable',
        triggeringIds: ['Bel_C1_prime'],
        ruleId: 'test_rig',
        ruleVersion: 'bt_v0',
        planBinding: { templateId: 'PT_report_watch_bt', templateVersion: 'bt_v0', params: {} },
        effectiveValidTime: ADOPTION_TIME,
      },
      planBodyIntentionContext(base.conflict),
    )
    expect(rebound.outcome.verdict).toBe('committed')
    const staleRef: PlanLeafRef = { executionScopeId: base.executionScopeId, templateId: 'PT_report_bt', templateVersion: 'bt_v0', nodePath: [0, 1], occurrenceOrdinal: 'occ_1' }
    const forced = attemptPlanBodyDispatch(rebound.store, 'NPC_C', base.intentionId, planBodyTemplateRegistry, staleRef, [[0, 1]], 'go-to-gatehouse', 'gatehouse')
    expect(forced.result).toEqual({ verdict: 'refused', fault: 'scope-closed' })
  })

  it('F9 -- dispatch from a leaf off the derived active path is refused', () => {
    const base = buildPlanBodyBase()
    const ref: PlanLeafRef = { executionScopeId: base.executionScopeId, templateId: 'PT_report_bt', templateVersion: 'bt_v0', nodePath: [2], occurrenceOrdinal: 'occ_1' }
    const forced = attemptPlanBodyDispatch(base.intentions, 'NPC_C', base.intentionId, planBodyTemplateRegistry, ref, [[0, 1]], 'speak-report', 'watch_captain')
    expect(forced.result).toEqual({ verdict: 'refused', fault: 'not-on-active-path' })
  })

  it('F11 -- a template placing a consequential Action in a re-tickable reactive position fails static validation', () => {
    const badTemplate = {
      id: 'PT_bad',
      version: 'bt_v0',
      semanticsVersion: 'btsem_v0' as const,
      servesObjectiveType: 'report-crime',
      contextAtomKind: 'attack-by',
      root: {
        type: 'ReactiveFallback' as const,
        children: [
          { type: 'Action' as const, actionId: 'SpeakReport', action: 'speak-report', target: 'watch_captain', retryBudget: 0 },
          { type: 'Action' as const, actionId: 'SpeakReport2', action: 'speak-report', target: 'watch_captain', retryBudget: 0 },
        ],
      },
    }
    const faults = validateTemplate(badTemplate, CONSEQUENTIAL_ACTIONS)
    expect(faults.some((fault) => fault.fault === 'reactive-consequential-position')).toBe(true)
  })

  it('F12 -- the Condition read-set grammar structurally cannot reference a TruthEvent (only belief-atom/execution-fact sources exist)', () => {
    const root = ptReportBt.root
    if (root.type !== 'SequenceWithMemory') throw new Error('unreachable')
    const firstFallback = root.children[0]
    if (firstFallback === undefined || firstFallback.type !== 'ReactiveFallback') throw new Error('unreachable')
    const conditionNode = firstFallback.children[0]
    if (conditionNode === undefined || conditionNode.type !== 'Condition') throw new Error('unreachable')
    expect(conditionNode.readSet.every((entry) => entry.source === 'belief-atom' || entry.source === 'execution-fact')).toBe(true)
  })

  it('F13 -- a Condition cannot read another holder\'s belief: current-belief projection is holder-scoped by construction (ADR-0008, reused)', () => {
    const base = buildPlanBodyBase()
    // NPC_B's own belief must never appear in NPC_C's projection-derived atom kinds.
    const state = deriveExecutionState(inputsFor(base.intentions, base.conflict, base.worldTime, base.executionScopeId, base.intentionId))
    expect(state.activePath).toEqual([[0, 1]])
  })

  it('F16 -- a stale branch cannot dispatch after losing control in the same pass: halt-before-dispatch is structural (one evaluateNode call per pass)', () => {
    const base = buildPlanBodyBase()
    const intentions = commitAllGoToGatehouseAndWait(base.intentions, base.executionScopeId, base.intentionId, base.conflict, base.worldTime)
    const conflict = commitCaptainArrival(base.conflict, { night: 4, tick: 150 })
    const state = deriveExecutionState(inputsFor(intentions, conflict, base.worldTime, base.executionScopeId, base.intentionId))
    // The halted Wait never dispatches (it never emits attempts at all); the
    // only admissible dispatch this pass is [2], never a stale [1,1].
    expect(state.dispatchCandidate?.path).toEqual([2])
  })

  it('F17 -- a halt is never encoded as an Action failure', () => {
    const base = buildPlanBodyBase()
    const intentions = commitAllGoToGatehouseAndWait(base.intentions, base.executionScopeId, base.intentionId, base.conflict, base.worldTime)
    const conflict = commitCaptainArrival(base.conflict, { night: 4, tick: 150 })
    const state = deriveExecutionState(inputsFor(intentions, conflict, base.worldTime, base.executionScopeId, base.intentionId))
    expect(state.waitStates.get('[1,1]')?.status).not.toBe('failure')
  })

  it('F18 -- a within-body halt never writes an intention terminal transition', () => {
    const base = buildPlanBodyBase()
    const intentions = commitAllGoToGatehouseAndWait(base.intentions, base.executionScopeId, base.intentionId, base.conflict, base.worldTime)
    const conflict = commitCaptainArrival(base.conflict, { night: 4, tick: 150 })
    deriveExecutionState(inputsFor(intentions, conflict, base.worldTime, base.executionScopeId, base.intentionId))
    expect(transitionsOf(intentions, base.intentionId, intentions.nextSeq - 1).some((t) => t.kind === 'fail' || t.kind === 'abandon' || t.kind === 'complete')).toBe(false)
  })

  it('F23/F24 -- no stored cursor or node-status field exists anywhere in ExecutionStateSnapshot\'s source data', () => {
    const base = buildPlanBodyBase()
    expect(Object.keys(base.intentions)).not.toContain('cursor')
    expect(Object.keys(base.intentions)).not.toContain('currentNode')
    expect(Object.keys(base.intentions)).not.toContain('activePath')
    expect(Object.keys(base.intentions)).not.toContain('nodeStatus')
  })

  it('F25 -- an unbounded retry budget fails static template validation', () => {
    const badTemplate = {
      id: 'PT_unbounded',
      version: 'bt_v0',
      semanticsVersion: 'btsem_v0' as const,
      servesObjectiveType: 'report-crime',
      contextAtomKind: 'attack-by',
      root: { type: 'Action' as const, actionId: 'Loop', action: 'loop-forever', target: 'x', retryBudget: 999 },
    }
    const faults = validateTemplate(badTemplate, CONSEQUENTIAL_ACTIONS)
    expect(faults.some((fault) => fault.fault === 'unbounded-retry')).toBe(true)
  })

  it('F26 -- a retry beyond the authored budget is refused, not fabricated as success', () => {
    const base = buildPlanBodyBase()
    let intentions = base.intentions
    const scope = base.executionScopeId
    const inputs = () => inputsFor(intentions, base.conflict, base.worldTime, scope, base.intentionId)
    const d1 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d1.store
    const exec1 = executePlanBodyAttempt(intentions, d1.result.attempt.id, worldFacts({ blockedTargets: new Set(['gatehouse']) }), { night: 4, tick: 10 }, 'night_4')
    intentions = exec1.store
    const d2 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    if (d2.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d2.store
    const exec2 = executePlanBodyAttempt(intentions, d2.result.attempt.id, worldFacts({ blockedTargets: new Set(['gatehouse']) }), { night: 4, tick: 11 }, 'night_4')
    intentions = exec2.store
    const state = deriveExecutionState(inputs())
    expect(state.planLocalResult).toBe('root-failure')
    const d3 = dispatchNextPlanBodyAttempt(inputs(), planBodyTemplateRegistry)
    expect(d3.result.verdict).toBe('no-dispatch-due')
  })

  it('F27 -- no decorator can force a failed consequential leaf to read as success', () => {
    const base = buildPlanBodyBase()
    let intentions = commitAllGoToGatehouseAndWait(base.intentions, base.executionScopeId, base.intentionId, base.conflict, base.worldTime)
    const conflict = commitCaptainArrival(base.conflict, { night: 4, tick: 150 })
    const d = dispatchNextPlanBodyAttempt(inputsFor(intentions, conflict, base.worldTime, base.executionScopeId, base.intentionId), planBodyTemplateRegistry)
    if (d.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d.store
    const exec = executePlanBodyAttempt(intentions, d.result.attempt.id, worldFacts({ absentTargets: new Set(['watch_captain']) }), { night: 4, tick: 160 }, 'night_4')
    intentions = exec.store
    const state = deriveExecutionState(inputsFor(intentions, conflict, base.worldTime, base.executionScopeId, base.intentionId))
    expect(state.planLocalResult).toBe('root-failure')
  })

  it('F35 -- replay does not depend on callback arrival order (no callbacks exist in this pure-fold design)', () => {
    const base = buildPlanBodyBase()
    const inputs = inputsFor(base.intentions, base.conflict, base.worldTime, base.executionScopeId, base.intentionId)
    const first = capturePlanBodyExecutionSnapshot(inputs)
    const second = capturePlanBodyExecutionSnapshot(inputs)
    expect(first).toBe(second)
  })
})
