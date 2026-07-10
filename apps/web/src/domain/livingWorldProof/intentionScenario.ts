import { applyEvidenceCorrection, beliefFromRumor } from './beliefUpdate'
import { beliefC1, beliefC1Prime } from './compactionScenario'
import type { Belief, Evidence, Observation, RumorTransmission } from './contracts'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { WorldInstant } from './conflictContracts'
import {
  CONFLICT_CANONICALIZER_VERSION,
  OVERTURN_BY_HARD_EVIDENCE_RULE_ID,
  TRANSITION_RULE_VERSION,
} from './conflictContracts'
import { JudgeProbe, replayConflictLog } from './conflictReplay'
import { buildConflictScenario, beliefB1, claimRegistry, conflictUniverse, nightTick, REVISION_VALID_FROM, TRANSITION_ID } from './conflictScenario'
import type { ConflictStore, RevisionEnvelope } from './conflictStore'
import { commitBelief, commitRevision } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'
import { beliefC2 } from './hierarchyScenario'
import { clawEvidence } from './scenario'
import type {
  IntentionTransition,
  ObjectiveAtom,
  ObjectiveAtomRegistry,
  ObjectiveMetadata,
  PlanTemplate,
  ProofActionAttempt,
} from './intentionContracts'
import { OBJECTIVE_METADATA_VERSION, PLAN_TEMPLATE_VERSION } from './intentionContracts'
import { executeAttempt, worldFacts } from './intentionActions'
import type { WorldActionFacts } from './intentionActions'
import type { IntentionPipelineContext } from './intentionPipeline'
import {
  deliberateAndAdopt,
  dispatchNextAttempts,
  reconsiderAcquiredBelief,
  reconsiderOutcomeTrigger,
  runReconsiderationTick,
} from './intentionPipeline'
import type { AttemptRequest, IntentionStore } from './intentionStore'
import { dispatchAttempt, initIntentionStore } from './intentionStore'

/**
 * Fixture for Intention Lifecycle Replay v0 (ADR-0009, spec intention-
 * lifecycle-replay-v0.md §0/§3), built additively on the already-committed
 * conflict scenario (conflictScenario.ts, unmodified). No existing fixture
 * file is edited; every rig-constructed record below is flagged in spec
 * §0.1. The scenario branches fork from one shared committed base (the
 * uncorrected conflict store, obtained by REPLAYING the committed conflict
 * log minus its revision -- never by hand-authoring parallel state), so
 * the eventual `Bel_C1 -> Bel_C1'` correction re-commits BT_0001
 * byte-identically (P3).
 *
 * Spec-name mapping (per-holder engine-issued ids):
 *   IC_C1 = C's report intention, IC_C2 = C's warn intention (spec IC_C2),
 *   scenario 3's uncorrected report intention (spec IC_C3) and scenario
 *   4's warn intention (spec IC_C4) mint as IC_C1/IC_C2 in their own
 *   forks; Bel_C1'' = Bel_C1_dprime, Bel_C1''' = Bel_C1_tprime.
 */

export const SUPERSEDE_RULE_ID = 'supersede_by_new_evidence' as const

// ---- Authored objective metadata (D14, spec §0.1) ---------------------------

export const omReportCrime: ObjectiveMetadata = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'OM_report_crime',
  version: OBJECTIVE_METADATA_VERSION,
  objectiveType: 'report-crime',
  minConfidence: 'low',
  allowUnresolved: false,
  priorityBasis: 'crime_severity=high',
  priorityRank: 2,
  retryLimit: 2,
  reconsiderationPolicy: 'default',
  forbiddenAtomKind: 'reporting-forbidden',
}

export const omWarnDanger: ObjectiveMetadata = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'OM_warn_danger',
  version: OBJECTIVE_METADATA_VERSION,
  objectiveType: 'warn-of-danger',
  minConfidence: 'low',
  allowUnresolved: false,
  priorityBasis: 'danger_urgency=medium',
  priorityRank: 1,
  retryLimit: 2,
  reconsiderationPolicy: 'default',
}

export const omCorrectRumor: ObjectiveMetadata = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'OM_correct_rumor',
  version: OBJECTIVE_METADATA_VERSION,
  objectiveType: 'correct-rumor',
  minConfidence: 'high',
  allowUnresolved: false,
  priorityBasis: 'reputation_repair=low',
  priorityRank: 1,
  retryLimit: 1,
  reconsiderationPolicy: 'default',
}

export const objectiveMetadataById: ReadonlyMap<string, ObjectiveMetadata> = new Map(
  [omReportCrime, omWarnDanger, omCorrectRumor].map((metadata) => [metadata.id, metadata]),
)

// Authored per holder (D6/D7): only B and C are motivated NPCs in v0;
// NPC_A, NPC_D, and the Tier-1 NPC_R have no objective metadata at all.
export const objectiveMetadataByHolder: ReadonlyMap<string, readonly ObjectiveMetadata[]> = new Map([
  ['NPC_B', [omReportCrime, omCorrectRumor]],
  ['NPC_C', [omReportCrime, omWarnDanger]],
])

