import { beliefC1Prime } from './compactionScenario'
import type { Belief, SceneEvent } from './contracts'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { WorldInstant } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION, TRANSITION_RULE_VERSION } from './conflictContracts'
import { buildConflictScenario, claimRegistry, nightTick } from './conflictScenario'
import type { ConflictStore, RevisionEnvelope } from './conflictStore'
import { commitBelief, commitRevision } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'
import { intentionUniverse, objectiveAtoms, objectiveMetadataById, omReportCrime } from './intentionScenario'
import type { ObjectiveAtomRegistry, PlanTemplate } from './intentionContracts'
import { OBJECTIVE_METADATA_VERSION } from './intentionContracts'
import type { IntentionCommitContext, IntentionStore } from './intentionStore'
import { commitAdoption, initIntentionStore } from './intentionStore'
import type { BTNode, PlanBodyTemplate } from './planBodyContracts'
import { BT_SEMANTICS_VERSION, validateTemplate } from './planBodyContracts'
import { CONSEQUENTIAL_ACTIONS } from './intentionActions'
import type { PlanBodyTemplateRegistry } from './planBodyPipeline'
import { templateKey } from './planBodyPipeline'
import { initWorldTimeStore } from './worldTimeStore'
import type { WorldTimeStore } from './worldTimeStore'

/**
 * Fixture for Plan-Body Execution Replay v0 (ADR-0010, spec plan-body-
 * execution-replay-v0.md §0), built additively on the already-committed
 * conflict scenario (conflictScenario.ts, unmodified) and the intention-
 * lifecycle fixture's objective metadata/atoms (intentionScenario.ts,
 * unmodified). No existing fixture file is edited; every rig-constructed
 * record below is flagged in spec §0.1, exactly as the prior rigs did.
 */

export const BT_TEMPLATE_VERSION = 'bt_v0' as const

// ---- World-time anchors (spec §0.1: dawn < noon < dusk < night5dawn) -------

export const WT_NIGHT4_DAWN: WorldInstant = { night: 4, tick: 0 }
export const WT_NIGHT4_NOON: WorldInstant = { night: 4, tick: 100 }
export const WT_NIGHT4_DUSK: WorldInstant = { night: 4, tick: 200 }
export const WT_NIGHT5_DAWN: WorldInstant = { night: 5, tick: 0 }

/** D_to_dusk: authored so `WT_night4_noon + D_to_dusk === WT_night4_dusk` exactly (spec §0.1). */
export const D_TO_DUSK = WT_NIGHT4_DUSK.tick - WT_NIGHT4_NOON.tick

// ---- Rig-constructed beliefs (spec §0.1, flagged, additive) ----------------

// The captain's whereabouts, initially unknown to C, later corrected by an
// observation -- the [1,0] Condition's belief-atom read-set subject.
export const beliefCaptainUnknown: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_C_captain_unknown',
  holder: 'NPC_C',
  proposition: "the watch captain's whereabouts are unknown",
  confidence: 'low',
  sourceType: 'inference',
  sourceRef: 'baseline',
  supporting: [],
  contradicting: [],
  lastUpdated: 'night_4',
}

export const beliefCaptainAtGatehouse: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_C_captain_here',
  holder: 'NPC_C',
  proposition: 'the watch captain is at the gatehouse',
  confidence: 'high',
  sourceType: 'observation',
  sourceRef: 'O_captain_sighted',
  supporting: [],
  contradicting: [],
  lastUpdated: 'night_4',
}

// P15's unrelated pantry-incident belief pair -- touches no condition read
// set anywhere in PT_report_bt/PT_report_watch_bt/PT_two_knocks.
export const beliefPantryBaseline: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_C_pantry_0',
  holder: 'NPC_C',
  proposition: 'the pantry is adequately stocked',
  confidence: 'medium',
  sourceType: 'inference',
  sourceRef: 'baseline',
  supporting: [],
  contradicting: [],
  lastUpdated: 'night_4',
}

export const beliefPantryRestocked: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_C_pantry_1',
  holder: 'NPC_C',
  proposition: 'the pantry was just restocked',
  confidence: 'medium',
  sourceType: 'observation',
  sourceRef: 'O_pantry_restock',
  supporting: [],
  contradicting: [],
  lastUpdated: 'night_4',
}

