import { describe, expect, it } from 'vitest'
import { executeAttempt, validateAttempt, worldFacts } from './intentionActions'
import {
  buildIntentionBase,
  runInvalidAttemptFork,
  runScenario3,
  runScenario4,
} from './intentionScenario'
import { commitOutcome, dispatchAttempt, intentionTxBound, isIntentionOpen } from './intentionStore'
import type { ProofActionAttempt } from './intentionContracts'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'

/**
 * Action authority, plan failure hierarchy, delayed outcomes, and the
 * dispatch gate for Intention Lifecycle Replay v0 (ADR-0009 D9/D10, spec
 * §5): P13-P20 and faults F8 (dispatch against a closed intention) and F9
 * (delayed outcome for an attempt never dispatched).
 */

function attempt(overrides: Partial<ProofActionAttempt> = {}): ProofActionAttempt {
  return {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    id: 'AA_test',
    actor: 'NPC_C',
    action: 'speak-accusation',
    target: 'guard_captain',
    intentionId: 'IC_C1',
    planTemplateId: 'PT_report_gatehouse',
    dispatchedAtSeq: 1,
    ...overrides,
  }
}

describe('Scenario 3 -- plan failure / rebind / exhaustion (P13-P17)', () => {
  it('P13 -- one failed action (within retry_limit) writes no IntentionTransition; the intention stays open and retries', () => {
    const scenario3 = runScenario3()
    expect(scenario3.steps.blockedWalk.committedTransitions).toHaveLength(0)
    expect(scenario3.steps.blockedWalk.attempt.action).toBe('walk')
    // The retried walk also writes no transition and succeeds; the
    // intention is still open at that intermediate point.
    expect(scenario3.steps.retriedWalk.committedTransitions).toHaveLength(0)
    expect(isIntentionOpen(scenario3.afterRetry, scenario3.base.icC1, intentionTxBound(scenario3.afterRetry))).toBe(true)
  })

  it('P14 -- plan inapplicable (captain absent) rebinds to PT_report_watch, same IC_C1, identity/objective/support preserved; rebind not resume', () => {
    const scenario3 = runScenario3()
    const [rebind] = scenario3.steps.captainAbsent.committedTransitions
    expect(rebind?.kind).toBe('rebind')
    expect(rebind?.cause).toBe('plan-inapplicable')
    expect(rebind?.intentionId).toBe(scenario3.base.icC1)
    expect(rebind?.planBinding?.templateId).toBe('PT_report_watch')
    // rebind never carries support (D5).
    expect(rebind?.currentDependencySupport).toBeUndefined()
    // No suspend/resume anywhere -- this is rebind, not resume (D9).
    expect(scenario3.intentions.transitions.some((t) => t.intentionId === scenario3.base.icC1 && (t.kind === 'suspend' || t.kind === 'resume'))).toBe(false)
  })

  it('P15 -- all applicable templates + retries exhausted produces exactly one terminal fail(plan-exhausted)', () => {
    const scenario3 = runScenario3()
    const [fail] = scenario3.steps.watchmanAbsent.committedTransitions
    expect(fail?.kind).toBe('fail')
    expect(fail?.cause).toBe('plan-exhausted')
    const fails = scenario3.intentions.transitions.filter((t) => t.intentionId === scenario3.base.icC1 && t.kind === 'fail')
    expect(fails).toHaveLength(1)
    expect(isIntentionOpen(scenario3.intentions, scenario3.base.icC1, intentionTxBound(scenario3.intentions))).toBe(false)
  })

  it('P16 -- impossible and forbidden attempts return typed validator failures and mint NO consequence; holder perceives only a scope-computed observation', () => {
    const fork = runInvalidAttemptFork()

    const impossible = fork.intentions.outcomes.find((o) => o.id === fork.impossibleOutcomeId)
    expect(impossible?.verdict).toBe('rejected-impossible')
    expect(impossible?.consequenceId).toBeUndefined()
    expect(impossible?.observedResult).toBe('no-effect')

    const forbidden = fork.intentions.outcomes.find((o) => o.id === fork.forbiddenOutcomeId)
    expect(forbidden?.verdict).toBe('rejected-forbidden')
    expect(forbidden?.consequenceId).toBeUndefined()

    // No consequence records were minted for either.
    expect(fork.intentions.consequences).toHaveLength(0)

    // The engine's truth-derived reason persists engine-side but never
    // appears in the observation the holder perceives (D12).
    const observation = fork.intentions.observations.find((o) => o.truthRef === fork.intentions.attempts.find((a) => a.action === 'open')?.id)
    expect(observation?.perceived.result).toBe('no-effect')
    expect(JSON.stringify(observation)).not.toContain('barred-from-inside')
  })

  it('P17 -- the validator decides every attempt; a plain speak-accusation succeeds and mints exactly one consequence', () => {
    const decisionSuccess = validateAttempt(attempt(), worldFacts())
    expect(decisionSuccess.verdict).toBe('succeeded')
    expect(decisionSuccess.mintsConsequence).toBe(true)

    const decisionBlocked = validateAttempt(attempt({ action: 'walk', target: 'gatehouse' }), worldFacts({ blockedTargets: new Set(['gatehouse']) }))
    expect(decisionBlocked.verdict).toBe('failed')
    expect(decisionBlocked.mintsConsequence).toBe(false)

    // Movement never mints a consequence even when it succeeds.
    const decisionWalk = validateAttempt(attempt({ action: 'walk', target: 'gatehouse' }), worldFacts())
    expect(decisionWalk.verdict).toBe('succeeded')
    expect(decisionWalk.mintsConsequence).toBe(false)
  })
})

