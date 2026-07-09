import type { Belief, Evidence, Observation, RumorTransmission, SceneEvent } from './contracts'

/**
 * Bounded evidence recovery: who may recall what, and how exact records
 * are recovered on demand. Extends the observation-scope contract's
 * anti-leakage invariant from perception (who could observe) to recall
 * (who may later dereference). TruthEvents are categorically excluded from
 * every NPC's readable set -- truth reaches an NPC only as an Observation;
 * recall cannot bypass perception. No LLM, no I/O; the read gate
 * re-derives scope from the record universe on every call and never
 * trusts a caller-supplied index map.
 */

export type ReadableRecord =
  | { kind: 'truth'; record: SceneEvent }
  | { kind: 'observation'; record: Observation }
  | { kind: 'rumor'; record: RumorTransmission }
  | { kind: 'belief'; record: Belief }
  | { kind: 'evidence'; record: Evidence }

export function recordTime(entry: ReadableRecord): string {
  return entry.kind === 'belief' ? entry.record.lastUpdated : entry.record.time
}

/**
 * readable(npc) = delivered(npc) ∪ owned(npc) ∪ granted(npc): delivered =
 * Observations the npc observed + RumorTransmissions sent to them, owned =
 * Beliefs the npc holds, granted = Evidence presented to them. TruthEvents
 * are never in any npc's readable set.
 */
export function readable(npc: string, records: readonly ReadableRecord[]): ReadableRecord[] {
  return records.filter((entry) => {
    switch (entry.kind) {
      case 'truth':
        return false
      case 'observation':
        return entry.record.observer === npc
      case 'rumor':
        return entry.record.to === npc
      case 'belief':
        return entry.record.holder === npc
      case 'evidence':
        return entry.record.presentedTo === npc
    }
  })
}

export interface ReadEvidenceCall {
  reader: string
  recordId: string
  verdict: 'granted' | 'denied'
}

export type ReadEvidenceOutcome =
  | { verdict: 'granted'; record: ReadableRecord; call: ReadEvidenceCall }
  | { verdict: 'denied'; call: ReadEvidenceCall }

/**
 * Dereferences a single record by id, gated by `readable`. Every call --
 * granted or denied -- returns a typed, loggable ReadEvidenceCall. A
 * granted read returns a deep copy of the exact stored record (never an
 * alias the caller could mutate).
 */
export function readEvidence(
  npc: string,
  recordId: string,
  records: readonly ReadableRecord[],
): ReadEvidenceOutcome {
  const found = readable(npc, records).find((entry) => entry.record.id === recordId)
  const call: ReadEvidenceCall = { reader: npc, recordId, verdict: found === undefined ? 'denied' : 'granted' }

  if (found === undefined) {
    return { verdict: 'denied', call }
  }

  return { verdict: 'granted', record: structuredClone(found), call }
}