// ---- Authored plan templates (ADR-0003 shape + goal-type trigger, spec §0.1) --

export const ptReportGatehouse: PlanTemplate = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'PT_report_gatehouse',
  version: PLAN_TEMPLATE_VERSION,
  servesObjectiveType: 'report-crime',
  contextAtomKind: 'accuses',
  steps: [
    { action: 'walk', target: 'gatehouse' },
    { action: 'speak-accusation', target: 'guard_captain' },
  ],
}

export const ptReportWatch: PlanTemplate = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'PT_report_watch',
  version: PLAN_TEMPLATE_VERSION,
  servesObjectiveType: 'report-crime',
  contextAtomKind: 'accuses',
  steps: [
    { action: 'approach', target: 'town_watchman' },
    { action: 'speak-accusation', target: 'town_watchman' },
  ],
}

export const ptWarnTownsfolk: PlanTemplate = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'PT_warn_townsfolk',
  version: PLAN_TEMPLATE_VERSION,
  servesObjectiveType: 'warn-of-danger',
  contextAtomKind: 'danger-present',
  steps: [{ action: 'speak-warning', target: 'townsfolk' }],
}

export const ptCorrectRumor: PlanTemplate = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'PT_correct_rumor',
  version: PLAN_TEMPLATE_VERSION,
  servesObjectiveType: 'correct-rumor',
  contextAtomKind: 'attack-by',
  steps: [{ action: 'speak-correction', target: 'townsfolk' }],
}

export const planTemplates: readonly PlanTemplate[] = [ptReportGatehouse, ptReportWatch, ptWarnTownsfolk, ptCorrectRumor]

// ---- Rig-constructed records (spec §0.1 -- hypothetical, additive) ----------

// Scenario 2's support-refresh subjects. Bel_C1'' / Bel_C1''' are ordinary
// belief-update outputs the rig names so the refresh chain has a subject;
// their transitions BT_0002/BT_0003 are committed by the fork builders.
export const cellarWatchEvidence: Evidence = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'E_cellar_watch',
  truthRef: 'T1',
  implies: 'zombie_17 attacked guard_malik and remains in the cellar',
  contradicts: 'the cellar is free of danger',
  strength: 'hard',
  presentedTo: 'NPC_C',
  time: 'night_5',
}

export const cellarClearEvidence: Evidence = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'E_cellar_clear',
  truthRef: 'T1',
  implies: 'the cellar is now clear',
  contradicts: 'zombie_17 remains in the cellar',
  strength: 'hard',
  presentedTo: 'NPC_C',
  time: 'night_5',
}

/** Spec name Bel_C1'': still entails an active cellar danger (refresh-support subject). */
export const beliefC1DoublePrime: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_C1_dprime',
  holder: 'NPC_C',
  proposition: cellarWatchEvidence.implies,
  confidence: 'high',
  sourceType: 'evidence',
  sourceRef: cellarWatchEvidence.id,
  supporting: [cellarWatchEvidence.id],
  contradicting: [],
  lastUpdated: 'night_5',
}

/** Spec name Bel_C1''': the danger is gone -- no longer entails the warn objective. */
export const beliefC1TriplePrime: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_C1_tprime',
  holder: 'NPC_C',
  proposition: cellarClearEvidence.implies,
  confidence: 'high',
  sourceType: 'evidence',
  sourceRef: cellarClearEvidence.id,
  supporting: [cellarClearEvidence.id],
  contradicting: [],
  lastUpdated: 'night_5',
}

// P9's unrelated pantry-incident correction (touches no intention's support).
export const pantryRestockEvidence: Evidence = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'E_pantry_restock',
  truthRef: 'T2',
  implies: 'the pantry stock was restacked',
  contradicts: beliefC2.proposition,
  strength: 'hard',
  presentedTo: 'NPC_C',
  time: 'night_4',
}

export const beliefC2Prime: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_C2_prime',
  holder: 'NPC_C',
  proposition: pantryRestockEvidence.implies,
  confidence: 'high',
  sourceType: 'evidence',
  sourceRef: pantryRestockEvidence.id,
  supporting: [pantryRestockEvidence.id],
  contradicting: [],
  lastUpdated: 'night_4',
}

// Terminal-case subjects: belief-recognized achievement, forbiddenness, and
// impossibility (D12: recognized from the holder's beliefs, never truth).
export const beliefCWarned: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_C_warned',
  holder: 'NPC_C',
  proposition: 'the townsfolk have been warned about the cellar danger',
  confidence: 'high',
  sourceType: 'inference',
  sourceRef: 'townsfolk-acknowledged-warning',
  supporting: [],
  contradicting: [],
  lastUpdated: 'night_4',
}

export const beliefCForbidden: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_C_forbidden',
  holder: 'NPC_C',
  proposition: 'the watch captain has forbidden further reports tonight',
  confidence: 'high',
  sourceType: 'inference',
  sourceRef: 'captain-curfew-decree',
  supporting: [],
  contradicting: [],
  lastUpdated: 'night_4',
}

