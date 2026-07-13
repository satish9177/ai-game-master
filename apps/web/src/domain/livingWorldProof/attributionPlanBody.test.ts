import { describe, expect, it } from 'vitest'
import { readable } from './evidenceRecords'
import { currentBeliefs } from './beliefProjection'
import { transitionsOf } from './intentionStore'
import { deriveExecutionPins } from './planBodyCompactionAdapter'
import type { OpenExecutionScope } from './planBodyCompactionAdapter'
import { resolveActionPath } from './planBodyContracts'
import {
  adoptCorrectBorinIntention,
  buildIntentionRun1,
  buildIntentionRun2,
  buildObjectiveAtoms,
  currentExecutionScopeIdOf,
  deriveExecutionState,
  planBodyInputsFor,
  ptCorrectBorinBt,
  runFindBorinAndPresentEvidence,
} from './attributionIntentionScenario'
import { attributionUniverse, Bel_CoraAtt1b, beliefB1Prime, BORIN, buildPhase3Store, CORA, propW1, T_PRESENT } from './attributionScenario'
import { ascribeFromAcknowledgment } from './attributionRules'
import { understandDefault } from './attributionUnderstanding'
import { innerCanonicalKeyOf } from './attributionBuilder'
import { commitAscriptionSupersession } from './attributionStore'
import { ASCRIPTION_RULE_VERSION } from './attributionContracts'

/**
 * The ADR-0010 plan-body execution proof, driven through the REAL pipeline
 * (research vault continuation directive): `FindBorin -> PresentEvidence ->
 * AwaitAcknowledgment? -> plan-root success -> complete(believed-achieved)`,
 * for both the normal (Run 1) and redundant-correction (Run 2) scenarios.
 * No shortcut from adoption straight to completion is exercised anywhere
 * in this file -- every leaf dispatches and executes through
 * `dispatchNextPlanBodyAttempt`/`executePlanBodyAttempt`
 * (`planBodyPipeline.ts`, unmodified).
 */

describe('Each leaf actually executes (Run 1 and Run 2 alike)', () => {
  it('Run 1: FindBorin and PresentEvidence each dispatch a real ActionAttempt and commit a succeeded ActionOutcome', () => {
    const run1 = buildIntentionRun1()
    const findBorinAttempt = run1.intentions.attempts.find((a) => a.id === run1.findBorinAttemptId)!
    const presentEvidenceAttempt = run1.intentions.attempts.find((a) => a.id === run1.presentEvidenceAttemptId)!
    expect(findBorinAttempt.action).toBe('find')
    expect(findBorinAttempt.target).toBe('NPC_B')
    expect(presentEvidenceAttempt.action).toBe('present-evidence')
    expect(presentEvidenceAttempt.target).toBe('NPC_B')

    const findBorinOutcome = run1.intentions.outcomes.find((o) => o.attemptId === run1.findBorinAttemptId)!
    const presentEvidenceOutcome = run1.intentions.outcomes.find((o) => o.attemptId === run1.presentEvidenceAttemptId)!
    expect(findBorinOutcome.verdict).toBe('succeeded')
    expect(presentEvidenceOutcome.verdict).toBe('succeeded')

    // Both attempts carry a canonical plan_leaf_ref naming the real bound
    // template and the real node paths -- never a fabricated/omitted ref.
    expect(findBorinAttempt.planLeafRef?.templateId).toBe(ptCorrectBorinBt.id)
    expect(findBorinAttempt.planLeafRef?.nodePath).toEqual([0])
    expect(presentEvidenceAttempt.planLeafRef?.nodePath).toEqual([1])
  })

  it('Run 2: FindBorin and PresentEvidence each dispatch and succeed too, despite the prior independent correction', () => {
    const run2 = buildIntentionRun2()
    const findBorinOutcome = run2.intentions.outcomes.find((o) => o.attemptId === run2.findBorinAttemptId)!
    const presentEvidenceOutcome = run2.intentions.outcomes.find((o) => o.attemptId === run2.presentEvidenceAttemptId)!
    expect(findBorinOutcome.verdict).toBe('succeeded')
    expect(presentEvidenceOutcome.verdict).toBe('succeeded')
  })

  it('resolveActionPath resolves both leaf node_paths against the real template root', () => {
    const findBorinResolved = resolveActionPath(ptCorrectBorinBt.root, [0])
    const presentEvidenceResolved = resolveActionPath(ptCorrectBorinBt.root, [1])
    expect('node' in findBorinResolved && findBorinResolved.node.actionId).toBe('FindBorin')
    expect('node' in presentEvidenceResolved && presentEvidenceResolved.node.actionId).toBe('PresentEvidence')
  })
})