describe('Scenario 4 -- delayed outcome across closure (P18-P20)', () => {
  it('P18 -- an attempt dispatched while IC_C2 was open commits its outcome after abandonment; the outcome is retained and does not invalidate the attempt', () => {
    const scenario4 = runScenario4()
    // The attempt was dispatched before the abandon...
    expect(scenario4.warnAttempt.dispatchedAtSeq).toBeLessThan(scenario4.abandonTransition.commitSeq)
    // ...and its outcome committed after closure.
    const outcome = scenario4.intentions.outcomes.find((o) => o.id === scenario4.delayedOutcomeId)
    expect(outcome).toBeDefined()
    expect(outcome?.verdict).toBe('succeeded')
    // The historical attempt is still present, unchanged.
    expect(scenario4.intentions.attempts.some((a) => a.id === scenario4.warnAttempt.id)).toBe(true)
    // The intention is (and stays) closed.
    expect(isIntentionOpen(scenario4.intentions, scenario4.icC2, intentionTxBound(scenario4.intentions))).toBe(false)
  })

  it('P19/F8 -- no new attempt may dispatch for IC_C2 after it is closed (dispatch-closed-intention)', () => {
    const scenario4 = runScenario4()
    const refused = dispatchAttempt(scenario4.intentions, {
      actor: 'NPC_C',
      action: 'speak-warning',
      target: 'townsfolk',
      intentionId: scenario4.icC2,
      planTemplateId: 'PT_warn_townsfolk',
    })
    expect(refused.outcome).toEqual({ verdict: 'refused', fault: 'dispatch-closed-intention' })
    expect(refused.store).toBe(scenario4.intentions)
  })

  it('P20 -- the delayed outcome does not reopen IC_C2; any later re-adoption would be a fresh commitment', () => {
    const scenario4 = runScenario4()
    // The abandon remains the sole terminal transition; no re-open record exists.
    const terminals = scenario4.intentions.transitions.filter(
      (t) => t.intentionId === scenario4.icC2 && ['complete', 'fail', 'abandon'].includes(t.kind),
    )
    expect(terminals).toHaveLength(1)
    expect(isIntentionOpen(scenario4.intentions, scenario4.icC2, intentionTxBound(scenario4.intentions))).toBe(false)
  })
})

describe('F9 -- delayed outcome for an attempt that never validly dispatched', () => {
  it('committing an outcome for an unknown attempt id is rejected (outcome-without-dispatch)', () => {
    const base = buildIntentionBase()
    const result = commitOutcome(base.intentions, { attemptId: 'AA_never', verdict: 'succeeded', observedResult: 'done' })
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'outcome-without-dispatch' })
  })

  it('executing an attempt id that was never dispatched commits no consequence and reports the fault', () => {
    const base = buildIntentionBase()
    const result = executeAttempt(base.intentions, 'AA_never', worldFacts(), 'night_4')
    expect(result.outcome).toEqual({ verdict: 'rejected', fault: 'outcome-without-dispatch' })
  })

  it('a duplicate outcome for the same attempt is rejected', () => {
    const scenario4 = runScenario4()
    const dup = commitOutcome(scenario4.intentions, { attemptId: scenario4.warnAttempt.id, verdict: 'succeeded', observedResult: 'done' })
    expect(dup.outcome).toEqual({ verdict: 'rejected', fault: 'duplicate-outcome' })
  })
})

describe('dispatch gate -- routine attempts (D15)', () => {
  it('a routine attempt (intentionId null) dispatches without touching the intention gate', () => {
    const base = buildIntentionBase()
    const result = dispatchAttempt(base.intentions, { actor: 'NPC_R', action: 'patrol-move', target: 'gate', intentionId: null, planTemplateId: null })
    expect(result.outcome.verdict).toBe('dispatched')
  })

  it('an attempt for an unknown intention is refused', () => {
    const base = buildIntentionBase()
    const result = dispatchAttempt(base.intentions, { actor: 'NPC_C', action: 'x', target: 'y', intentionId: 'IC_NOPE', planTemplateId: null })
    expect(result.outcome).toEqual({ verdict: 'refused', fault: 'unknown-intention' })
  })
})
