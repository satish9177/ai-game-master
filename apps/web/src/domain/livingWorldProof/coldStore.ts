import { canonicalSerialize, mintHash } from './canonicalSerialization'
import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { ColdSegment, CompactionRecord, PageBackCall } from './compactionContracts'
import type { ReadableRecord, ReadEvidenceOutcome } from './evidenceRecords'
import { readEvidence } from './evidenceRecords'

/**
 * Residence layer for the Compaction Preservation Test v0 (ADR-0007 D2/D5,
 * spec §1.1/§2.1/§2.2). A CompactedStore never alters record identity or
 * bytes -- it only tracks where each record currently lives (hot map vs.
 * an append-only ColdSegment) and reconstructs the exact original record
 * universe on demand (`materialize`). All operations are pure: they
 * return a new store rather than mutating the one passed in. No LLM, no
 * I/O, no Date.now/Math.random/crypto.
 */

export type Residence = 'hot' | string // 'hot', or a segmentId

export interface CompactedStore {
  /** The original record universe, in its original order. Content here is never mutated -- only `residence` changes. */
  records: readonly ReadableRecord[]
  /** recordId -> 'hot' | segmentId. Every record in `records` has exactly one entry. */
  residence: ReadonlyMap<string, Residence>
  /** Append-only demoted-record store (spec §1.1). */
  segments: readonly ColdSegment[]
  /** Append-only log of committed and rejected compaction decisions (spec §1.2). Replay re-applies this, never a judge. */
  compactionLog: readonly CompactionRecord[]
}

export function initStore(records: readonly ReadableRecord[]): CompactedStore {
  return {
    records,
    residence: new Map(records.map((entry) => [entry.record.id, 'hot' as Residence])),
    segments: [],
    compactionLog: [],
  }
}

export type ResolveOutcome =
  | { verdict: 'hot'; record: ReadableRecord }
  | { verdict: 'paged-back'; record: ReadableRecord; segmentId: string }
  | { verdict: 'hash-mismatch'; segmentId: string }
  | { verdict: 'unknown-record' }

/**
 * Resolves a record by id regardless of residence, verifying the mint
 * hash on a cold page-back (spec §2.2). Never returns a substituted
 * record on a hash mismatch -- a typed fault instead (F4).
 */
export function resolveRecord(store: CompactedStore, recordId: string): ResolveOutcome {
  const residenceState = store.residence.get(recordId)
  if (residenceState === undefined) {
    return { verdict: 'unknown-record' }
  }

  if (residenceState === 'hot') {
    const entry = store.records.find((candidate) => candidate.record.id === recordId)
    if (entry === undefined) {
      return { verdict: 'unknown-record' }
    }
    return { verdict: 'hot', record: structuredClone(entry) }
  }

  const segmentId = residenceState
  const segment = store.segments.find((candidate) => candidate.segmentId === segmentId)
  if (segment === undefined) {
    throw new Error(`resolveRecord: residence points at missing segment ${segmentId}`)
  }

  const computedHash = mintHash(segment.canonicalBytes)
  if (computedHash !== segment.mintHash) {
    return { verdict: 'hash-mismatch', segmentId }
  }

  return { verdict: 'paged-back', record: JSON.parse(segment.canonicalBytes) as ReadableRecord, segmentId }
}

/**
 * Moves each record's residence from hot to a fresh ColdSegment (spec
 * §2.1). Record ids and bytes are unchanged -- only residence moves.
 * Demoting an already-cold record is a no-op (idempotent). Throws only on
 * a programmer error (an id outside the record universe); callers are
 * expected to validate membership through the gates before calling this.
 */
export function demote(store: CompactedStore, recordIds: readonly string[]): CompactedStore {
  let segments = store.segments
  const residence = new Map(store.residence)

  for (const recordId of recordIds) {
    const currentResidence = residence.get(recordId)
    if (currentResidence === undefined) {
      throw new Error(`demote: unknown record ${recordId}`)
    }
    if (currentResidence !== 'hot') {
      continue
    }

    const entry = store.records.find((candidate) => candidate.record.id === recordId)
    if (entry === undefined) {
      throw new Error(`demote: unknown record ${recordId}`)
    }

    const canonicalBytes = canonicalSerialize(entry)
    const segment: ColdSegment = {
      schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
      segmentId: `seg_${String(segments.length + 1).padStart(4, '0')}`,
      recordId,
      canonicalBytes,
      mintHash: mintHash(canonicalBytes),
    }
    segments = [...segments, segment]
    residence.set(recordId, segment.segmentId)
  }

  return { ...store, segments, residence }
}

/** Appends one CompactionRecord to the store's log (committed or rejected). */
export function appendCompactionRecord(store: CompactedStore, record: CompactionRecord): CompactedStore {
  return { ...store, compactionLog: [...store.compactionLog, record] }
}

/**
 * Reconstructs the original ordered readable-record universe exactly,
 * resolving every record through its current residence (spec §2.6/§2.7:
 * residence and routes change, identity, order, and bytes never do).
 * Throws on an internal hash-mismatch -- materialize assumes a
 * consistent store; the F4 fault is exercised through resolveRecord /
 * readEvidenceTiered directly, on a deliberately corrupted single segment.
 */
export function materialize(store: CompactedStore): ReadableRecord[] {
  return store.records.map((entry) => {
    const resolved = resolveRecord(store, entry.record.id)
    if (resolved.verdict === 'hot' || resolved.verdict === 'paged-back') {
      return resolved.record
    }
    throw new Error(`materialize: cannot reconstruct ${entry.record.id} (${resolved.verdict})`)
  })
}

/** Test-only: corrupts one cold segment's bytes without touching its mint hash, to exercise F4. */
export function withCorruptedSegment(store: CompactedStore, recordId: string, corruptedBytes: string): CompactedStore {
  const segments = store.segments.map((segment) => (segment.recordId === recordId ? { ...segment, canonicalBytes: corruptedBytes } : segment))
  return { ...store, segments }
}

export type ReadEvidenceTieredOutcome = ReadEvidenceOutcome | { verdict: 'hash-mismatch'; call: PageBackCall }

/**
 * Tier-transparent ReadEvidence (ADR-0007 D5, spec §2.2): resolves
 * residence first, then delegates the scope/permission decision to the
 * committed, unchanged `readEvidence`. Because `readable()`'s filter
 * predicates are per-record (never cross-referential), delegating over a
 * one-record view is behaviorally identical to delegating over the full
 * universe for this id, and avoids letting an unrelated corrupted segment
 * fail an otherwise-healthy read. No NPC-visible field ever carries
 * residence (P8): the granted/denied shapes are exactly `readEvidence`'s.
 */
export function readEvidenceTiered(npc: string, recordId: string, store: CompactedStore): ReadEvidenceTieredOutcome {
  const resolved = resolveRecord(store, recordId)

  if (resolved.verdict === 'hash-mismatch') {
    const call: PageBackCall = { reader: npc, recordId, segmentId: resolved.segmentId, verdict: 'hash-mismatch' }
    return { verdict: 'hash-mismatch', call }
  }

  const view: ReadableRecord[] = resolved.verdict === 'unknown-record' ? [] : [resolved.record]
  return readEvidence(npc, recordId, view)
}