export const beliefCImpossible: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_C_impossible',
  holder: 'NPC_C',
  proposition: 'reporting is impossible: the gatehouse has collapsed and no watch remains',
  confidence: 'high',
  sourceType: 'inference',
  sourceRef: 'gatehouse-collapse-news',
  supporting: [],
  contradicting: [],
  lastUpdated: 'night_4',
}

// Returned circular rumor branch (D16/P27/F14): B accuses -> tells C (the
// committed R_B_to_C) -> C tells D -> B is corrected by evidence -> D
// repeats the original accusation back to B.
export const rumorCToD: RumorTransmission = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'R_C_to_D',
  from: 'NPC_C',
  to: 'NPC_D',
  proposition: beliefC1.proposition,
  sourceBelief: beliefC1.id,
  mutation: 'faithful',
  speakerTrust: 'medium',
  time: 'night_4',
}

export const beliefD2 = beliefFromRumor(rumorCToD, 'Bel_D2')

export const rumorDToB: RumorTransmission = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'R_D_to_B',
  from: 'NPC_D',
  to: 'NPC_B',
  proposition: beliefD2.proposition,
  sourceBelief: beliefD2.id,
  mutation: 'faithful',
  speakerTrust: 'medium',
  time: 'night_5',
}

export const clawEvidenceForB: Evidence = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'E_claw_B',
  truthRef: 'T1',
  implies: clawEvidence.implies,
  contradicts: beliefB1.proposition,
  strength: 'hard',
  presentedTo: 'NPC_B',
  time: 'night_5',
}

const bCorrection = applyEvidenceCorrection(beliefB1, clawEvidenceForB, 'Bel_B1_prime')
if (bCorrection.status !== 'corrected') {
  throw new Error('intentionScenario: expected E_claw_B to correct Bel_B1 -- fixture invariant broken')
}

export const beliefB1Prime = bCorrection.corrected

/** B *hearing* D's returned rumor is an ordinary observation; the utterance itself never becomes a belief (D16). */
export const circulationObservation: Observation = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'O_NPC_B_heard_RDB',
  observer: 'NPC_B',
  truthRef: rumorDToB.id,
  channels: ['sound'],
  perceived: { actor: 'NPC_D', action: 'repeats-accusation', target: 'player' },
  missing: [],
  fidelity: 'full',
  time: 'night_5',
}

export const beliefBHeard: Belief = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'Bel_B_heard',
  holder: 'NPC_B',
  proposition: 'the false accusation against the player is still circulating',
  confidence: 'high',
  sourceType: 'observation',
  sourceRef: circulationObservation.id,
  supporting: [circulationObservation.id],
  contradicting: [],
  lastUpdated: 'night_5',
}

// ---- The extended record universe (additive; conflictUniverse unchanged) ----

export const intentionUniverse: ReadableRecord[] = [
  ...conflictUniverse,
  { kind: 'evidence', record: cellarWatchEvidence },
  { kind: 'evidence', record: cellarClearEvidence },
  { kind: 'belief', record: beliefC1DoublePrime },
  { kind: 'belief', record: beliefC1TriplePrime },
  { kind: 'evidence', record: pantryRestockEvidence },
  { kind: 'belief', record: beliefC2Prime },
  { kind: 'belief', record: beliefCWarned },
  { kind: 'belief', record: beliefCForbidden },
  { kind: 'belief', record: beliefCImpossible },
  { kind: 'rumor', record: rumorCToD },
  { kind: 'belief', record: beliefD2 },
  { kind: 'rumor', record: rumorDToB },
  { kind: 'evidence', record: clawEvidenceForB },
  { kind: 'belief', record: beliefB1Prime },
  { kind: 'observation', record: circulationObservation },
  { kind: 'belief', record: beliefBHeard },
]

// ---- Hand-registered entailment atoms (spec §0.1: canonical inputs, never
// parsed from prose -- the ClaimRegistry discipline one layer up) ------------

export const objectiveAtoms: ObjectiveAtomRegistry = new Map<string, readonly ObjectiveAtom[]>([
  [beliefC1.id, [{ kind: 'accuses', roles: { culprit: 'player', crime: 'attacked', victim: 'guard_malik' } }]],
  [beliefB1.id, [{ kind: 'accuses', roles: { culprit: 'player', crime: 'involved_in', victim: 'guard_malik' } }]],
  [
    beliefC1Prime.id,
    [
      { kind: 'attack-by', roles: { actor: 'zombie_17', victim: 'guard_malik' } },
      { kind: 'danger-present', roles: { location: 'cellar', source: 'zombie_17' } },
    ],
  ],
  [
    beliefC1DoublePrime.id,
    [
      { kind: 'attack-by', roles: { actor: 'zombie_17', victim: 'guard_malik' } },
      { kind: 'danger-present', roles: { location: 'cellar', source: 'zombie_17' } },
    ],
  ],
  [beliefC1TriplePrime.id, [{ kind: 'danger-cleared', roles: { location: 'cellar' } }]],
  [beliefB1Prime.id, [{ kind: 'attack-by', roles: { actor: 'zombie_17', victim: 'guard_malik' } }]],
  [beliefBHeard.id, [{ kind: 'false-accusation-circulating', roles: { accused: 'player' } }]],
  [beliefCWarned.id, [{ kind: 'objective-achieved', roles: { objectiveType: 'warn-of-danger', location: 'cellar' } }]],
  [beliefCForbidden.id, [{ kind: 'reporting-forbidden', roles: {} }]],
  [beliefCImpossible.id, [{ kind: 'objective-impossible', roles: { objectiveType: 'report-crime' } }]],
])

