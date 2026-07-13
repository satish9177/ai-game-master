import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { Observation } from './contracts'
import { CONFLICT_CANONICALIZER_VERSION, OVERTURN_BY_HARD_EVIDENCE_RULE_ID, TRANSITION_RULE_VERSION } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import { commitRevision } from './conflictStore'
import { clawEvidence } from './scenario'
import type { GoalOption, ObjectiveAtomRegistry, ObjectiveMetadata, PlanTemplate } from './intentionContracts'
import { INTENTION_RULE_VERSION, OBJECTIVE_METADATA_VERSION } from './intentionContracts'
import type { AdoptionCandidate, IntentionCommitContext, IntentionStore } from './intentionStore'
import { commitAdoption, initIntentionStore, transitionsOf } from './intentionStore'
import { reconsiderAcquiredBelief } from './intentionPipeline'
import type { IntentionPipelineContext } from './intentionPipeline'
import { CONSEQUENTIAL_ACTIONS, worldFacts } from './intentionActions'
import type { BTNode, PlanBodyTemplate } from './planBodyContracts'
import { BT_SEMANTICS_VERSION, validateTemplate } from './planBodyContracts'
import type { PlanBodyTemplateRegistry } from './planBodyPipeline'
import { dispatchNextPlanBodyAttempt, executePlanBodyAttempt, templateKey } from './planBodyPipeline'
import type { PlanBodyEvalInputs } from './planBodyProjection'
import { currentExecutionScopeIdOf, deriveExecutionState } from './planBodyProjection'
export { currentExecutionScopeIdOf, deriveExecutionState }
import { initWorldTimeStore } from './worldTimeStore'
import type { WorldTimeStore } from './worldTimeStore'
import {
  Bel_CoraAtt1,
  Bel_CoraAtt1b,
  Bel_CoraAtt1c,
  Bel_CoraAtt2,
  Bel_CoraAtt3,
  BORIN,
  buildPhase3Store,
  CORA,
  propW1,
  T_ACK,
  T_FORM,
  T_PRESENT,
  attributionUniverse,
  buildPhase2Store,
} from './attributionScenario'
import { ascribeFromAcknowledgment } from './attributionRules'
import { ASCRIPTION_RULE_VERSION } from './attributionContracts'
import { innerCanonicalKeyOf } from './attributionBuilder'
import { understandDefault } from './attributionUnderstanding'
import { commitAscriptionSupersession } from './attributionStore'
import type { AttributionStore } from './attributionStore'
import { beliefC1Prime } from './compactionScenario'
import { beliefB1 } from './conflictScenario'

/**
 * Phase 6: intention integration (research vault ADR-0011 D15, spec §8
 * Phase 6), driven through the ACTUAL ADR-0010 plan-body pipeline --
 * `FindBorin -> PresentEvidence -> AwaitAcknowledgment? -> plan-root success
 * -> complete(believed-achieved)` -- rather than a direct adoption-to-
 * completion shortcut. Every leaf dispatches and executes through the
 * unmodified `dispatchNextPlanBodyAttempt`/`executePlanBodyAttempt`;
 * completion is driven through the unmodified ADR-0009 belief-recognized
 * `reconsiderAcquiredBelief` (never a hand-authored transition), gated on
 * Cora's own acquired attribution supersession, never on Borin's hidden
 * actual belief or on any plan-triggered shortcut (D17: root-success alone
 * never completes an intention -- completion is belief-recognized).
 */

export const OM_CORRECT_BELIEF_ID = 'OM_correct_belief'

export const omCorrectBelief: ObjectiveMetadata = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: OM_CORRECT_BELIEF_ID,
  version: OBJECTIVE_METADATA_VERSION,
  objectiveType: 'correct-belief',
  minConfidence: 'low',
  allowUnresolved: false,
  priorityBasis: 'correction',
  priorityRank: 1,
  retryLimit: 2,
  reconsiderationPolicy: 'default',
}

