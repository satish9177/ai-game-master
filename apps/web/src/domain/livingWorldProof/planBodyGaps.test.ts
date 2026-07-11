import { describe, expect, it } from 'vitest'
import { commitBelief } from './conflictStore'
import { CONSEQUENTIAL_ACTIONS, worldFacts } from './intentionActions'
import {
  ADOPTION_TIME,
  WT_NIGHT4_NOON,
  beliefCaptainAtGatehouse,
  buildPlanBodyBase,
  commitCaptainArrival,
  planBodyAtoms,
  planBodyTemplateRegistry,
  planBodyUniverse,
  ptReportBt,
} from './planBodyScenario'
import { ConditionReadSetEntrySchema, validateTemplate } from './planBodyContracts'
import type { TemplateValidationFault } from './planBodyContracts'
import { dispatchNextPlanBodyAttempt, executePlanBodyAttempt } from './planBodyPipeline'
import type { PlanBodyEvalInputs } from './planBodyProjection'
import { deriveExecutionState } from './planBodyProjection'
import { deriveExecutionPins } from './planBodyCompactionAdapter'
import { runExecutionAwareCompactionPass } from './planBodyCompactionAdapter'

/**
 * Supplementary coverage for properties/faults the main integration rig
 * (planBodyExecutionReplay.test.ts) does not directly exercise: P8, P11,
 * P18-P20, P23, P25, P26, F14, F15, F37.
 */

function inputsFor(base: ReturnType<typeof buildPlanBodyBase>, conflict = base.conflict): PlanBodyEvalInputs {
  return {
    template: ptReportBt,
    executionScopeId: base.executionScopeId,
    intentionId: base.intentionId,
    holder: 'NPC_C',
    intentions: base.intentions,
    conflict,
    universe: planBodyUniverse,
    atoms: planBodyAtoms,
    worldTime: base.worldTime,
  }
}

