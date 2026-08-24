import { applyEvidenceCorrection, beliefFromObservation, beliefFromRumor } from '../domain/livingWorldProof/beliefUpdate'
import {
  BeliefSchema,
  EvidenceSchema,
  ObservationSchema,
  RumorTransmissionSchema,
  SceneEventSchema,
} from '../domain/livingWorldProof/contracts'
import type { Belief, Evidence, Observation, RumorTransmission, SceneEvent } from '../domain/livingWorldProof/contracts'
import type { QueryBounds } from '../domain/livingWorldProof/conflictContracts'
import type { ConflictStore } from '../domain/livingWorldProof/conflictStore'
import { commitBelief, initConflictStore } from '../domain/livingWorldProof/conflictStore'
import type { ReadableRecord } from '../domain/livingWorldProof/evidenceRecords'
import { computeObservations } from '../domain/livingWorldProof/observationScope'
import { clawEvidence, events, positions, rumorAToB, rumorBToC, topology } from '../domain/livingWorldProof/scenario'

/**
 * Belief-Driven NPC Dialogue Slice v0 (S1) -- the Three-NPC Rumor Drift
 * scenario as real spine records. Every record here is either a committed
 * fixture from `domain/livingWorldProof/scenario.ts` (T0/T1, R_A_to_B,
 * R_B_to_C, E_claw) or derived from those records by the already-proven
 * constructors (`computeObservations`, `beliefFromObservation`,
 * `beliefFromRumor`) -- nothing is hand-authored beyond the ids and the
 * bitemporal timing instants, mirroring `evidenceScenario.ts` /
 * `conflictScenario.ts`. Scoped to holders NPC_A/NPC_B/NPC_C only: NPC_D
 * (the full-sight cellar witness used by the proof fixtures) is excluded
 * because the dialogue slice tests a three-way rumor chain.
 *
 * Pure domain composition: no I/O, no LLM, no mutation of any spine file.
 */

export type SliceHolder = 'NPC_A' | 'NPC_B' | 'NPC_C'

/** The ground-truth attack event T1 (`zombie_17` attacked `guard_malik`, cellar, `night_3`). */
export const truthT1: SceneEvent = SceneEventSchema.parse(events.find((event) => event.id === 'T1'))

const allObservations: Observation[] = computeObservations(events, topology, positions)

function observationFor(observer: SliceHolder, truthRef: string): Observation {
  const found = allObservations.find((entry) => entry.observer === observer && entry.truthRef === truthRef)
  if (found === undefined) {
    throw new Error(`beliefSliceFixture: expected ${observer} observation of ${truthRef} -- fixture invariant broken`)
  }
  return ObservationSchema.parse(found)
}

/**
 * NPC_A's scoped observations: full sight of T0 only (player entered the
 * cellar through the doorway) and a partial sound-only read of T1 (a scream
 * near the cellar). A never perceived the attacker.
 */
export const observationAOfT0 = observationFor('NPC_A', 'T0')
export const observationAOfT1 = observationFor('NPC_A', 'T1')

/** NPC_C's own partial (muffled-sound) observation of T1; C also receives the B->C rumor. */
export const observationCOfT1 = observationFor('NPC_C', 'T1')

/** A's hedged inference from its partial T1 observation -- names no attacker. */
export const beliefA1: Belief = BeliefSchema.parse(beliefFromObservation(observationAOfT1, 'Bel_A1'))
/** B's belief in the rumor A told it -- more specific than A's, no more confident. */
export const beliefB1: Belief = BeliefSchema.parse(beliefFromRumor(rumorAToB, 'Bel_B1'))
/** C's belief in B's retelling -- names the player as attacker, still low confidence. */
export const beliefC1: Belief = BeliefSchema.parse(beliefFromRumor(rumorBToC, 'Bel_C1'))

export const rumorAToBSlice: RumorTransmission = RumorTransmissionSchema.parse(rumorAToB)
export const rumorBToCSlice: RumorTransmission = RumorTransmissionSchema.parse(rumorBToC)
export const clawMarkEvidence: Evidence = EvidenceSchema.parse(clawEvidence)

/** The record universe before the claw mark is presented to anyone. */
export function buildPreEvidenceUniverse(): ReadableRecord[] {
  return [
    { kind: 'truth', record: truthT1 },
    { kind: 'observation', record: observationAOfT0 },
    { kind: 'observation', record: observationAOfT1 },
    { kind: 'observation', record: observationCOfT1 },
    { kind: 'rumor', record: rumorAToBSlice },
    { kind: 'rumor', record: rumorBToCSlice },
    { kind: 'belief', record: beliefA1 },
    { kind: 'belief', record: beliefB1 },
    { kind: 'belief', record: beliefC1 },
  ]
}

/** The record universe after the claw mark is presented to NPC_C only. */
export function buildPostEvidenceUniverse(): ReadableRecord[] {
  return [...buildPreEvidenceUniverse(), { kind: 'evidence', record: clawMarkEvidence }]
}