// ---- The real, restricted-BT plan-body template (ADR-0010 D4) -------------
//
// SequenceWithMemory[FindBorin, PresentEvidence, AwaitAcknowledgment?] --
// exactly the chain named in the approved continuation. `AwaitAcknowledgment?`
// is a bare terminal Condition (never wrapped in a ReactiveFallback/Wait,
// since this proof has no authored timeout for the correction goal): a
// Condition never returns "running" (planBodyProjection.ts's evaluateNode),
// so an interim query while Borin has not yet acknowledged reads
// `planLocalResult: 'root-failure'` for THAT commit bound only -- this
// fixture never acts on that interim reading (no rebind/fail is ever
// committed from it); `deriveExecutionState` is a pure fold with no
// persisted cursor, so the VERY NEXT query, issued after Borin's
// acknowledgment commits, freshly re-evaluates to `root-success` (D2/D23).
export const PT_CORRECT_BORIN_BT_ID = 'PT_correct_borin_bt'
export const PT_CORRECT_BORIN_BT_VERSION = 'bt_v0'

const findBorinAction: BTNode = { type: 'Action', actionId: 'FindBorin', action: 'find', target: BORIN, retryBudget: 0, establishesExecutionFact: 'found-borin' }
const presentEvidenceAction: BTNode = { type: 'Action', actionId: 'PresentEvidence', action: 'present-evidence', target: BORIN, retryBudget: 0 }
const awaitAcknowledgmentCondition: BTNode = { type: 'Condition', conditionId: 'AwaitAcknowledgment?', readSet: [{ source: 'belief-atom', atomKind: 'correct-belief-achieved' }] }

export const ptCorrectBorinBt: PlanBodyTemplate = {
  id: PT_CORRECT_BORIN_BT_ID,
  version: PT_CORRECT_BORIN_BT_VERSION,
  semanticsVersion: BT_SEMANTICS_VERSION,
  servesObjectiveType: 'correct-belief',
  contextAtomKind: 'correct-belief-eligible',
  root: { type: 'SequenceWithMemory', children: [findBorinAction, presentEvidenceAction, awaitAcknowledgmentCondition] },
}

const templateFaults = validateTemplate(ptCorrectBorinBt, CONSEQUENTIAL_ACTIONS)
if (templateFaults.length > 0) {
  throw new Error(`attributionIntentionScenario: PT_correct_borin_bt failed static validation -- ${JSON.stringify(templateFaults)}`)
}

export const planTemplateCorrectBorin: PlanTemplate = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: PT_CORRECT_BORIN_BT_ID,
  version: PT_CORRECT_BORIN_BT_VERSION,
  servesObjectiveType: 'correct-belief',
  contextAtomKind: 'correct-belief-eligible',
  steps: [],
}

export const planBodyTemplateRegistryForAttribution: PlanBodyTemplateRegistry = new Map([[templateKey(ptCorrectBorinBt.id, ptCorrectBorinBt.version), ptCorrectBorinBt]])

export const CORRECT_BORIN_PLAN_BINDING = { templateId: ptCorrectBorinBt.id, templateVersion: ptCorrectBorinBt.version, params: {} }

/**
 * Every belief in Cora's attribution chain about Borin entails
 * `correct-belief-eligible` (D9-style applicability, whichever is current at
 * adoption time). The two beliefs representing "Borin has been corrected"
 * ADDITIONALLY entail `correct-belief-achieved` (the plan Condition's own
 * read-set atom, D10.1/D11) and `objective-achieved`/`objectiveType:
 * 'correct-belief'` (ADR-0009 D12's belief-recognized completion atom,
 * `intentionRules.ts`'s `terminalByBelief`) -- two DIFFERENT consumers of
 * the SAME underlying belief-acquisition event, never one mechanism
 * standing in for the other.
 */
export const CORRECT_BELIEF_ELIGIBLE_ATOMS = [{ kind: 'correct-belief-eligible', roles: {} }]
export const CORRECT_BELIEF_ACHIEVED_ATOMS = [
  { kind: 'correct-belief-eligible', roles: {} },
  { kind: 'correct-belief-achieved', roles: {} },
  { kind: 'objective-achieved', roles: { objectiveType: 'correct-belief' } },
]