// ---- Pipeline context --------------------------------------------------------

export function intentionContext(conflict: ConflictStore): IntentionPipelineContext {
  return {
    conflict,
    universe: intentionUniverse,
    atoms: objectiveAtoms,
    metadataById: objectiveMetadataById,
    metadataByHolder: objectiveMetadataByHolder,
    templates: planTemplates,
  }
}

// ---- World-time anchors ------------------------------------------------------

export const ADOPTION_TIME: WorldInstant = nightTick('night_4')
export const CORRECTION_TIME: WorldInstant = REVISION_VALID_FROM
export const REFRESH_TIME: WorldInstant = nightTick('night_5')
export const REMOVAL_TIME: WorldInstant = nightTick('night_5', 1)

function revisionEnvelope(
  transitionId: string,
  holder: string,
  fromBeliefId: string,
  toBeliefId: string,
  validFrom: WorldInstant,
  cause: 'corrected-by-evidence' | 'superseded-by-update',
  ruleId: string,
  inputEvidenceIds: readonly string[],
  conflictEdgeIds: readonly string[] = [],
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
      cause,
      ruleId,
      ruleVersion: TRANSITION_RULE_VERSION,
      canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
      inputEvidenceIds,
      conflictEdgeIds,
    },
  }
}

function mustReviseConflict(
  result: ReturnType<typeof commitRevision>,
  label: string,
): { store: ConflictStore; transitionId: string } {
  if (result.outcome.verdict !== 'committed') {
    throw new Error(`intentionScenario: expected ${label} to commit -- fixture invariant broken`)
  }
  return { store: result.store, transitionId: result.outcome.transition.transitionId }
}

// ---- The shared committed base (spec §0.3) -----------------------------------

export interface IntentionScenarioBase {
  intentions: IntentionStore
  conflict: ConflictStore
  conflictEdgeId: string
  /** B's independently supported report intention (P8's bystander). */
  icB1: string
  /** C's rumor-driven report intention (spec IC_C1). */
  icC1: string
}

/**
 * The committed base every branch forks from: the conflict scenario's own
 * commit log replayed WITHOUT its revision (so C still holds Bel_C1), then
 * B and C each adopt their report intention from their own scoped beliefs.
 * BT_0001 is re-committed later by the branch runners through the same
 * envelope the conflict scenario used, reproducing it byte-for-byte (P3).
 */
export function buildIntentionBase(): IntentionScenarioBase {
  const full = buildConflictScenario()
  const preRevisionCommits = full.store.commitLog.filter((commit) => commit.kind !== 'revision')
  const uncorrected = replayConflictLog(intentionUniverse, claimRegistry, preRevisionCommits, new JudgeProbe()).store

  let intentions = initIntentionStore()
  const ctx = intentionContext(uncorrected)

  const adoptedB = deliberateAndAdopt(intentions, ctx, 'NPC_B', ADOPTION_TIME)
  if (adoptedB.adopted?.verdict !== 'committed') {
    throw new Error('intentionScenario: expected NPC_B to adopt its report intention -- fixture invariant broken')
  }
  intentions = adoptedB.store

  const adoptedC = deliberateAndAdopt(intentions, ctx, 'NPC_C', ADOPTION_TIME)
  if (adoptedC.adopted?.verdict !== 'committed') {
    throw new Error('intentionScenario: expected NPC_C to adopt its report intention -- fixture invariant broken')
  }
  intentions = adoptedC.store

  return {
    intentions,
    conflict: uncorrected,
    conflictEdgeId: full.conflictEdgeId,
    icB1: adoptedB.adopted.commitment.intentionId,
    icC1: adoptedC.adopted.commitment.intentionId,
  }
}

/** The exact envelope the conflict scenario committed BT_0001 with -- reused verbatim so the record reproduces byte-for-byte (P3). */
export function bt0001Envelope(conflictEdgeId: string): RevisionEnvelope {
  return revisionEnvelope(
    TRANSITION_ID,
    'NPC_C',
    beliefC1.id,
    beliefC1Prime.id,
    REVISION_VALID_FROM,
    'corrected-by-evidence',
    OVERTURN_BY_HARD_EVIDENCE_RULE_ID,
    [clawEvidence.id],
    [conflictEdgeId],
  )
}

// ---- Scenario 1: belief-correction reconsideration (P1-P9) --------------------

export interface Scenario1Result {
  base: IntentionScenarioBase
  intentions: IntentionStore
  conflict: ConflictStore
  abandonTransition: IntentionTransition
  /** Attempts dispatched in the same tick as BT_0001 -- none may reference IC_C1 (P5). */
  dispatchedAfterCorrection: readonly ProofActionAttempt[]
  /** C's belief-driven re-adoption (spec IC_C2). */
  icC2: string
}

