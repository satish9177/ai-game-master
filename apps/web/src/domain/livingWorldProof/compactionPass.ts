import { canonicalSerialize } from './canonicalSerialization'
import { appendCompactionRecord, demote, initStore } from './coldStore'
import type { CompactedStore } from './coldStore'
import { derivePinSet, evaluateProposal } from './compactionGates'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type {
  BudgetPressureAlarm,
  CompactionPassResult,
  CompactionProposal,
  CompactionRecord,
  CompactionRejectReason,
  ContradictionEdge,
  ProofConsequenceRecord,
} from './compactionContracts'
import type { ReadableRecord } from './evidenceRecords'
import type { ArcRecord } from './hierarchyContracts'

/**
 * The deterministic compaction pass (ADR-0007, spec compaction-
 * preservation-test.md §2/§3): runs the given proposals through the pin
 * set and gates, splitting a cross-scope demote proposal into admissible
 * per-scope pieces and pin-filtering pinned members out before the
 * remaining group reaches `evaluateProposal`, then enforces the hot-tier
 * budget. `evaluateProposal` itself never sees the raw multi-scope
 * proposal committed -- this function performs the split first, so it is
 * this orchestration (not the gate) that "shapes the pass" (spec §3).
 * Never demotes or force-demotes to meet budget (D10): if the budget
 * cannot be met after processing every given proposal, it emits an
 * alarm and stops.
 */

function scopeOwnerOf(entry: ReadableRecord): string | undefined {
  switch (entry.kind) {
    case 'truth':
      return undefined
    case 'observation':
      return entry.record.observer
    case 'rumor':
      return entry.record.to
    case 'belief':
      return entry.record.holder
    case 'evidence':
      return entry.record.presentedTo
  }
}

function groupByScope(memberIds: readonly string[], byId: ReadonlyMap<string, ReadableRecord>): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const id of memberIds) {
    const entry = byId.get(id)
    const scopeKey = entry === undefined ? '__unknown__' : (scopeOwnerOf(entry) ?? '__unscopeable__')
    const group = groups.get(scopeKey) ?? []
    group.push(id)
    groups.set(scopeKey, group)
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

function processDemoteProposal(
  proposal: CompactionProposal,
  universe: readonly ReadableRecord[],
  arcs: readonly ArcRecord[],
  edges: readonly ContradictionEdge[],
  pinSet: ReadonlySet<string>,
  byId: ReadonlyMap<string, ReadableRecord>,
): { records: CompactionRecord[]; toDemote: string[] } {
  const records: CompactionRecord[] = []
  const toDemote: string[] = []
  const scopeGroups = groupByScope(proposal.memberIds, byId)

  let sequence = 0
  for (const [, groupMemberIds] of scopeGroups) {
    sequence += 1
    const pinned = groupMemberIds.filter((id) => pinSet.has(id))
    const nonPinned = groupMemberIds.filter((id) => !pinSet.has(id))

    if (pinned.length > 0) {
      const pinProposal: CompactionProposal = {
        schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
        id: `${proposal.id}_pin_${sequence}`,
        action: 'pin',
        memberIds: pinned,
        rationale: proposal.rationale,
        proposedBy: 'engine',
      }
      records.push(evaluateProposal(pinProposal, universe, edges, pinSet, arcs))
    }

    if (nonPinned.length > 0) {
      const demoteProposal: CompactionProposal = {
        schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
        id: `${proposal.id}_${sequence}`,
        action: 'demote',
        memberIds: nonPinned,
        rationale: proposal.rationale,
        proposedBy: proposal.proposedBy,
      }
      const record = evaluateProposal(demoteProposal, universe, edges, pinSet, arcs)
      records.push(record)
      if (record.verdict === 'committed') {
        toDemote.push(...nonPinned)
      }
    }
  }

  return { records, toDemote }
}

export function runCompactionPass(
  universe: readonly ReadableRecord[],
  arcs: readonly ArcRecord[],
  edges: readonly ContradictionEdge[],
  consequences: readonly ProofConsequenceRecord[],
  proposals: readonly CompactionProposal[],
  budget: number,
): { store: CompactedStore; result: CompactionPassResult } {
  const pinSet = derivePinSet(universe, arcs, edges, consequences)
  const byId = new Map(universe.map((entry) => [entry.record.id, entry]))

  let store = initStore(universe)

  for (const proposal of proposals) {
    if (proposal.action !== 'demote') {
      const record = evaluateProposal(proposal, universe, edges, pinSet, arcs)
      store = appendCompactionRecord(store, record)
      continue
    }

    const { records, toDemote } = processDemoteProposal(proposal, universe, arcs, edges, pinSet, byId)
    for (const record of records) {
      store = appendCompactionRecord(store, record)
    }
    if (toDemote.length > 0) {
      store = demote(store, toDemote)
    }
  }

  const hotSize = store.records
    .filter((entry) => store.residence.get(entry.record.id) === 'hot')
    .reduce((sum, entry) => sum + canonicalSerialize(entry).length, 0)

  const alarm = hotSize > budget ? buildAlarm(budget, hotSize, store.compactionLog) : undefined

  return { store, result: { compactionLog: store.compactionLog, hotSize, budget, alarm } }
}

function buildAlarm(budget: number, hotSize: number, compactionLog: readonly CompactionRecord[]): BudgetPressureAlarm {
  const blockedBy = new Set<CompactionRejectReason>()
  for (const record of compactionLog) {
    if (record.verdict === 'rejected' && record.rejectReason !== undefined) {
      blockedBy.add(record.rejectReason)
    }
    if (record.action === 'pin') {
      blockedBy.add('pinned-member')
    }
  }
  return { budget, hotSize, blockedBy: [...blockedBy].sort() }
}

/**
 * Replays committed CompactionRecords onto the base record universe
 * (spec §1.2 replay rule / P7): re-applies each committed `demote`
 * decision in log order, never re-evaluating a gate or judge. Two
 * replays from the same records + log produce byte-identical residence
 * and segments -- this function takes only the committed log as input,
 * so it is structurally incapable of re-judging.
 */
export function replayCompaction(baseRecords: readonly ReadableRecord[], compactionLog: readonly CompactionRecord[]): CompactedStore {
  let store = initStore(baseRecords)
  for (const record of compactionLog) {
    store = appendCompactionRecord(store, record)
    if (record.verdict === 'committed' && record.action === 'demote') {
      store = demote(store, record.memberIds)
    }
  }
  return store
}