export function buildObjectiveAtoms(achievedBeliefId?: string): ObjectiveAtomRegistry {
  return new Map([
    [Bel_CoraAtt1.id, CORRECT_BELIEF_ELIGIBLE_ATOMS],
    [Bel_CoraAtt1b.id, CORRECT_BELIEF_ELIGIBLE_ATOMS],
    [Bel_CoraAtt2.id, CORRECT_BELIEF_ELIGIBLE_ATOMS],
    [Bel_CoraAtt3.id, CORRECT_BELIEF_ELIGIBLE_ATOMS],
    [Bel_CoraAtt1c.id, CORRECT_BELIEF_ELIGIBLE_ATOMS],
    ...(achievedBeliefId !== undefined ? ([[achievedBeliefId, CORRECT_BELIEF_ACHIEVED_ATOMS]] as const) : []),
  ])
}

function goalOptionFor(attributionBeliefId: string): GoalOption {
  return {
    holder: CORA,
    candidateObjective: { objectiveType: 'correct-belief', roles: { modeled_holder: BORIN }, canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION },
    derivedFromBeliefs: [attributionBeliefId, beliefC1Prime.id],
    sourceObjectiveMetadataId: OM_CORRECT_BELIEF_ID,
    sourceObjectiveMetadataVersion: OBJECTIVE_METADATA_VERSION,
    ruleId: 'derive_correct_belief_option',
    ruleVersion: INTENTION_RULE_VERSION,
    priorityBasis: 'correction',
    priorityRank: 1,
  }
}

function commitContextFor(conflict: ConflictStore, atoms: ObjectiveAtomRegistry, universe: readonly import('./evidenceRecords').ReadableRecord[] = attributionUniverse): IntentionCommitContext {
  return { conflict, universe, atoms, metadataById: new Map([[OM_CORRECT_BELIEF_ID, omCorrectBelief]]), templates: [planTemplateCorrectBorin] }
}

function pipelineContextFor(conflict: ConflictStore, atoms: ObjectiveAtomRegistry, universe: readonly import('./evidenceRecords').ReadableRecord[] = attributionUniverse): IntentionPipelineContext {
  return { ...commitContextFor(conflict, atoms, universe), metadataByHolder: new Map([[CORA, [omCorrectBelief]]]) }
}

export interface PlanBodyRunResult {
  intentions: IntentionStore
  conflict: ConflictStore
  worldTime: WorldTimeStore
  atoms: ObjectiveAtomRegistry
  universe: readonly import('./evidenceRecords').ReadableRecord[]
  intentionId: string
  executionScopeId: string
  findBorinAttemptId: string
  presentEvidenceAttemptId: string
  achievedBeliefId: string
  /** The derived execution state snapshot captured at the exact moment root-success was reached -- BEFORE `reconsiderAcquiredBelief` closes the scope (after which `deriveExecutionState` can only report its closed-scope stub, never the historical root-success). */
  rootStateAtSuccess: ReturnType<typeof deriveExecutionState>
}

/** Real inputs bag for `deriveExecutionState`/`dispatchNextPlanBodyAttempt`, reusable by tests wanting to re-derive/inspect execution state post-hoc. */
export function planBodyInputsFor(result: PlanBodyRunResult): PlanBodyEvalInputs {
  return {
    template: ptCorrectBorinBt,
    executionScopeId: result.executionScopeId,
    intentionId: result.intentionId,
    holder: CORA,
    intentions: result.intentions,
    conflict: result.conflict,
    universe: result.universe,
    atoms: result.atoms,
    worldTime: result.worldTime,
  }
}

export interface PreAcknowledgmentState {
  intentions: IntentionStore
  conflict: ConflictStore
  worldTime: WorldTimeStore
  universe: readonly import('./evidenceRecords').ReadableRecord[]
  atoms: ObjectiveAtomRegistry
  intentionId: string
  executionScopeId: string
  findBorinAttemptId: string
  presentEvidenceAttemptId: string
}

/**
 * Dispatches and executes FindBorin, then PresentEvidence, through the REAL
 * pipeline (`dispatchNextPlanBodyAttempt`/`executePlanBodyAttempt`) --
 * exported standalone so tests can inspect the OPEN, pre-acknowledgment
 * execution state directly (pins, read-set locality, attempt shapes)
 * before the scope closes.
 */