export function runScenario1(base: IntentionScenarioBase = buildIntentionBase()): Scenario1Result {
  const revised = mustReviseConflict(
    commitRevision(base.conflict, bt0001Envelope(base.conflictEdgeId), intentionUniverse),
    TRANSITION_ID,
  )
  const ctx = intentionContext(revised.store)

  const tick = runReconsiderationTick(base.intentions, ctx, [TRANSITION_ID], CORRECTION_TIME)
  const [abandonTransition] = tick.committedTransitions
  if (abandonTransition === undefined || abandonTransition.kind !== 'abandon') {
    throw new Error('intentionScenario: expected BT_0001 to abandon IC_C1 -- fixture invariant broken')
  }

  const dispatchPhase = dispatchNextAttempts(tick.store, ctx)

  const readopted = deliberateAndAdopt(dispatchPhase.store, ctx, 'NPC_C', CORRECTION_TIME)
  if (readopted.adopted?.verdict !== 'committed') {
    throw new Error('intentionScenario: expected NPC_C to re-adopt the warn intention -- fixture invariant broken')
  }

  return {
    base,
    intentions: readopted.store,
    conflict: revised.store,
    abandonTransition,
    dispatchedAfterCorrection: dispatchPhase.dispatched,
    icC2: readopted.adopted.commitment.intentionId,
  }
}

/** P9's unrelated-belief fork: the pantry correction reconsiders no intention and writes no IntentionTransition. */
export function runUnrelatedNoOpFork(scenario1: Scenario1Result): {
  intentions: IntentionStore
  conflict: ConflictStore
  committedTransitions: readonly IntentionTransition[]
} {
  const revised = mustReviseConflict(
    commitRevision(
      scenario1.conflict,
      revisionEnvelope('BT_0009', 'NPC_C', beliefC2.id, beliefC2Prime.id, nightTick('night_4', 2), 'superseded-by-update', SUPERSEDE_RULE_ID, [
        pantryRestockEvidence.id,
      ]),
      intentionUniverse,
    ),
    'BT_0009',
  )
  const tick = runReconsiderationTick(scenario1.intentions, intentionContext(revised.store), ['BT_0009'], nightTick('night_4', 2))
  return { intentions: tick.store, conflict: revised.store, committedTransitions: tick.committedTransitions }
}

// ---- Scenario 2: support-refresh chain (P10-P12) ------------------------------

export interface Scenario2Result {
  scenario1: Scenario1Result
  /** Snapshot while IC_C2 is still open with refreshed support {Bel_C1''} -- the compaction rig's open-pin state (P23). */
  afterRefresh: { intentions: IntentionStore; conflict: ConflictStore }
  intentions: IntentionStore
  conflict: ConflictStore
  refreshTransition: IntentionTransition
  removalTransition: IntentionTransition
}

export function runScenario2(scenario1: Scenario1Result = runScenario1()): Scenario2Result {
  const refreshRevision = mustReviseConflict(
    commitRevision(
      scenario1.conflict,
      revisionEnvelope('BT_0002', 'NPC_C', beliefC1Prime.id, beliefC1DoublePrime.id, REFRESH_TIME, 'superseded-by-update', SUPERSEDE_RULE_ID, [
        cellarWatchEvidence.id,
      ]),
      intentionUniverse,
    ),
    'BT_0002',
  )
  const refreshTick = runReconsiderationTick(scenario1.intentions, intentionContext(refreshRevision.store), ['BT_0002'], REFRESH_TIME)
  const [refreshTransition] = refreshTick.committedTransitions
  if (refreshTransition === undefined || refreshTransition.kind !== 'refresh-support') {
    throw new Error('intentionScenario: expected BT_0002 to refresh IC_C2 support -- fixture invariant broken')
  }

  const removalRevision = mustReviseConflict(
    commitRevision(
      refreshRevision.store,
      revisionEnvelope(
        'BT_0003',
        'NPC_C',
        beliefC1DoublePrime.id,
        beliefC1TriplePrime.id,
        REMOVAL_TIME,
        'superseded-by-update',
        SUPERSEDE_RULE_ID,
        [cellarClearEvidence.id],
      ),
      intentionUniverse,
    ),
    'BT_0003',
  )
  const removalTick = runReconsiderationTick(refreshTick.store, intentionContext(removalRevision.store), ['BT_0003'], REMOVAL_TIME)
  const [removalTransition] = removalTick.committedTransitions
  if (removalTransition === undefined || removalTransition.kind !== 'abandon') {
    throw new Error('intentionScenario: expected BT_0003 to abandon IC_C2 -- fixture invariant broken')
  }

  return {
    scenario1,
    afterRefresh: { intentions: refreshTick.store, conflict: refreshRevision.store },
    intentions: removalTick.store,
    conflict: removalRevision.store,
    refreshTransition,
    removalTransition,
  }
}

// ---- Scenario 3: plan failure, rebind, exhaustion (P13-P17) --------------------

export interface Scenario3Step {
  attempt: ProofActionAttempt
  outcomeId: string
  committedTransitions: readonly IntentionTransition[]
}