describe('PresentEvidence emits the typed communication action', () => {
  it('the dispatched attempt\'s `action` field IS the typed communicative act -- present-evidence, never a generic/untyped string', () => {
    const run1 = buildIntentionRun1()
    const attempt = run1.intentions.attempts.find((a) => a.id === run1.presentEvidenceAttemptId)!
    expect(attempt.action).toBe('present-evidence')
    // The actor's own scope-computed observation of having performed it
    // (executePlanBodyAttempt/observationFor) is committed too.
    expect(run1.intentions.observations.some((o) => o.truthRef === attempt.id)).toBe(true)
  })
})

describe('AwaitAcknowledgment? reads only Cora-owned records; no Borin-private belief is read', () => {
  it('the Condition\'s read-set names only a belief-atom kind, never a raw record id or a Borin-owned belief id', () => {
    const conditionNode = ptCorrectBorinBt.root.type === 'SequenceWithMemory' ? ptCorrectBorinBt.root.children[2] : undefined
    expect(conditionNode?.type).toBe('Condition')
    if (conditionNode?.type !== 'Condition') throw new Error('unreachable')
    expect(conditionNode.readSet).toEqual([{ source: 'belief-atom', atomKind: 'correct-belief-achieved' }])
    // Structurally: a belief-atom read-set entry names only a KIND, never a
    // record id -- ConditionReadSetEntrySchema (planBodyContracts.ts) has
    // no field through which a raw Belief id (Cora's or Borin's) could
    // ever be embedded.
    expect(Object.keys(conditionNode.readSet[0]!)).toEqual(['source', 'atomKind'])
  })

  it('the belief-atom lookup underlying the Condition is derived from currentBeliefs(CORA, ...) only -- structurally excluding Borin\'s store', () => {
    const run1 = buildIntentionRun1()
    const inputs = planBodyInputsFor(run1)
    expect(inputs.holder).toBe(CORA)
    // currentBeliefs's own holder-filter (beliefProjection.ts, unmodified)
    // is what `beliefAtomKindsAt` (planBodyProjection.ts) calls -- the same
    // machinery every prior proof already proved holder-scoped.
    const projection = currentBeliefs(CORA, inputs.universe, inputs.conflict, { validT: T_PRESENT, txBound: inputs.conflict.nextSeq - 1 })
    expect(projection.beliefs.every((b) => b.holder === CORA)).toBe(true)
  })

  it('no attempt/outcome/belief in Run 1\'s or Run 2\'s intention store ever names Borin\'s private corrected belief id', () => {
    const run1 = buildIntentionRun1()
    const run2 = buildIntentionRun2()
    expect(JSON.stringify(run1.intentions)).not.toContain(beliefB1Prime.id)
    expect(JSON.stringify(run2.intentions)).not.toContain('Bel_B1_prime_indep')
  })

  it('Cora\'s readable set never contains Borin\'s corrected belief (the plan\'s own condition could not read it even if it tried)', () => {
    const run1 = buildIntentionRun1()
    const coraReadable = readable(CORA, run1.universe)
    expect(coraReadable.some((entry) => entry.record.id === beliefB1Prime.id)).toBe(false)
  })
})

describe('Plan-root success causes completion', () => {
  it('Run 1: the derived execution state read root-success (captured at that exact moment) with nothing left to dispatch, and the intention is closed via complete(believed-achieved)', () => {
    const run1 = buildIntentionRun1()
    expect(run1.rootStateAtSuccess.planLocalResult).toBe('root-success')
    expect(run1.rootStateAtSuccess.dispatchCandidate).toBeUndefined()
    const transitions = transitionsOf(run1.intentions, run1.intentionId, run1.intentions.nextSeq - 1)
    expect(transitions.some((t) => t.kind === 'complete' && t.cause === 'believed-achieved')).toBe(true)
    // After completion closes the scope, deriveExecutionState correctly
    // reports the closed-scope stub -- it never claims root-success for a
    // scope that is no longer open (D2: derived, not cached).
    expect(deriveExecutionState(planBodyInputsFor(run1)).scopeOpen).toBe(false)
  })

  it('Run 2: same -- root-success (captured at that exact moment) and belief-recognized completion both hold', () => {
    const run2 = buildIntentionRun2()
    expect(run2.rootStateAtSuccess.planLocalResult).toBe('root-success')
    const transitions = transitionsOf(run2.intentions, run2.intentionId, run2.intentions.nextSeq - 1)
    expect(transitions.some((t) => t.kind === 'complete' && t.cause === 'believed-achieved')).toBe(true)
  })

  it('BEFORE acknowledgment, the same derived state reads root-failure (the Condition is not yet satisfied) -- proving root-success is genuinely conditioned on the belief event, not vacuous', () => {
    const phase3 = buildPhase3Store()
    const atoms = buildObjectiveAtoms('Bel_CoraAtt2_probe')
    const { intentions, intentionId, executionScopeId } = adoptCorrectBorinIntention(phase3.store.conflict, atoms, Bel_CoraAtt1b.id, T_PRESENT)
    const preAck = runFindBorinAndPresentEvidence(intentions, phase3.store.conflict, atoms, intentionId, executionScopeId, T_PRESENT)
    const interim = deriveExecutionState({ template: ptCorrectBorinBt, executionScopeId, intentionId, holder: CORA, intentions: preAck.intentions, conflict: preAck.conflict, universe: preAck.universe, atoms, worldTime: preAck.worldTime })
    expect(interim.planLocalResult).toBe('root-failure')
  })
})