export function runFindBorinAndPresentEvidence(
  intentions: IntentionStore,
  conflict: ConflictStore,
  atoms: ObjectiveAtomRegistry,
  intentionId: string,
  executionScopeId: string,
  dispatchTime: import('./conflictContracts').WorldInstant,
): PreAcknowledgmentState {
  const worldTime = initWorldTimeStore()
  const universe: readonly import('./evidenceRecords').ReadableRecord[] = attributionUniverse

  const inputsNow = (currentIntentions: IntentionStore): PlanBodyEvalInputs => ({
    template: ptCorrectBorinBt,
    executionScopeId,
    intentionId,
    holder: CORA,
    intentions: currentIntentions,
    conflict,
    universe,
    atoms,
    worldTime,
  })

  // Leaf 1: FindBorin.
  const dispatch1 = dispatchNextPlanBodyAttempt(inputsNow(intentions), planBodyTemplateRegistryForAttribution)
  if (dispatch1.result.verdict !== 'dispatched') {
    throw new Error(`attributionIntentionScenario: expected FindBorin to dispatch -- ${JSON.stringify(dispatch1.result)}`)
  }
  let nextIntentions = dispatch1.store
  const findBorinAttemptId = dispatch1.result.attempt.id
  const exec1 = executePlanBodyAttempt(nextIntentions, findBorinAttemptId, worldFacts(), dispatchTime, 'night_5')
  if (exec1.outcome.verdict !== 'committed' || exec1.outcome.outcome.verdict !== 'succeeded') {
    throw new Error('attributionIntentionScenario: expected FindBorin to succeed -- fixture invariant broken')
  }
  nextIntentions = exec1.store

  // Leaf 2: PresentEvidence -- the typed communication action.
  const dispatch2 = dispatchNextPlanBodyAttempt(inputsNow(nextIntentions), planBodyTemplateRegistryForAttribution)
  if (dispatch2.result.verdict !== 'dispatched') {
    throw new Error(`attributionIntentionScenario: expected PresentEvidence to dispatch -- ${JSON.stringify(dispatch2.result)}`)
  }
  nextIntentions = dispatch2.store
  const presentEvidenceAttemptId = dispatch2.result.attempt.id
  const exec2 = executePlanBodyAttempt(nextIntentions, presentEvidenceAttemptId, worldFacts(), dispatchTime, 'night_5')
  if (exec2.outcome.verdict !== 'committed' || exec2.outcome.outcome.verdict !== 'succeeded') {
    throw new Error('attributionIntentionScenario: expected PresentEvidence to succeed -- fixture invariant broken')
  }
  nextIntentions = exec2.store

  return { intentions: nextIntentions, conflict, worldTime, universe, atoms, intentionId, executionScopeId, findBorinAttemptId, presentEvidenceAttemptId }
}

/**
 * Drives one full plan-body run to root-success and belief-recognized
 * completion, through the REAL pipeline: `runFindBorinAndPresentEvidence`,
 * then the caller-supplied `acknowledge` callback commits Borin's real
 * acknowledgment on the conflict store; re-derive execution state (now
 * root-success); complete via the unmodified `reconsiderAcquiredBelief`.
 */
