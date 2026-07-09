import { beliefFromObservation } from './beliefUpdate'
import type { Observation, SceneEvent } from './contracts'
import type { ReadableRecord } from './evidenceRecords'
import { beliefA1, beliefC1, beliefD1, observations, postEvidenceRecords, preEvidenceRecords } from './evidenceScenario'
import type { ArcRecord } from './hierarchyContracts'
import { clawEvidence, rumorAToB, rumorBToC } from './scenario'

/**
 * Fixture extension for Hierarchical Evidence Navigation v0 (ADR-0006), on
 * top of the already-committed cellar scenario and its proven
 * observation-scope + belief-update + evidence-recovery pipeline
 * (evidenceScenario.ts, unmodified). Adds exactly two minimal background
 * incidents -- required so branch-hiding and misrouting are testable at
 * all, per the approved research spec -- and three arcs grouping the
 * NPC-layer (never TruthEvent) records into "the cellar incident", "the
 * pantry shelf collapse", and "the gate patrol rotation change".
 *
 * T2/T3 and their Observations are hand-authored rather than run through
 * computeObservations/topology: the desired witness pattern (B+C see the
 * pantry; A+D see the gate; neither incident overlaps the cellar) cannot
 * be produced from the existing topology without extending the shared
 * scenario.ts nodes/edges, which would risk the two already-passed
 * proofs. The observation-scope engine is already proven; this rig is not
 * re-testing it.
 */

export const truthT2: SceneEvent = {
  schemaVersion: 1,
  id: 'T2',
  actor: 'shelf',
  action: 'collapsed',
  target: 'pantry_stock',
  location: { node: 'pantry' },
  time: 'night_2',
  emissions: [{ channel: 'sight', exposes: ['actor', 'action', 'target', 'location'] }],
}

export const observationB_T2: Observation = {
  schemaVersion: 1,
  id: 'O_NPC_B_T2',
  observer: 'NPC_B',
  truthRef: 'T2',
  channels: ['sight'],
  perceived: { actor: 'shelf', action: 'collapsed', target: 'pantry_stock', location: 'pantry' },
  missing: [],
  fidelity: 'full',
  time: 'night_2',
}

export const observationC_T2: Observation = {
  schemaVersion: 1,
  id: 'O_NPC_C_T2',
  observer: 'NPC_C',
  truthRef: 'T2',
  channels: ['sight'],
  perceived: { actor: 'shelf', action: 'collapsed', target: 'pantry_stock', location: 'pantry' },
  missing: [],
  fidelity: 'full',
  time: 'night_2',
}

export const beliefC2 = beliefFromObservation(observationC_T2, 'Bel_C2')

export const truthT3: SceneEvent = {
  schemaVersion: 1,
  id: 'T3',
  actor: 'watch_captain',
  action: 'rotated',
  target: 'gate_patrol',
  location: { node: 'gate' },
  time: 'night_2',
  emissions: [{ channel: 'sight', exposes: ['actor', 'action', 'target', 'location'] }],
}

export const observationA_T3: Observation = {
  schemaVersion: 1,
  id: 'O_NPC_A_T3',
  observer: 'NPC_A',
  truthRef: 'T3',
  channels: ['sight'],
  perceived: { actor: 'watch_captain', action: 'rotated', target: 'gate_patrol', location: 'gate' },
  missing: [],
  fidelity: 'full',
  time: 'night_2',
}

export const observationD_T3: Observation = {
  schemaVersion: 1,
  id: 'O_NPC_D_T3',
  observer: 'NPC_D',
  truthRef: 'T3',
  channels: ['sight'],
  perceived: { actor: 'watch_captain', action: 'rotated', target: 'gate_patrol', location: 'gate' },
  missing: [],
  fidelity: 'full',
  time: 'night_2',
}

// arc_cellar's membership is derived from evidenceScenario.ts's real
// exports rather than hand-typed, so it cannot drift from the already-
// proven fixture it groups.
const cellarObservationIds = observations
  .filter((observation) => observation.truthRef === 'T0' || observation.truthRef === 'T1')
  .map((observation) => observation.id)

export const arcCellarPreEvidence: ArcRecord = {
  schemaVersion: 1,
  id: 'arc_cellar',
  label: 'the cellar incident',
  memberIds: [...cellarObservationIds, rumorAToB.id, rumorBToC.id, beliefA1.id, beliefD1.id, beliefC1.id],
  times: ['night_3', 'night_4'],
  participants: ['player', 'guard_malik', 'zombie_17', 'NPC_A', 'NPC_B', 'NPC_C', 'NPC_D'],
  proposedBy: 'llm',
}

export const arcCellarPostEvidence: ArcRecord = {
  ...arcCellarPreEvidence,
  memberIds: [...arcCellarPreEvidence.memberIds, clawEvidence.id],
}

export const arcPantry: ArcRecord = {
  schemaVersion: 1,
  id: 'arc_pantry',
  label: 'the pantry shelf collapse',
  memberIds: [observationB_T2.id, observationC_T2.id, beliefC2.id],
  times: ['night_2'],
  participants: ['NPC_B', 'NPC_C'],
  proposedBy: 'llm',
}

export const arcGate: ArcRecord = {
  schemaVersion: 1,
  id: 'arc_gate',
  label: 'the gate patrol rotation change',
  memberIds: [observationA_T3.id, observationD_T3.id],
  times: ['night_2'],
  participants: ['NPC_A', 'NPC_D'],
  proposedBy: 'llm',
}

export const arcsPreEvidence: ArcRecord[] = [arcCellarPreEvidence, arcPantry, arcGate]
export const arcsPostEvidence: ArcRecord[] = [arcCellarPostEvidence, arcPantry, arcGate]

const extraHierarchyRecords: ReadableRecord[] = [
  { kind: 'truth', record: truthT2 },
  { kind: 'truth', record: truthT3 },
  { kind: 'observation', record: observationB_T2 },
  { kind: 'observation', record: observationC_T2 },
  { kind: 'belief', record: beliefC2 },
  { kind: 'observation', record: observationA_T3 },
  { kind: 'observation', record: observationD_T3 },
]

export const preEvidenceHierarchyRecords: ReadableRecord[] = [...preEvidenceRecords, ...extraHierarchyRecords]
export const postEvidenceHierarchyRecords: ReadableRecord[] = [...postEvidenceRecords, ...extraHierarchyRecords]