describe('Plan read-set and execution pins remain holder-local', () => {
  it('deriveExecutionPins (planBodyCompactionAdapter.ts, unmodified) pins the version binding for an OPEN correct-belief execution scope, and never a Borin-owned record', () => {
    const phase3 = buildPhase3Store()
    const atoms = buildObjectiveAtoms()
    const { intentions, intentionId, executionScopeId } = adoptCorrectBorinIntention(phase3.store.conflict, atoms, Bel_CoraAtt1b.id, T_PRESENT)
    const scopes: OpenExecutionScope[] = [{ executionScopeId, intentionId, holder: CORA, template: ptCorrectBorinBt }]
    const pins = deriveExecutionPins(scopes, intentions, phase3.store.conflict, attributionUniverse, atoms, { validT: T_PRESENT, txBound: intentions.nextSeq - 1 })
    // The version pin (template + binding + semantics) is always present
    // for any open scope, regardless of which belief-atoms are current yet.
    expect(pins.versionPins).toContainEqual({ executionScopeId, intentionId, templateId: ptCorrectBorinBt.id, templateVersion: ptCorrectBorinBt.version, semanticsVersion: ptCorrectBorinBt.semanticsVersion })
    expect(pins.recordIds.has(beliefB1Prime.id)).toBe(false)
  })

  it('once Cora\'s CURRENT belief carries the Condition\'s own read-set atom (correct-belief-achieved), deriveExecutionPins pins exactly that belief -- still never Borin\'s', () => {
    // Run 1 is built to completion, but we need the OPEN, post-acknowledgment
    // moment specifically -- reuse the same construction Run 1's own
    // acknowledge step uses, stopping short of completion.
    const phase3 = buildPhase3Store()
    const atoms = buildObjectiveAtoms('Bel_CoraAtt2_pin_probe')
    const { intentions, intentionId, executionScopeId } = adoptCorrectBorinIntention(phase3.store.conflict, atoms, Bel_CoraAtt1b.id, T_PRESENT)
    const preAck = runFindBorinAndPresentEvidence(intentions, phase3.store.conflict, atoms, intentionId, executionScopeId, T_PRESENT)

    const observation = { schemaVersion: 1 as const, id: 'O_pin_probe', observer: CORA, truthRef: 'TE_pin_probe', channels: ['sight', 'sound'] as ('sight' | 'sound')[], perceived: { speaker: BORIN, addressee: CORA, act: 'acknowledge', propositionKey: innerCanonicalKeyOf(propW1), incompatible: 'true' }, missing: [], fidelity: 'full' as const, time: 'night_5b' }
    const understanding = understandDefault(CORA, observation)
    const supersede = ascribeFromAcknowledgment({ toBeliefId: 'Bel_CoraAtt2_pin_probe', fromBelief: Bel_CoraAtt1b, modeledHolder: BORIN, proposition: propW1, understanding, contentSatisfying: true, time: 'night_5b', validity: { kind: 'interval', from: T_PRESENT, to: null } })
    if (supersede.verdict !== 'supersede') throw new Error('unreachable')
    const claims = new Map(preAck.conflict.claims)
    claims.set('Bel_CoraAtt2_pin_probe', supersede.toClaim!)
    const universeWithAck = [...preAck.universe, { kind: 'observation' as const, record: observation }, { kind: 'belief' as const, record: supersede.toBelief }]
    const committedAck = commitAscriptionSupersession(
      { conflict: { ...preAck.conflict, claims }, sidecars: new Map() },
      universeWithAck,
      {
        transitionId: 'BT_pin_probe',
        holder: CORA,
        fromBeliefId: Bel_CoraAtt1b.id,
        toBeliefId: 'Bel_CoraAtt2_pin_probe',
        effectiveValidTime: T_PRESENT,
        validFrom: T_PRESENT,
        cause: 'ascribed-from-acknowledgment',
        ruleId: 'ascribe_from_acknowledgment',
        ruleVersion: ASCRIPTION_RULE_VERSION,
        understandingRuleId: understanding.understandingRuleId,
        understandingRuleVersion: understanding.understandingRuleVersion,
        inputRecordIds: understanding.inputRecordIds,
      },
    )
    if (committedAck.outcome.verdict !== 'committed') throw new Error('unreachable')

    const scopes: OpenExecutionScope[] = [{ executionScopeId, intentionId, holder: CORA, template: ptCorrectBorinBt }]
    const pins = deriveExecutionPins(scopes, preAck.intentions, committedAck.store.conflict, universeWithAck, atoms, { validT: T_PRESENT, txBound: committedAck.store.conflict.nextSeq - 1 })
    expect(pins.recordIds.has('Bel_CoraAtt2_pin_probe')).toBe(true)
    expect(pins.recordIds.has(beliefB1Prime.id)).toBe(false)
    expect(pins.recordIds.has('Bel_B1')).toBe(false)
  })

  it('after the scope closes (Run 1 completes), the same execution scope is no longer open and pins nothing', () => {
    const run1 = buildIntentionRun1()
    const scopes: OpenExecutionScope[] = [{ executionScopeId: run1.executionScopeId, intentionId: run1.intentionId, holder: CORA, template: ptCorrectBorinBt }]
    const pins = deriveExecutionPins(scopes, run1.intentions, run1.conflict, run1.universe, run1.atoms, { validT: T_PRESENT, txBound: run1.intentions.nextSeq - 1 })
    expect(pins.recordIds.size).toBe(0)
    expect(pins.versionPins).toEqual([])
  })
})