function runToCompletion(params: {
  intentions: IntentionStore
  conflict: ConflictStore
  atoms: ObjectiveAtomRegistry
  intentionId: string
  executionScopeId: string
  dispatchTime: import('./conflictContracts').WorldInstant
  acknowledge: (conflict: ConflictStore) => { conflict: ConflictStore; achievedBeliefId: string; achievedBelief: import('./contracts').Belief }
}): PlanBodyRunResult {
  const preAck = runFindBorinAndPresentEvidence(params.intentions, params.conflict, params.atoms, params.intentionId, params.executionScopeId, params.dispatchTime)
  const worldTime = preAck.worldTime
  let intentions = preAck.intentions
  let conflict = preAck.conflict
  let universe = preAck.universe
  const findBorinAttemptId = preAck.findBorinAttemptId
  const presentEvidenceAttemptId = preAck.presentEvidenceAttemptId

  const inputsNow = (): PlanBodyEvalInputs => ({
    template: ptCorrectBorinBt,
    executionScopeId: params.executionScopeId,
    intentionId: params.intentionId,
    holder: CORA,
    intentions,
    conflict,
    universe,
    atoms: params.atoms,
    worldTime,
  })

  // Leaf 3 (Condition): still false -- Borin has not acknowledged yet. A
  // fresh, current query legitimately reads root-failure at THIS bound;
  // nothing here acts on it.
  const interim = deriveExecutionState(inputsNow())
  if (interim.planLocalResult !== 'root-failure') {
    throw new Error('attributionIntentionScenario: expected the pre-acknowledgment interim state to read root-failure -- fixture invariant broken')
  }

  // Borin's real acknowledgment (a holder-owned, world-recorded event on
  // the CONFLICT store -- never a plan-body leaf of Cora's own plan).
  const acknowledged = params.acknowledge(conflict)
  conflict = acknowledged.conflict
  universe = [...universe, { kind: 'belief' as const, record: acknowledged.achievedBelief }]

  // Re-derive: the Condition now reads true (Cora's CURRENT belief carries
  // `correct-belief-achieved`) -- root-success, with nothing left to dispatch.
  const rootState = deriveExecutionState(inputsNow())
  if (rootState.planLocalResult !== 'root-success') {
    throw new Error(`attributionIntentionScenario: expected root-success after acknowledgment -- got ${rootState.planLocalResult}`)
  }
  if (rootState.dispatchCandidate !== undefined) {
    throw new Error('attributionIntentionScenario: expected nothing left to dispatch at root-success')
  }

  // Completion is belief-recognized (D17/ADR-0009 D12) -- driven by the
  // SAME unmodified reconsideration rule every prior proof uses, never a
  // plan-triggered or hand-authored shortcut.
  const reconsidered = reconsiderAcquiredBelief(intentions, pipelineContextFor(conflict, params.atoms, universe), CORA, acknowledged.achievedBeliefId, params.dispatchTime)
  if (!reconsidered.committedTransitions.some((t) => t.kind === 'complete')) {
    throw new Error('attributionIntentionScenario: expected reconsiderAcquiredBelief to complete the intention -- fixture invariant broken')
  }
  intentions = reconsidered.store

  return {
    intentions,
    conflict,
    worldTime,
    atoms: params.atoms,
    universe,
    intentionId: params.intentionId,
    executionScopeId: params.executionScopeId,
    findBorinAttemptId,
    presentEvidenceAttemptId,
    achievedBeliefId: acknowledged.achievedBeliefId,
    rootStateAtSuccess: rootState,
  }
}

export type Run1Result = PlanBodyRunResult

export interface AdoptedCorrectBorinIntention {
  intentions: IntentionStore
  intentionId: string
  executionScopeId: string
}

/** Adopts IC_AB1, bound to the REAL `PT_correct_borin_bt`, from `supportBeliefId` + Cora's own world belief -- exported standalone so tests can inspect the OPEN, pre-dispatch adoption state directly. */
export function adoptCorrectBorinIntention(conflict: ConflictStore, atoms: ObjectiveAtomRegistry, supportBeliefId: string, effectiveValidTime: import('./conflictContracts').WorldInstant): AdoptedCorrectBorinIntention {
  const candidate: AdoptionCandidate = {
    holder: CORA,
    option: goalOptionFor(supportBeliefId),
    planBinding: CORRECT_BORIN_PLAN_BINDING,
    reconsiderationPolicy: 'default',
    effectiveValidTime,
  }
  const adopted = commitAdoption(initIntentionStore(), candidate, commitContextFor(conflict, atoms))
  if (adopted.outcome.verdict !== 'committed') {
    throw new Error(`attributionIntentionScenario: expected adoption to commit -- ${adopted.outcome.fault}`)
  }
  return { intentions: adopted.store, intentionId: adopted.outcome.commitment.intentionId, executionScopeId: adopted.outcome.transition.transitionId }
}

