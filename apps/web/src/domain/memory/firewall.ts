import {
  MAX_MEMORY_CHARS,
  MemoryConfidenceSchema,
  MemoryKindSchema,
  MemorySourceSchema,
} from './contracts'
import type {
  MemoryConfidence,
  MemoryKind,
  MemoryProvenance,
  MemoryScope,
  MemorySource,
  NpcMemoryRecord,
} from './contracts'

/**
 * The memory firewall (memory-firewall-v0). Pure, total, deterministic: no I/O,
 * no `Date.now`/`Math.random`, no input mutation. It validates and normalizes
 * writes, re-filters reads by exact scope (defense in depth behind the scoped
 * query), and selects a bounded, deterministically-ordered recall set.
 *
 * Structural truth separation: this module exports NO `WorldCommand`/`WorldEvent`
 * -producing function. There is no path from a memory to authoritative state.
 */

export const DEFAULT_RECALL_LIMIT = 8
export const DEFAULT_RECALL_MAX_CHARS = 600

const DEFAULT_CONFIDENCE: MemoryConfidence = 'medium'

export type MemoryDraftInput = {
  worldId: string
  sessionId: string
  npcId: string
  kind: MemoryKind
  source: MemorySource
  text: string
  confidence?: MemoryConfidence // default 'medium'
  roomId?: string
  turnIndex?: number
}

export type MemoryDraft = {
  scope: MemoryScope
  kind: MemoryKind
  text: string
  provenance: MemoryProvenance
  confidence: MemoryConfidence
}

export type MemoryRejectReason =
  | 'invalid-scope'
  | 'invalid-kind'
  | 'invalid-source'
  | 'empty-text'
  | 'text-too-long'
  | 'invalid-confidence'
  | 'invalid-provenance'

export type ValidateMemoryDraftResult =
  | { ok: true; draft: MemoryDraft }
  | { ok: false; reason: MemoryRejectReason }

/**
 * Write firewall: validate + normalize. Trims `text`, defaults `confidence` to
 * `'medium'`, and returns a draft WITHOUT `memoryId`/`seq`/`createdAt` — the
 * service stamps id/createdAt and the store assigns `seq`. Stamps nothing
 * authoritative.
 */
export function validateMemoryDraft(input: MemoryDraftInput): ValidateMemoryDraftResult {
  const worldId = typeof input.worldId === 'string' ? input.worldId.trim() : ''
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
  const npcId = typeof input.npcId === 'string' ? input.npcId.trim() : ''
  if (worldId.length === 0 || sessionId.length === 0 || npcId.length === 0) {
    return reject('invalid-scope')
  }

  if (!MemoryKindSchema.safeParse(input.kind).success) return reject('invalid-kind')
  if (!MemorySourceSchema.safeParse(input.source).success) return reject('invalid-source')

  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (text.length === 0) return reject('empty-text')
  if (text.length > MAX_MEMORY_CHARS) return reject('text-too-long')

  const confidence = input.confidence ?? DEFAULT_CONFIDENCE
  if (!MemoryConfidenceSchema.safeParse(confidence).success) return reject('invalid-confidence')

  const provenance = validateProvenance(input)
  if (!provenance.ok) return reject('invalid-provenance')

  const draft: MemoryDraft = {
    scope: { worldId, sessionId, npcId },
    kind: input.kind,
    text,
    provenance: { source: input.source, ...provenance.value },
    confidence,
  }
  return { ok: true, draft }
}

/**
 * Read firewall (defense in depth behind the scoped SQL query): drop any record
 * whose `(worldId, sessionId, npcId)` does not match the scope exactly. Pure: a
 * new array of the same record references; no mutation.
 */
export function filterMemoriesForScope(
  records: readonly NpcMemoryRecord[],
  scope: MemoryScope,
): NpcMemoryRecord[] {
  return records.filter(
    (record) =>
      record.worldId === scope.worldId &&
      record.sessionId === scope.sessionId &&
      record.npcId === scope.npcId,
  )
}

/**
 * Bounded deterministic recall selection — the ONLY ordering authority. Sorts by
 * `seq` desc, then `memoryId` ascending as a stable tie-break; takes up to
 * `limit`; caps cumulative `text.length` at `maxChars`. Never uses `confidence`,
 * never a clock/recency-by-time, never relevance scoring.
 */
export function selectRecallMemories(
  records: readonly NpcMemoryRecord[],
  options: { limit: number; maxChars: number },
): NpcMemoryRecord[] {
  const limit = Math.max(0, Math.trunc(options.limit))
  const maxChars = Math.max(0, Math.trunc(options.maxChars))

  const ordered = [...records].sort(compareForRecall)

  const selected: NpcMemoryRecord[] = []
  let usedChars = 0
  for (const record of ordered) {
    if (selected.length >= limit) break
    const nextChars = usedChars + record.text.length
    if (nextChars > maxChars) break
    selected.push(record)
    usedChars = nextChars
  }
  return selected
}

/** `seq` desc, then `memoryId` ascending. Confidence never participates. */
function compareForRecall(a: NpcMemoryRecord, b: NpcMemoryRecord): number {
  if (a.seq !== b.seq) return b.seq - a.seq
  if (a.memoryId < b.memoryId) return -1
  if (a.memoryId > b.memoryId) return 1
  return 0
}

function validateProvenance(
  input: MemoryDraftInput,
): { ok: true; value: { roomId?: string; turnIndex?: number } } | { ok: false } {
  const value: { roomId?: string; turnIndex?: number } = {}
  if (input.roomId !== undefined) {
    if (typeof input.roomId !== 'string' || input.roomId.trim().length === 0) {
      return { ok: false }
    }
    value.roomId = input.roomId.trim()
  }
  if (input.turnIndex !== undefined) {
    if (
      typeof input.turnIndex !== 'number' ||
      !Number.isInteger(input.turnIndex) ||
      input.turnIndex < 0
    ) {
      return { ok: false }
    }
    value.turnIndex = input.turnIndex
  }
  return { ok: true, value }
}

function reject(reason: MemoryRejectReason): ValidateMemoryDraftResult {
  return { ok: false, reason }
}