/** P52: the belief-recognized completion trigger (ADR-0009 D12) -- distinct from plan root success (D17). */
export const beliefCReportKnown: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_C_report_known',
  holder: 'NPC_C',
  proposition: 'the watch now knows about the cellar attack',
  confidence: 'high',
  sourceType: 'inference',
  sourceRef: 'watch-acknowledged-report',
  supporting: [],
  contradicting: [],
  lastUpdated: 'night_4',
}

/** F12/P18: authoritative world truth, deliberately NEVER given a holder-readable observation. */
export const truthCaptainElsewhere: SceneEvent = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'TE_captain_elsewhere',
  actor: 'guard_captain',
  action: 'stationed',
  target: 'barracks',
  location: { node: 'barracks' },
  time: 'night_4',
  emissions: [{ channel: 'sight', exposes: ['actor', 'location'] }],
}

export const planBodyUniverse: readonly ReadableRecord[] = [
  ...intentionUniverse,
  { kind: 'belief', record: beliefCaptainUnknown },
  { kind: 'belief', record: beliefCaptainAtGatehouse },
  { kind: 'belief', record: beliefPantryBaseline },
  { kind: 'belief', record: beliefPantryRestocked },
  { kind: 'belief', record: beliefCReportKnown },
  { kind: 'truth', record: truthCaptainElsewhere },
]

/** The fixture's atom registry: intentionScenario's registry, extended with the two new belief-atom kinds this template's Conditions read (D10.1/D11). */
export const planBodyAtoms: ObjectiveAtomRegistry = new Map([
  ...objectiveAtoms,
  [beliefCaptainAtGatehouse.id, [{ kind: 'captain-at-gatehouse', roles: {} }]],
  [beliefPantryRestocked.id, [{ kind: 'pantry-restocked', roles: {} }]],
  [beliefCReportKnown.id, [{ kind: 'objective-achieved', roles: { objectiveType: 'report-crime' } }]],
])

// ---- Authored plan-body templates (spec §0.1, ADR-0010 D4) -----------------

const gotoGatehouseAction: BTNode = {
  type: 'Action',
  actionId: 'GoToGatehouse',
  action: 'go-to-gatehouse',
  target: 'gatehouse',
  retryBudget: 1,
  establishesExecutionFact: 'self-at-gatehouse',
}

const speakReportAction: BTNode = {
  type: 'Action',
  actionId: 'SpeakReport',
  action: 'speak-report',
  target: 'watch_captain',
  retryBudget: 0,
}

export const ptReportBt: PlanBodyTemplate = {
  id: 'PT_report_bt',
  version: BT_TEMPLATE_VERSION,
  semanticsVersion: BT_SEMANTICS_VERSION,
  servesObjectiveType: 'report-crime',
  contextAtomKind: 'attack-by',
  root: {
    type: 'SequenceWithMemory',
    children: [
      {
        type: 'ReactiveFallback',
        children: [
          { type: 'Condition', conditionId: 'BelievesAtGatehouse?', readSet: [{ source: 'execution-fact', factKind: 'self-at-gatehouse' }] },
          gotoGatehouseAction,
        ],
      },
      {
        type: 'ReactiveFallback',
        children: [
          { type: 'Condition', conditionId: 'BelievesCaptainPresent?', readSet: [{ source: 'belief-atom', atomKind: 'captain-at-gatehouse' }] },
          { type: 'Wait', durationWorldTicks: D_TO_DUSK },
        ],
      },
      speakReportAction,
    ],
  },
}

export const ptTwoKnocks: PlanBodyTemplate = {
  id: 'PT_two_knocks',
  version: BT_TEMPLATE_VERSION,
  semanticsVersion: BT_SEMANTICS_VERSION,
  servesObjectiveType: 'report-crime',
  contextAtomKind: 'attack-by',
  root: {
    type: 'SequenceWithMemory',
    children: [
      { type: 'Action', actionId: 'Knock', action: 'knock', target: 'gatehouse_door', retryBudget: 0 },
      { type: 'Action', actionId: 'Knock', action: 'knock', target: 'gatehouse_door', retryBudget: 0 },
    ],
  },
}