/** Run 1: adopt bound to the REAL PT_correct_borin_bt, dispatch/execute FindBorin+PresentEvidence, Borin acknowledges (content-satisfying), plan reaches root-success, intention completes on Cora's own acquired belief. */
export function buildIntentionRun1(): Run1Result {
  const phase3 = buildPhase3Store()
  const atoms = buildObjectiveAtoms('Bel_CoraAtt2_realplan')

  const { intentions, intentionId, executionScopeId } = adoptCorrectBorinIntention(phase3.store.conflict, atoms, Bel_CoraAtt1b.id, T_PRESENT)

  return runToCompletion({
    intentions,
    conflict: phase3.store.conflict,
    atoms,
    intentionId,
    executionScopeId,
    dispatchTime: T_ACK,
    acknowledge: (conflict) => {
      const observation = { schemaVersion: 1 as const, id: 'O_Cora_ack1_realplan', observer: CORA, truthRef: 'TE_B_ack1', channels: ['sight', 'sound'] as ('sight' | 'sound')[], perceived: { speaker: BORIN, addressee: CORA, act: 'acknowledge', propositionKey: innerCanonicalKeyOf(propW1), incompatible: 'true' }, missing: [], fidelity: 'full' as const, time: 'night_5b' }
      const understanding = understandDefault(CORA, observation)
      const supersede = ascribeFromAcknowledgment({ toBeliefId: 'Bel_CoraAtt2_realplan', fromBelief: Bel_CoraAtt1b, modeledHolder: BORIN, proposition: propW1, understanding, contentSatisfying: true, time: 'night_5b', validity: { kind: 'interval', from: T_ACK, to: null } })
      if (supersede.verdict !== 'supersede') throw new Error('attributionIntentionScenario: expected Run 1 acknowledgment to supersede')
      const claims = new Map(conflict.claims)
      claims.set('Bel_CoraAtt2_realplan', supersede.toClaim!)
      const universeWithAck = [...attributionUniverse, { kind: 'observation' as const, record: observation }, { kind: 'belief' as const, record: supersede.toBelief }]
      const store: AttributionStore = { conflict: { ...conflict, claims }, sidecars: new Map() }
      const committed = commitAscriptionSupersession(store, universeWithAck, {
        transitionId: 'BT_CoraAtt_ack1_realplan',
        holder: CORA,
        fromBeliefId: Bel_CoraAtt1b.id,
        toBeliefId: 'Bel_CoraAtt2_realplan',
        effectiveValidTime: T_ACK,
        validFrom: T_ACK,
        cause: 'ascribed-from-acknowledgment',
        ruleId: 'ascribe_from_acknowledgment',
        ruleVersion: ASCRIPTION_RULE_VERSION,
        understandingRuleId: understanding.understandingRuleId,
        understandingRuleVersion: understanding.understandingRuleVersion,
        inputRecordIds: understanding.inputRecordIds,
      })
      if (committed.outcome.verdict !== 'committed') throw new Error('attributionIntentionScenario: expected BT_CoraAtt_ack1_realplan to commit')
      return { conflict: committed.store.conflict, achievedBeliefId: 'Bel_CoraAtt2_realplan', achievedBelief: supersede.toBelief }
    },
  })
}

export interface Run2Result extends PlanBodyRunResult {
  independentCorrectionTransitionId: string
}

/**
 * Run 2 -- redundant correction (its own store, forking from Phase 2, spec
 * §8 Phase 6): NPC_A independently corrects Borin's world belief FIRST
 * (`BT_AB1_indep`) -- Cora's stale `Bel_CoraAtt1` is untouched by this (no
 * synchronization mechanism exists, P23/P53). Cora STILL dispatches
 * FindBorin/PresentEvidence through the real plan-body pipeline despite
 * this prior independent correction (P50); completion is gated only on
 * HER OWN subsequent acknowledgment evidence, never on `BT_AB1_indep`
 * directly (P51-P53).
 */
