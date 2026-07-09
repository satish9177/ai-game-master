import { beliefFromObservation, beliefFromRumor } from './beliefUpdate'
import type { ReadableRecord } from './evidenceRecords'
import { computeObservations } from './observationScope'
import { clawEvidence, events, positions, rumorAToB, rumorBToC, topology } from './scenario'

/**
 * Builds the bounded-evidence-recovery record universe on top of the
 * committed cellar scenario and the already-proven observation-scope +
 * belief-update pipeline. Two stages, matching the pre/post-evidence
 * challenge: `preEvidenceRecords` is exactly what exists before E_claw is
 * presented; `postEvidenceRecords` adds only E_claw to that set.
 */

const truthT0 = events.find((event) => event.id === 'T0')!
const truthT1 = events.find((event) => event.id === 'T1')!

export const observations = computeObservations(events, topology, positions)

function observationFor(observer: string, truthRef: string) {
  return observations.find((o) => o.observer === observer && o.truthRef === truthRef)!
}

export const beliefA1 = beliefFromObservation(observationFor('NPC_A', 'T1'), 'Bel_A1')
export const beliefD1 = beliefFromObservation(observationFor('NPC_D', 'T1'), 'Bel_D1')
export const beliefC1 = beliefFromRumor(rumorBToC, 'Bel_C1')

export const preEvidenceRecords: ReadableRecord[] = [
  { kind: 'truth', record: truthT0 },
  { kind: 'truth', record: truthT1 },
  ...observations.map((record) => ({ kind: 'observation' as const, record })),
  { kind: 'rumor', record: rumorAToB },
  { kind: 'rumor', record: rumorBToC },
  { kind: 'belief', record: beliefA1 },
  { kind: 'belief', record: beliefD1 },
  { kind: 'belief', record: beliefC1 },
]

export const postEvidenceRecords: ReadableRecord[] = [...preEvidenceRecords, { kind: 'evidence', record: clawEvidence }]