export interface Scenario3Result {
  base: IntentionScenarioBase
  intentions: IntentionStore
  /** Store snapshot right after the retried (successful) walk -- IC_C3 still open, no transition written yet (P13). */
  afterRetry: IntentionStore
  steps: {
    blockedWalk: Scenario3Step
    retriedWalk: Scenario3Step
    captainAbsent: Scenario3Step
    watchmanAbsent: Scenario3Step
  }
}

function runPlanStep(
  intentions: IntentionStore,
  ctx: IntentionPipelineContext,
  facts: WorldActionFacts,
  validT: WorldInstant,
  timeLabel: string,
): { store: IntentionStore; step: Scenario3Step } {
  const dispatched = dispatchNextAttempts(intentions, ctx, ['NPC_C'])
  const [attempt] = dispatched.dispatched
  if (attempt === undefined) {
    throw new Error('intentionScenario: expected a plan-step attempt to dispatch -- fixture invariant broken')
  }
  const executed = executeAttempt(dispatched.store, attempt.id, facts, timeLabel)
  if (executed.outcome.verdict !== 'committed') {
    throw new Error('intentionScenario: expected the attempt outcome to commit -- fixture invariant broken')
  }
  const outcomeId = executed.outcome.outcome.id
  const reconsidered = reconsiderOutcomeTrigger(executed.store, ctx, outcomeId, validT)
  return { store: reconsidered.store, step: { attempt, outcomeId, committedTransitions: reconsidered.committedTransitions } }
}

/**
 * The uncorrected fork (spec IC_C3): C's report intention survives a failed
 * action (retry), rebinds when the gatehouse plan proves inapplicable in
 * fiction, and fails terminally only on exhaustion.
 */
export function runScenario3(base: IntentionScenarioBase = buildIntentionBase()): Scenario3Result {
  const ctx = intentionContext(base.conflict)

  const blocked = runPlanStep(base.intentions, ctx, worldFacts({ blockedTargets: new Set(['gatehouse']) }), nightTick('night_4', 2), 'night_4')
  const retried = runPlanStep(blocked.store, ctx, worldFacts(), nightTick('night_4', 3), 'night_4')
  const captainAbsent = runPlanStep(
    retried.store,
    ctx,
    worldFacts({ absentTargets: new Set(['guard_captain']) }),
    nightTick('night_4', 4),
    'night_4',
  )
  const watchmanAbsent = runPlanStep(
    captainAbsent.store,
    ctx,
    worldFacts({ absentTargets: new Set(['town_watchman']) }),
    nightTick('night_4', 5),
    'night_4',
  )

  return {
    base,
    intentions: watchmanAbsent.store,
    afterRetry: retried.store,
    steps: {
      blockedWalk: blocked.step,
      retriedWalk: retried.step,
      captainAbsent: captainAbsent.step,
      watchmanAbsent: watchmanAbsent.step,
    },
  }
}

/** P16's impossible/forbidden variants: typed validator failures that mint no consequence. */
export function runInvalidAttemptFork(base: IntentionScenarioBase = buildIntentionBase()): {
  intentions: IntentionStore
  impossibleOutcomeId: string
  forbiddenOutcomeId: string
} {
  let intentions = base.intentions

  const impossibleDispatch = dispatchAttempt(intentions, {
    actor: 'NPC_C',
    action: 'open',
    target: 'inner_door',
    intentionId: base.icC1,
    planTemplateId: null,
  })
  if (impossibleDispatch.outcome.verdict !== 'dispatched') {
    throw new Error('intentionScenario: expected the impossible attempt to dispatch -- fixture invariant broken')
  }
  intentions = impossibleDispatch.store
  const impossibleExec = executeAttempt(
    intentions,
    impossibleDispatch.outcome.attempt.id,
    worldFacts({ lockedTargets: new Set(['inner_door']) }),
    'night_4',
  )
  if (impossibleExec.outcome.verdict !== 'committed') {
    throw new Error('intentionScenario: expected the impossible outcome to commit -- fixture invariant broken')
  }
  intentions = impossibleExec.store

  const forbiddenDispatch = dispatchAttempt(intentions, {
    actor: 'NPC_C',
    action: 'strike',
    target: 'townsfolk',
    intentionId: base.icC1,
    planTemplateId: null,
  })
  if (forbiddenDispatch.outcome.verdict !== 'dispatched') {
    throw new Error('intentionScenario: expected the forbidden attempt to dispatch -- fixture invariant broken')
  }
  intentions = forbiddenDispatch.store
  const forbiddenExec = executeAttempt(
    intentions,
    forbiddenDispatch.outcome.attempt.id,
    worldFacts({ forbiddenPairs: new Set(['strike:townsfolk']) }),
    'night_4',
  )
  if (forbiddenExec.outcome.verdict !== 'committed') {
    throw new Error('intentionScenario: expected the forbidden outcome to commit -- fixture invariant broken')
  }
  intentions = forbiddenExec.store

  return {
    intentions,
    impossibleOutcomeId: impossibleExec.outcome.outcome.id,
    forbiddenOutcomeId: forbiddenExec.outcome.outcome.id,
  }
}