export const ptReportWatchBt: PlanBodyTemplate = {
  id: 'PT_report_watch_bt',
  version: BT_TEMPLATE_VERSION,
  semanticsVersion: BT_SEMANTICS_VERSION,
  servesObjectiveType: 'report-crime',
  contextAtomKind: 'attack-by',
  root: {
    type: 'SequenceWithMemory',
    children: [
      { type: 'Action', actionId: 'ApproachWatchman', action: 'approach-watchman', target: 'town_watchman', retryBudget: 0 },
      { type: 'Action', actionId: 'SpeakReport', action: 'speak-report', target: 'town_watchman', retryBudget: 0 },
    ],
  },
}

export const planBodyTemplates: readonly PlanBodyTemplate[] = [ptReportBt, ptTwoKnocks, ptReportWatchBt]

export const planBodyTemplateRegistry: PlanBodyTemplateRegistry = new Map(
  planBodyTemplates.map((template) => [templateKey(template.id, template.version), template]),
)

// Template validation (D8/D18) must pass for every authored v0 template --
// asserted once here as a fixture invariant, and again explicitly in tests.
for (const template of planBodyTemplates) {
  const faults = validateTemplate(template, CONSEQUENTIAL_ACTIONS)
  if (faults.length > 0) {
    throw new Error(`planBodyScenario: template ${template.id}@${template.version} failed static validation -- ${JSON.stringify(faults)}`)
  }
}

// ---- Linear PlanTemplate shims (empty steps; ADR-0009's applicability/
// rebind-search machinery is reused unchanged, D9) ---------------------------

function shimFor(template: PlanBodyTemplate): PlanTemplate {
  return {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    id: template.id,
    version: template.version,
    servesObjectiveType: template.servesObjectiveType,
    contextAtomKind: template.contextAtomKind,
    steps: [],
  }
}

export const ptReportBtShim = shimFor(ptReportBt)
export const ptTwoKnocksShim = shimFor(ptTwoKnocks)
export const ptReportWatchBtShim = shimFor(ptReportWatchBt)

export const planBodyLinearShims: readonly PlanTemplate[] = [ptReportBtShim, ptTwoKnocksShim, ptReportWatchBtShim]

// ---- Objective metadata reuse (D14; reused verbatim) -----------------------

export { objectiveMetadataById, omReportCrime }

export const OBJECTIVE_METADATA_VERSION_REEXPORT = OBJECTIVE_METADATA_VERSION

// ---- Pipeline context ---------------------------------------------------------

export function planBodyIntentionContext(conflict: ConflictStore): IntentionCommitContext {
  return {
    conflict,
    universe: planBodyUniverse,
    atoms: planBodyAtoms,
    metadataById: objectiveMetadataById,
    templates: planBodyLinearShims,
  }
}

// ---- The shared committed base (spec §0.3) -----------------------------------

// After REVISION_VALID_FROM (night_4 tick 1, conflictScenario.ts) so Bel_C1'
// is already current for NPC_C at adoption time -- this fixture reuses the
// ALREADY-corrected conflict scenario (unlike `buildIntentionBase`, which
// deliberately replays without the revision to test reconsideration itself).
export const ADOPTION_TIME: WorldInstant = { night: 4, tick: 2 }

export interface PlanBodyBase {
  intentions: IntentionStore
  conflict: ConflictStore
  worldTime: WorldTimeStore
  intentionId: string
  executionScopeId: string
}

/**
 * The committed base every scenario branch forks from: the ALREADY-
 * corrected conflict scenario (Bel_C1' current for NPC_C, unlike
 * `buildIntentionBase` which deliberately replays without the revision),
 * plus NPC_C's captain-unknown baseline belief committed, then IC_P1
 * adopted from {Bel_C1'} bound directly to `PT_report_bt` (spec §0.1).
 */