// Bitemporal timing, consistent with conflictScenario.ts's committed map:
// each belief becomes valid when its source record exists in world time.
const BELIEF_VALID_FROM: Readonly<Record<string, { night: number; tick: number }>> = {
  Bel_A1: { night: 3, tick: 0 },
  Bel_B1: { night: 3, tick: 1 },
  Bel_C1: { night: 4, tick: 0 },
}

export interface ThreeNpcRumorDriftFixture {
  /** Pre-evidence universe (the state the S1 divergence gate projects). */
  universe: readonly ReadableRecord[]
  store: ConflictStore
  bounds: QueryBounds
  beliefsByHolder: Readonly<Record<SliceHolder, Belief>>
}

/** The corrected belief the spine's own evidence-correction path mints for C. */
export const correctedBeliefC: Belief = BeliefSchema.parse(
  (() => {
    const outcome = applyEvidenceCorrection(beliefC1, clawMarkEvidence, 'Bel_C1_post')
    if (outcome.status !== 'corrected') {
      throw new Error('beliefSliceFixture: E_claw must correct Bel_C1 -- fixture invariant broken')
    }
    return outcome.corrected
  })(),
)

export interface ThreeNpcPostCorrectionFixture extends ThreeNpcRumorDriftFixture {
  /** The claw mark, presented to C. */
  evidence: Evidence
  /** C's post-correction belief (zombie_17 attacked guard_malik, hard evidence, high). */
  correctedBelief: Belief
}

/**
 * The fixture advanced past the claw-mark presentation (S4.5 item 2): the
 * evidence is in C's granted set and C's correction -- minted by the spine's
 * own `applyEvidenceCorrection`, never hand-authored -- is committed at
 * night_4/tick_1. A and B hold nothing new: only C's projection changes.
 * The pre-correction accusation stays committed and therefore co-rendered
 * with its correction (D8 never-silently-inconsistent): this slice commits
 * no BeliefTransition, so no supersession hides the old line.
 */
export function buildThreeNpcPostCorrectionFixture(): ThreeNpcPostCorrectionFixture {
  const universe: ReadableRecord[] = [
    ...buildPreEvidenceUniverse(),
    { kind: 'evidence', record: clawMarkEvidence },
    { kind: 'belief', record: correctedBeliefC },
  ]

  let store = initConflictStore(new Map())
  for (const entry of universe) {
    if (entry.kind !== 'belief') continue
    const validFrom = entry.record.id === 'Bel_C1_post' ? { night: 4, tick: 1 } : BELIEF_VALID_FROM[entry.record.id]
    if (validFrom === undefined) {
      throw new Error(`beliefSliceFixture: missing validFrom for ${entry.record.id} -- fixture invariant broken`)
    }
    const committed = commitBelief(store, universe, entry.record.id, validFrom)
    if (committed.outcome.verdict !== 'committed') {
      throw new Error(`beliefSliceFixture: expected ${entry.record.id} to commit -- fixture invariant broken`)
    }
    store = committed.store
  }

  // Projection point: after the correction exists (night_4 tick 1). At these
  // bounds C projects both her accusation (open-ended) and its correction;
  // A and B project exactly what they projected before.
  const bounds: QueryBounds = { validT: { night: 4, tick: 1 }, txBound: store.nextSeq }

  return {
    universe,
    store,
    bounds,
    beliefsByHolder: { NPC_A: beliefA1, NPC_B: beliefB1, NPC_C: beliefC1 },
    evidence: clawMarkEvidence,
    correctedBelief: correctedBeliefC,
  }
}

/**
 * Builds the committed fixture by running the real spine operations in
 * order -- never hand-authoring store state. No claims are registered in
 * the conflict store: this slice mints no ConflictEdges and commits no
 * transitions (evidence correction belongs to a later slice), so the
 * projection's `unresolved` set is empty by construction.
 */
export function buildThreeNpcRumorDriftFixture(): ThreeNpcRumorDriftFixture {
  const universe = buildPreEvidenceUniverse()
  let store = initConflictStore(new Map())

  for (const entry of universe) {
    if (entry.kind !== 'belief') continue
    const validFrom = BELIEF_VALID_FROM[entry.record.id]
    if (validFrom === undefined) {
      throw new Error(`beliefSliceFixture: missing validFrom for ${entry.record.id} -- fixture invariant broken`)
    }
    const committed = commitBelief(store, universe, entry.record.id, validFrom)
    if (committed.outcome.verdict !== 'committed') {
      throw new Error(`beliefSliceFixture: expected ${entry.record.id} to commit -- fixture invariant broken`)
    }
    store = committed.store
  }

  // Projection point: after R_B_to_C arrived (night_4 tick 0) and before
  // any evidence presentation. txBound covers every commit made above.
  const bounds: QueryBounds = { validT: { night: 4, tick: 0 }, txBound: store.nextSeq }

  return {
    universe,
    store,
    bounds,
    beliefsByHolder: { NPC_A: beliefA1, NPC_B: beliefB1, NPC_C: beliefC1 },
  }
}
