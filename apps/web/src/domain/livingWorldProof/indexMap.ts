import type { ReadableRecord } from './evidenceRecords'
import { readable, recordTime } from './evidenceRecords'

/**
 * Per-NPC index map: the compact catalog an NPC's bounded context carries
 * instead of raw records. Descriptions are engine-templated renderings of
 * typed fields -- deterministic and regenerable, never LLM-authored -- so
 * a corrupted description is always mechanically detectable
 * (validateIndexMap), closing the "lying card catalog" failure mode.
 */

export interface IndexMapEntry {
  holder: string
  recordId: string
  recordType: Exclude<ReadableRecord['kind'], 'truth'>
  description: string
  time: string
}

function describeRecord(entry: ReadableRecord): string {
  switch (entry.kind) {
    case 'observation':
      return `perceived ${entry.record.channels.join('+')} of ${entry.record.truthRef} at ${entry.record.time} (fidelity: ${entry.record.fidelity})`
    case 'rumor':
      return `retelling received from ${entry.record.from}, ${entry.record.time}: '${entry.record.proposition}'`
    case 'belief':
      return `belief held since ${entry.record.lastUpdated}: '${entry.record.proposition}' (confidence: ${entry.record.confidence})`
    case 'evidence':
      return `evidence presented ${entry.record.time}: implies '${entry.record.implies}'`
    case 'truth':
      // readable() structurally excludes 'truth'; reaching this is a
      // programmer error, not an expected runtime condition.
      throw new Error('TruthEvents are never indexed')
  }
}

export function buildIndexMap(npc: string, records: readonly ReadableRecord[]): IndexMapEntry[] {
  return readable(npc, records).map((entry) => ({
    holder: npc,
    recordId: entry.record.id,
    recordType: entry.kind as Exclude<ReadableRecord['kind'], 'truth'>,
    description: describeRecord(entry),
    time: recordTime(entry),
  }))
}

export interface IndexDescriptionIssue {
  recordId: string
  expected: string
  actual: string
}

/**
 * Recomputes the canonical (engine-templated) description for every entry
 * in `indexMap` and flags a mismatch. Split index authorship means an
 * index description is never free text, so a wrong one is always
 * detectable, never merely trusted.
 */
export function validateIndexMap(
  npc: string,
  indexMap: readonly IndexMapEntry[],
  records: readonly ReadableRecord[],
): IndexDescriptionIssue[] {
  const canonical = new Map(buildIndexMap(npc, records).map((entry) => [entry.recordId, entry.description]))
  const issues: IndexDescriptionIssue[] = []

  for (const entry of indexMap) {
    const expected = canonical.get(entry.recordId)
    if (expected !== undefined && expected !== entry.description) {
      issues.push({ recordId: entry.recordId, expected, actual: entry.description })
    }
  }

  return issues
}