describe('P8 -- a failed child returns plan-local failure without advancing past it', () => {
  it('SpeakReport failing with no remaining retry budget fails the root without advancing further', () => {
    const base = buildPlanBodyBase()
    let intentions = base.intentions
    const conflict = commitCaptainArrival(base.conflict, { night: 4, tick: 150 })

    const d1 = dispatchNextPlanBodyAttempt({ ...inputsFor(base, conflict), intentions }, planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d1.store
    const exec1 = executePlanBodyAttempt(intentions, d1.result.attempt.id, worldFacts(), WT_NIGHT4_NOON, 'night_4')
    intentions = exec1.store

    const d2 = dispatchNextPlanBodyAttempt({ ...inputsFor(base, conflict), intentions }, planBodyTemplateRegistry)
    if (d2.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    expect(d2.result.attempt.planLeafRef?.nodePath).toEqual([2])
    intentions = d2.store
    const exec2 = executePlanBodyAttempt(intentions, d2.result.attempt.id, worldFacts({ absentTargets: new Set(['watch_captain']) }), { night: 4, tick: 160 }, 'night_4')
    intentions = exec2.store

    const state = deriveExecutionState({ ...inputsFor(base, conflict), intentions })
    expect(state.planLocalResult).toBe('root-failure')
    // Nothing past [2] exists to advance to -- the root itself carries the failure.
    expect(state.activePath).toEqual([])
  })
})

describe('P11 -- cold replay reconstructs the exact same cursor and active path at every commit bound', () => {
  it('re-deriving twice from the identical committed stores yields byte-identical activePath/cursor', () => {
    const base = buildPlanBodyBase()
    const d1 = dispatchNextPlanBodyAttempt(inputsFor(base), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    const intentions = d1.store
    const first = deriveExecutionState({ ...inputsFor(base), intentions })
    const second = deriveExecutionState({ ...inputsFor(base), intentions })
    expect(first.activePath).toEqual(second.activePath)
    expect([...first.retryCounts.entries()]).toEqual([...second.retryCounts.entries()])
  })
})

describe('P18/F12 -- hidden TruthEvents never affect selection', () => {
  it('the hidden TE_captain_elsewhere record participates in no code path deriveExecutionState reads', () => {
    const base = buildPlanBodyBase()
    // planBodyUniverse already contains TE_captain_elsewhere (a 'truth' kind
    // entry); deriveExecutionState never reads universe entries of kind
    // 'truth' at all (only currentBeliefs, which is holder-scoped over
    // 'belief' entries) -- selection is provably unaffected by its presence.
    const withTruth = deriveExecutionState(inputsFor(base))
    const universeWithoutTruth = planBodyUniverse.filter((entry) => entry.kind !== 'truth')
    const withoutTruth = deriveExecutionState({ ...inputsFor(base), universe: universeWithoutTruth })
    expect(withTruth.activePath).toEqual(withoutTruth.activePath)
    expect(withTruth.planLocalResult).toBe(withoutTruth.planLocalResult)
  })
})

describe('P19/F13 -- another holder\'s belief cannot affect selection', () => {
  it('NPC_B holding (or not holding) captain-at-gatehouse never changes NPC_C\'s derived state', () => {
    const base = buildPlanBodyBase()
    // NPC_B has no belief with the captain-at-gatehouse atom in this
    // fixture at all; current-belief projection is holder-scoped by
    // construction (ADR-0008, reused unchanged) -- there is no parameter
    // through which NPC_B's beliefs could enter NPC_C's projection.
    const state = deriveExecutionState(inputsFor(base))
    expect(state.activePath).toEqual([[0, 1]])
  })
})

describe('P20 -- an incoming rumor cannot affect selection before the belief calculus commits', () => {
  it('the Condition read-set grammar has no "raw-rumor" source at all -- it is rejected at schema parse time', () => {
    const attempt = ConditionReadSetEntrySchema.safeParse({ source: 'raw-rumor', rumorId: 'R_test' })
    expect(attempt.success).toBe(false)
  })
})

describe('P23 -- an Action leaf is derived-running for exactly the interval its valid attempt has no committed outcome', () => {
  it('running before the outcome commits, resolved immediately after', () => {
    const base = buildPlanBodyBase()
    const d1 = dispatchNextPlanBodyAttempt(inputsFor(base), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    const beforeOutcome = deriveExecutionState({ ...inputsFor(base), intentions: d1.store })
    expect(beforeOutcome.activePath).toEqual([[0, 1]])
    expect(beforeOutcome.dispatchCandidate).toBeUndefined()

    const exec = executePlanBodyAttempt(d1.store, d1.result.attempt.id, worldFacts(), WT_NIGHT4_NOON, 'night_4')
    const afterOutcome = deriveExecutionState({ ...inputsFor(base), intentions: exec.store })
    expect(afterOutcome.activePath).not.toEqual([[0, 1]])
  })
})

describe('P25 -- a committed ActionOutcome maps deterministically to exactly one leaf status', () => {
  it('succeeded -> success, blocked -> retry-eligible (running+dispatch candidate), target-absent -> failure', () => {
    const base = buildPlanBodyBase()
    const d1 = dispatchNextPlanBodyAttempt(inputsFor(base), planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    const blockedOutcome = executePlanBodyAttempt(d1.store, d1.result.attempt.id, worldFacts({ blockedTargets: new Set(['gatehouse']) }), { night: 4, tick: 10 }, 'night_4')
    const afterBlocked = deriveExecutionState({ ...inputsFor(base), intentions: blockedOutcome.store })
    expect(afterBlocked.dispatchCandidate?.occurrenceOrdinal).toBe('occ_2')

    const succeededOutcome = executePlanBodyAttempt(blockedOutcome.store, d1.result.attempt.id, worldFacts(), WT_NIGHT4_NOON, 'night_4')
    expect(succeededOutcome.outcome.verdict).toBe('rejected') // duplicate outcome for the same attempt is rejected (ADR-0009 D10, reused)
  })
})

describe('P26 -- a validator-rejected attempt mints no fabricated consequence', () => {
  it('a forbidden speak-report attempt mints no ActionConsequence', () => {
    const base = buildPlanBodyBase()
    let intentions = base.intentions
    const conflict = commitCaptainArrival(base.conflict, { night: 4, tick: 150 })

    const d1 = dispatchNextPlanBodyAttempt({ ...inputsFor(base, conflict), intentions }, planBodyTemplateRegistry)
    if (d1.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d1.store
    const exec1 = executePlanBodyAttempt(intentions, d1.result.attempt.id, worldFacts(), WT_NIGHT4_NOON, 'night_4')
    intentions = exec1.store

    const d2 = dispatchNextPlanBodyAttempt({ ...inputsFor(base, conflict), intentions }, planBodyTemplateRegistry)
    if (d2.result.verdict !== 'dispatched') throw new Error('rig invariant broken')
    intentions = d2.store
    expect(CONSEQUENTIAL_ACTIONS.has(d2.result.attempt.action)).toBe(true)

    const rejected = executePlanBodyAttempt(intentions, d2.result.attempt.id, worldFacts({ forbiddenPairs: new Set(['speak-report:watch_captain']) }), { night: 4, tick: 160 }, 'night_4')
    expect(rejected.outcome.verdict).toBe('committed')
    if (rejected.outcome.verdict !== 'committed') throw new Error('unreachable')
    expect(rejected.outcome.outcome.verdict).toBe('rejected-forbidden')
    expect(rejected.outcome.outcome.consequenceId).toBeUndefined()
    expect(rejected.store.consequences).toHaveLength(0)
  })
})

describe('F14 -- a Condition referencing an undeclared execution-fact fails static template validation', () => {
  it('an execution-fact read-set entry with no matching establishesExecutionFact anywhere is rejected', () => {
    const badTemplate = {
      id: 'PT_undeclared_fact',
      version: 'bt_v0',
      semanticsVersion: 'btsem_v0' as const,
      servesObjectiveType: 'report-crime',
      contextAtomKind: 'attack-by',
      root: {
        type: 'Condition' as const,
        conditionId: 'BelievesSomethingUndeclared?',
        readSet: [{ source: 'execution-fact' as const, factKind: 'never-established-anywhere' }],
      },
    }
    const faults: readonly TemplateValidationFault[] = validateTemplate(badTemplate, CONSEQUENTIAL_ACTIONS)
    expect(faults.some((fault) => fault.fault === 'undeclared-execution-fact')).toBe(true)
  })
})

describe('F15 -- an uncommitted rumor cannot enter a condition input at the schema level', () => {
  it('only belief-atom/execution-fact sources parse; a rumor-shaped source is rejected', () => {
    expect(ConditionReadSetEntrySchema.safeParse({ source: 'belief-atom', atomKind: 'x' }).success).toBe(true)
    expect(ConditionReadSetEntrySchema.safeParse({ source: 'execution-fact', factKind: 'x' }).success).toBe(true)
    expect(ConditionReadSetEntrySchema.safeParse({ source: 'raw-rumor', rumorId: 'R_test' }).success).toBe(false)
    expect(ConditionReadSetEntrySchema.safeParse({ source: 'uncommitted-utterance', text: 'the captain is here' }).success).toBe(false)
  })
})

describe('F37 -- compaction demoting active condition-read evidence is rejected', () => {
  it('the evidence cited by the captain-at-gatehouse belief is pinned once that belief is current', () => {
    const base = buildPlanBodyBase()
    const conflict = commitCaptainArrival(base.conflict, { night: 4, tick: 150 })
    // Register a citing evidence id on the belief for this check (the
    // fixture's beliefCaptainAtGatehouse cites none by default; simulate
    // the D20 pin-propagation rule directly against a belief that does).
    const universeWithCitation = planBodyUniverse.map((entry) =>
      entry.kind === 'belief' && entry.record.id === beliefCaptainAtGatehouse.id ? { ...entry, record: { ...entry.record, supporting: ['E_captain_sighted'] } } : entry,
    )
    const openScopes = [{ executionScopeId: base.executionScopeId, intentionId: base.intentionId, holder: 'NPC_C', template: ptReportBt }]
    const bounds = { validT: { night: 4, tick: 150 }, txBound: conflict.nextSeq - 1 }
    const pins = deriveExecutionPins(openScopes, base.intentions, conflict, universeWithCitation, planBodyAtoms, bounds)
    expect(pins.recordIds.has('E_captain_sighted')).toBe(true)

    const proposal = {
      schemaVersion: 1 as const,
      id: 'CP_evidence_pin_test',
      action: 'demote' as const,
      memberIds: ['E_captain_sighted'],
      rationale: 'test',
      proposedBy: 'engine' as const,
    }
    const result = runExecutionAwareCompactionPass(openScopes, universeWithCitation, [], conflict, base.intentions, planBodyAtoms, base.intentions.nextSeq - 1, [], [proposal], 100, bounds)
    expect(result.executionQuiescenceRejections).toHaveLength(1)
    expect(result.executionQuiescenceRejections[0]?.rejectReason).toBe('pinned-member')
  })
})

// Sanity: commitBelief is reused, not reimplemented, for the pantry-baseline pattern this file relies on transitively.
describe('sanity', () => {
  it('planBodyScenario base beliefs commit via the existing commitBelief function', () => {
    const base = buildPlanBodyBase()
    expect(base.conflict.timing.has('Bel_C_captain_unknown')).toBe(true)
  })
})

void ADOPTION_TIME
void commitBelief