export function buildIntentionRun2(): Run2Result {
  const base = buildPhase2Store()

  const independentCorrection = commitRevision(
    base.conflict,
    {
      toBeliefId: 'Bel_B1_prime_indep',
      validFrom: T_FORM,
      transition: {
        transitionId: 'BT_AB1_indep',
        holder: BORIN,
        fromBeliefId: beliefB1.id,
        toBeliefId: 'Bel_B1_prime_indep',
        effectiveValidTime: T_FORM,
        cause: 'corrected-by-evidence',
        ruleId: OVERTURN_BY_HARD_EVIDENCE_RULE_ID,
        ruleVersion: TRANSITION_RULE_VERSION,
        canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
        inputEvidenceIds: [clawEvidence.id],
        conflictEdgeIds: [],
      },
    },
    [...attributionUniverse, { kind: 'belief', record: { ...beliefC1Prime, id: 'Bel_B1_prime_indep', holder: BORIN, proposition: 'zombie_17 attacked guard_malik', sourceRef: clawEvidence.id, supporting: [clawEvidence.id] } }],
  )
  if (independentCorrection.outcome.verdict !== 'committed') {
    throw new Error('attributionIntentionScenario: expected BT_AB1_indep to commit -- fixture invariant broken')
  }
  const conflictAfterIndependentCorrection = independentCorrection.store
  const atoms = buildObjectiveAtoms('Bel_CoraAtt_run2_realplan')

  const { intentions, intentionId, executionScopeId } = adoptCorrectBorinIntention(conflictAfterIndependentCorrection, atoms, Bel_CoraAtt1.id, T_FORM)

  const result = runToCompletion({
    intentions,
    conflict: conflictAfterIndependentCorrection,
    atoms,
    intentionId,
    executionScopeId,
    dispatchTime: T_FORM,
    acknowledge: (conflict) => {
      // Borin, already independently corrected by NPC_A, straightforwardly
      // acknowledges Cora's (redundant) presentation too -- P50/P51.
      const observation: Observation = { schemaVersion: 1, id: 'O_Cora_ack2_realplan', observer: CORA, truthRef: 'TE_B_ack2', channels: ['sight', 'sound'], perceived: { speaker: BORIN, addressee: CORA, act: 'acknowledge', propositionKey: innerCanonicalKeyOf(propW1), incompatible: 'true' }, missing: [], fidelity: 'full', time: 'night_4b' }
      const understanding = understandDefault(CORA, observation)
      const supersede = ascribeFromAcknowledgment({ toBeliefId: 'Bel_CoraAtt_run2_realplan', fromBelief: Bel_CoraAtt1, modeledHolder: BORIN, proposition: propW1, understanding, contentSatisfying: true, time: 'night_4b', validity: { kind: 'interval', from: T_FORM, to: null } })
      if (supersede.verdict !== 'supersede') throw new Error('attributionIntentionScenario: expected Run 2 acknowledgment to supersede')
      const claims = new Map(conflict.claims)
      claims.set('Bel_CoraAtt_run2_realplan', supersede.toClaim!)
      const universeWithAck = [...attributionUniverse, { kind: 'observation' as const, record: observation }, { kind: 'belief' as const, record: supersede.toBelief }]
      const store: AttributionStore = { conflict: { ...conflict, claims }, sidecars: new Map() }
      const committed = commitAscriptionSupersession(store, universeWithAck, {
        transitionId: 'BT_CoraAtt_run2_realplan',
        holder: CORA,
        fromBeliefId: Bel_CoraAtt1.id,
        toBeliefId: 'Bel_CoraAtt_run2_realplan',
        effectiveValidTime: T_FORM,
        validFrom: T_FORM,
        cause: 'ascribed-from-acknowledgment',
        ruleId: 'ascribe_from_acknowledgment',
        ruleVersion: ASCRIPTION_RULE_VERSION,
        understandingRuleId: understanding.understandingRuleId,
        understandingRuleVersion: understanding.understandingRuleVersion,
        inputRecordIds: understanding.inputRecordIds,
      })
      if (committed.outcome.verdict !== 'committed') throw new Error('attributionIntentionScenario: expected BT_CoraAtt_run2_realplan to commit')
      return { conflict: committed.store.conflict, achievedBeliefId: 'Bel_CoraAtt_run2_realplan', achievedBelief: supersede.toBelief }
    },
  })

  return { ...result, independentCorrectionTransitionId: 'BT_AB1_indep' }
}

export { transitionsOf }