export function buildPlanBodyBase(): PlanBodyBase {
  const conflictScenario = buildConflictScenario()
  let conflict = conflictScenario.store

  const committedCaptainUnknown = commitBelief(conflict, planBodyUniverse, beliefCaptainUnknown.id, WT_NIGHT4_DAWN)
  if (committedCaptainUnknown.outcome.verdict !== 'committed') {
    throw new Error('planBodyScenario: expected Bel_C_captain_unknown to commit -- fixture invariant broken')
  }
  conflict = committedCaptainUnknown.store

  const committedPantryBaseline = commitBelief(conflict, planBodyUniverse, beliefPantryBaseline.id, WT_NIGHT4_DAWN)
  if (committedPantryBaseline.outcome.verdict !== 'committed') {
    throw new Error('planBodyScenario: expected Bel_C_pantry_0 to commit -- fixture invariant broken')
  }
  conflict = committedPantryBaseline.store

  const ctx = planBodyIntentionContext(conflict)
  let intentions = initIntentionStore()

  const adopted = commitAdoption(
    intentions,
    {
      holder: 'NPC_C',
      option: {
        holder: 'NPC_C',
        candidateObjective: { objectiveType: 'report-crime', roles: { culprit: 'zombie_17', crime: 'attack-by', victim: 'guard_malik' }, canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION },
        derivedFromBeliefs: [beliefC1Prime.id],
        sourceObjectiveMetadataId: omReportCrime.id,
        sourceObjectiveMetadataVersion: omReportCrime.version,
        ruleId: 'derive_report_option',
        ruleVersion: 'ir_v0',
        priorityBasis: omReportCrime.priorityBasis,
        priorityRank: omReportCrime.priorityRank,
      },
      planBinding: { templateId: ptReportBt.id, templateVersion: ptReportBt.version, params: {} },
      reconsiderationPolicy: 'default',
      effectiveValidTime: ADOPTION_TIME,
    },
    ctx,
  )
  if (adopted.outcome.verdict !== 'committed') {
    throw new Error(`planBodyScenario: expected IC_P1 to adopt -- fixture invariant broken (${adopted.outcome.fault})`)
  }
  intentions = adopted.store

  return {
    intentions,
    conflict,
    worldTime: initWorldTimeStore(),
    intentionId: adopted.outcome.commitment.intentionId,
    executionScopeId: adopted.outcome.transition.transitionId,
  }
}

/** Reusable revision envelope builder, mirroring intentionScenario.ts's `revisionEnvelope` helper exactly. */
export function planBodyRevisionEnvelope(
  transitionId: string,
  holder: string,
  fromBeliefId: string,
  toBeliefId: string,
  validFrom: WorldInstant,
): RevisionEnvelope {
  return {
    toBeliefId,
    validFrom,
    transition: {
      transitionId,
      holder,
      fromBeliefId,
      toBeliefId,
      effectiveValidTime: validFrom,
      cause: 'superseded-by-update',
      ruleId: 'planBodyScenario_fixture',
      ruleVersion: BT_TEMPLATE_VERSION,
      canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
      inputEvidenceIds: [],
      conflictEdgeIds: [],
    },
  }
}

export function commitCaptainArrival(conflict: ConflictStore, at: WorldInstant): ConflictStore {
  const revised = commitRevision(
    conflict,
    planBodyRevisionEnvelope('BT_P0001', 'NPC_C', beliefCaptainUnknown.id, beliefCaptainAtGatehouse.id, at),
    planBodyUniverse,
  )
  if (revised.outcome.verdict !== 'committed') {
    throw new Error('planBodyScenario: expected the captain-arrival transition to commit -- fixture invariant broken')
  }
  return revised.store
}

export function commitUnrelatedPantryTransition(conflict: ConflictStore, at: WorldInstant): ConflictStore {
  const revised = commitRevision(
    conflict,
    planBodyRevisionEnvelope('BT_P0002', 'NPC_C', beliefPantryBaseline.id, beliefPantryRestocked.id, at),
    planBodyUniverse,
  )
  if (revised.outcome.verdict !== 'committed') {
    throw new Error('planBodyScenario: expected the unrelated pantry transition to commit -- fixture invariant broken')
  }
  return revised.store
}

export { claimRegistry, nightTick, TRANSITION_RULE_VERSION }