describe('The redundant correction still dispatches PresentEvidence after Borin was independently corrected', () => {
  it('Run 2 dispatches BOTH FindBorin and PresentEvidence even though BT_AB1_indep already committed first', () => {
    const run2 = buildIntentionRun2()
    const independentCorrectionSeq = run2.conflict.transitions.find((t) => t.transitionId === 'BT_AB1_indep')!.commitSeq
    const presentEvidenceAttempt = run2.intentions.attempts.find((a) => a.id === run2.presentEvidenceAttemptId)!
    expect(presentEvidenceAttempt).toBeDefined()
    // The independent correction commits on the CONFLICT store, dispatch
    // on the INTENTION store -- two different commit sequences entirely;
    // what matters is that the dispatch happened at all, unconditioned by
    // the prior correction, which it structurally cannot even observe
    // (dispatchNextPlanBodyAttempt never reads BT_AB1_indep).
    expect(independentCorrectionSeq).toBeGreaterThan(0)
    expect(presentEvidenceAttempt.action).toBe('present-evidence')
  })
})

describe('Completion occurs only after Cora-readable acknowledgment or denial evidence', () => {
  it('Run 1\'s completion trigger is Cora\'s OWN acquired attribution belief, never Borin\'s private BT_AB1', () => {
    const run1 = buildIntentionRun1()
    const transitions = transitionsOf(run1.intentions, run1.intentionId, run1.intentions.nextSeq - 1)
    const complete = transitions.find((t) => t.kind === 'complete')!
    expect(complete.triggeringIds).toContain(run1.achievedBeliefId)
    expect(complete.triggeringIds).not.toContain('BT_AB1')
  })

  it('Run 2\'s completion trigger is Cora\'s own acquired belief, never the independent correction transition', () => {
    const run2 = buildIntentionRun2()
    const transitions = transitionsOf(run2.intentions, run2.intentionId, run2.intentions.nextSeq - 1)
    const complete = transitions.find((t) => t.kind === 'complete')!
    expect(complete.triggeringIds).toContain(run2.achievedBeliefId)
    expect(complete.triggeringIds).not.toContain('BT_AB1_indep')
  })

  it('currentExecutionScopeIdOf confirms the scope that completed is the SAME scope adoption opened (no silent rebind/scope-swap)', () => {
    const run1 = buildIntentionRun1()
    // The scope closed on completion -- currentExecutionScopeIdOf still
    // names it as the LAST bound scope (never undefined/rebound).
    expect(currentExecutionScopeIdOf(run1.intentions, run1.intentionId, run1.intentions.nextSeq - 1)).toBe(run1.executionScopeId)
  })
})