// ---- Scenario 4: delayed outcome across closure (P18-P20) ----------------------

export interface Scenario4Result {
  scenario1: Scenario1Result
  intentions: IntentionStore
  conflict: ConflictStore
  icC2: string
  warnAttempt: ProofActionAttempt
  abandonTransition: IntentionTransition
  delayedOutcomeId: string
}

export function runScenario4(scenario1: Scenario1Result = runScenario1()): Scenario4Result {
  const ctxBefore = intentionContext(scenario1.conflict)

  const dispatched = dispatchNextAttempts(scenario1.intentions, ctxBefore, ['NPC_C'])
  const [warnAttempt] = dispatched.dispatched
  if (warnAttempt === undefined || warnAttempt.intentionId !== scenario1.icC2) {
    throw new Error('intentionScenario: expected the warn attempt to dispatch while IC_C2 was open -- fixture invariant broken')
  }

  const revised = mustReviseConflict(
    commitRevision(
      scenario1.conflict,
      revisionEnvelope(
        'BT_0004',
        'NPC_C',
        beliefC1Prime.id,
        beliefC1TriplePrime.id,
        nightTick('night_4', 2),
        'superseded-by-update',
        SUPERSEDE_RULE_ID,
        [cellarClearEvidence.id],
      ),
      intentionUniverse,
    ),
    'BT_0004',
  )
  const ctxAfter = intentionContext(revised.store)
  const tick = runReconsiderationTick(dispatched.store, ctxAfter, ['BT_0004'], nightTick('night_4', 2))
  const [abandonTransition] = tick.committedTransitions
  if (abandonTransition === undefined || abandonTransition.kind !== 'abandon') {
    throw new Error('intentionScenario: expected BT_0004 to abandon IC_C2 -- fixture invariant broken')
  }

  const executed = executeAttempt(tick.store, warnAttempt.id, worldFacts(), 'night_4')
  if (executed.outcome.verdict !== 'committed') {
    throw new Error('intentionScenario: expected the delayed outcome to commit -- fixture invariant broken')
  }

  return {
    scenario1,
    intentions: executed.store,
    conflict: revised.store,
    icC2: scenario1.icC2,
    warnAttempt,
    abandonTransition,
    delayedOutcomeId: executed.outcome.outcome.id,
  }
}

// ---- Belief-recognized terminal forks (complete / forbidden / impossible) -----

export function runCompleteFork(scenario1: Scenario1Result = runScenario1()): {
  intentions: IntentionStore
  completeTransition: IntentionTransition
} {
  const committed = commitBelief(scenario1.conflict, intentionUniverse, beliefCWarned.id, nightTick('night_4', 3))
  if (committed.outcome.verdict !== 'committed') {
    throw new Error('intentionScenario: expected Bel_C_warned to commit -- fixture invariant broken')
  }
  const tick = reconsiderAcquiredBelief(
    scenario1.intentions,
    intentionContext(committed.store),
    'NPC_C',
    beliefCWarned.id,
    nightTick('night_4', 3),
  )
  const [completeTransition] = tick.committedTransitions
  if (completeTransition === undefined || completeTransition.kind !== 'complete') {
    throw new Error('intentionScenario: expected Bel_C_warned to complete IC_C2 -- fixture invariant broken')
  }
  return { intentions: tick.store, completeTransition }
}

export function runForbiddenFork(base: IntentionScenarioBase = buildIntentionBase()): {
  intentions: IntentionStore
  abandonTransition: IntentionTransition
} {
  const committed = commitBelief(base.conflict, intentionUniverse, beliefCForbidden.id, nightTick('night_4', 1))
  if (committed.outcome.verdict !== 'committed') {
    throw new Error('intentionScenario: expected Bel_C_forbidden to commit -- fixture invariant broken')
  }
  const tick = reconsiderAcquiredBelief(
    base.intentions,
    intentionContext(committed.store),
    'NPC_C',
    beliefCForbidden.id,
    nightTick('night_4', 1),
  )
  const [abandonTransition] = tick.committedTransitions
  if (abandonTransition === undefined || abandonTransition.cause !== 'forbidden-by-belief') {
    throw new Error('intentionScenario: expected Bel_C_forbidden to abandon IC_C1 -- fixture invariant broken')
  }
  return { intentions: tick.store, abandonTransition }
}

export function runImpossibleFork(base: IntentionScenarioBase = buildIntentionBase()): {
  intentions: IntentionStore
  abandonTransition: IntentionTransition
} {
  const committed = commitBelief(base.conflict, intentionUniverse, beliefCImpossible.id, nightTick('night_4', 1))
  if (committed.outcome.verdict !== 'committed') {
    throw new Error('intentionScenario: expected Bel_C_impossible to commit -- fixture invariant broken')
  }
  const tick = reconsiderAcquiredBelief(
    base.intentions,
    intentionContext(committed.store),
    'NPC_C',
    beliefCImpossible.id,
    nightTick('night_4', 1),
  )
  const [abandonTransition] = tick.committedTransitions
  if (abandonTransition === undefined || abandonTransition.cause !== 'impossible-by-belief') {
    throw new Error('intentionScenario: expected Bel_C_impossible to abandon IC_C1 -- fixture invariant broken')
  }
  return { intentions: tick.store, abandonTransition }
}

// ---- Returned circular rumor fork (P27/F14) ------------------------------------

export interface ReturnedRumorForkResult {
  base: IntentionScenarioBase
  intentions: IntentionStore
  conflict: ConflictStore
  bAbandonTransition: IntentionTransition
  /** Deliberation immediately after the returned rumor: no accusation re-adoption. */
  postRumorAdoption: ReturnType<typeof deliberateAndAdopt>
  /** Deliberation after B's circulation belief commits: the correct-rumor alternative. */
  correctRumorAdoption: ReturnType<typeof deliberateAndAdopt>
}

export function runReturnedRumorFork(base: IntentionScenarioBase = buildIntentionBase()): ReturnedRumorForkResult {
  // C told D (rig transmission): D's belief in the rumor commits normally.
  const dBelief = commitBelief(base.conflict, intentionUniverse, beliefD2.id, nightTick('night_4', 1))
  if (dBelief.outcome.verdict !== 'committed') {
    throw new Error('intentionScenario: expected Bel_D2 to commit -- fixture invariant broken')
  }

  // B receives corrective evidence: an authoritative BeliefTransition.
  const corrected = mustReviseConflict(
    commitRevision(
      dBelief.store,
      revisionEnvelope(
        'BT_0006',
        'NPC_B',
        beliefB1.id,
        beliefB1Prime.id,
        nightTick('night_5'),
        'corrected-by-evidence',
        OVERTURN_BY_HARD_EVIDENCE_RULE_ID,
        [clawEvidenceForB.id],
      ),
      intentionUniverse,
    ),
    'BT_0006',
  )

  const tick = runReconsiderationTick(base.intentions, intentionContext(corrected.store), ['BT_0006'], nightTick('night_5'))
  const [bAbandonTransition] = tick.committedTransitions
  if (bAbandonTransition === undefined || bAbandonTransition.kind !== 'abandon' || bAbandonTransition.holder !== 'NPC_B') {
    throw new Error('intentionScenario: expected BT_0006 to abandon IC_B1 -- fixture invariant broken')
  }

  // D repeats the original accusation back to B (R_D_to_B). Hearing it
  // commits NO belief and NO BeliefTransition -- the utterance is only an
  // input to the belief calculus, whose provenance check rejects it as
  // corroboration (F14). The intention layer sees nothing new:
  const postRumorAdoption = deliberateAndAdopt(tick.store, intentionContext(corrected.store), 'NPC_B', nightTick('night_5', 1))

  // What B legitimately gains is an ordinary observation-grounded belief
  // that the false accusation is circulating -- from which the deterministic
  // correct-the-rumor alternative derives (P27).
  const heard = commitBelief(corrected.store, intentionUniverse, beliefBHeard.id, nightTick('night_5', 1))
  if (heard.outcome.verdict !== 'committed') {
    throw new Error('intentionScenario: expected Bel_B_heard to commit -- fixture invariant broken')
  }
  const correctRumorAdoption = deliberateAndAdopt(
    postRumorAdoption.store,
    intentionContext(heard.store),
    'NPC_B',
    nightTick('night_5', 2),
  )

  return {
    base,
    intentions: correctRumorAdoption.store,
    conflict: heard.store,
    bAbandonTransition,
    postRumorAdoption,
    correctRumorAdoption,
  }
}

// ---- Tier-1 baseline: NPC_R, a routine patroller (P26/D15) ---------------------

export const PATROL_ROUTE: readonly string[] = ['gate', 'corridor', 'cellar_door', 'corridor']

/** Tier-1 behavior is a pure function of routine rules + the tick -- nothing to store (the ADR-0007 derive-don't-store test). */
export function routineAttemptRequestFor(tick: number): AttemptRequest {
  return {
    actor: 'NPC_R',
    action: 'patrol-move',
    target: PATROL_ROUTE[tick % PATROL_ROUTE.length] ?? 'gate',
    intentionId: null,
    planTemplateId: null,
  }
}

export function runTierOneRoutine(intentions: IntentionStore, ticks: number): {
  intentions: IntentionStore
  attempts: readonly ProofActionAttempt[]
} {
  let store = intentions
  const attempts: ProofActionAttempt[] = []
  for (let tick = 0; tick < ticks; tick += 1) {
    const dispatched = dispatchAttempt(store, routineAttemptRequestFor(tick))
    if (dispatched.outcome.verdict !== 'dispatched') {
      throw new Error('intentionScenario: expected the routine attempt to dispatch -- fixture invariant broken')
    }
    store = dispatched.store
    const executed = executeAttempt(store, dispatched.outcome.attempt.id, worldFacts(), 'night_4')
    if (executed.outcome.verdict !== 'committed') {
      throw new Error('intentionScenario: expected the routine outcome to commit -- fixture invariant broken')
    }
    store = executed.store
    attempts.push(dispatched.outcome.attempt)
  }
  return { intentions: store, attempts }
}
