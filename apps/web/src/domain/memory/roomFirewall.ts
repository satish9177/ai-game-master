import {
  MAX_ROOM_MEMORY_CHARS,
  RoomMemoryConfidenceSchema,
  RoomMemoryKindSchema,
  RoomMemorySourceSchema,
} from './roomContracts'
import type {
  RoomMemoryConfidence,
  RoomMemoryKind,
  RoomMemoryProvenance,
  RoomMemoryRecord,
  RoomMemoryScope,
  RoomMemorySource,
} from './roomContracts'

/**
 * The room memory firewall (room-memory-firewall-v0). Pure, total,
 * deterministic: no I/O, no `Date.now`/`Math.random`, no input mutation.
 * Standalone and parallel to the NPC firewall — it does not import or alter
 * `domain/memory/firewall.ts`. It validates and normalizes writes, re-filters
 * reads by exact scope (defense in depth behind the scoped query), and selects
 * a bounded, deterministically-ordered recall set.
 *
 * Structural truth separation: this module exports NO `WorldCommand`/
 * `WorldEvent`-producing function. There is no path from a room memory to
 * authoritative state.
 */

export const DEFAULT_ROOM_RECALL_LIMIT = 8
export const DEFAULT_ROOM_RECALL_MAX_CHARS = 600

const DEFAULT_CONFIDENCE: RoomMemoryConfidence = 'medium'

export type RoomMemoryDraftInput = {
  worldId: string
  sessionId: string
  roomId: string
  kind: RoomMemoryKind
  source: RoomMemorySource
  text: string
  confidence?: RoomMemoryConfidence // default 'medium'
  npcId?: string // which NPC formed/uttered the memory
  turnIndex?: number
}

export type RoomMemoryDraft = {
  scope: RoomMemoryScope
  kind: RoomMemoryKind
  text: string
  provenance: RoomMemoryProvenance
  confidence: RoomMemoryConfidence
}

export type RoomMemoryRejectReason =
  | 'invalid-scope'
  | 'invalid-kind'
  | 'invalid-source'
  | 'empty-text'
  | 'text-too-long'
  | 'invalid-confidence'
  | 'invalid-provenance'

export type ValidateRoomMemoryDraftResult =
  | { ok: true; draft: RoomMemoryDraft }
  | { ok: false; reason: RoomMemoryRejectReason }

/**
 * Write firewall: validate + normalize. Trims `text`, defaults `confidence` to
 * `'medium'`, and returns a draft WITHOUT `memoryId`/`seq`/`createdAt` — the
 * service stamps id/createdAt and the store assigns `seq`. Stamps nothing
 * authoritative.
 */
export function validateRoomMemoryDraft(
  input: RoomMemoryDraftInput,
): ValidateRoomMemoryDraftResult {
  const worldId = typeof input.worldId === 'string' ? input.worldId.trim() : ''
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
  const roomId = typeof input.roomId === 'string' ? input.roomId.trim() : ''
  if (worldId.length === 0 || sessionId.length === 0 || roomId.length === 0) {
    return reject('invalid-scope')
  }

  if (!RoomMemoryKindSchema.safeParse(input.kind).success) return reject('invalid-kind')
  if (!RoomMemorySourceSchema.safeParse(input.source).success) return reject('invalid-source')

  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (text.length === 0) return reject('empty-text')
  if (text.length > MAX_ROOM_MEMORY_CHARS) return reject('text-too-long')

  const confidence = input.confidence ?? DEFAULT_CONFIDENCE
  if (!RoomMemoryConfidenceSchema.safeParse(confidence).success) return reject('invalid-confidence')

  const provenance = validateProvenance(input)
  if (!provenance.ok) return reject('invalid-provenance')

  const draft: RoomMemoryDraft = {
    scope: { worldId, sessionId, roomId },
    kind: input.kind,
    text,
    provenance: { source: input.source, ...provenance.value },
    confidence,
  }
  return { ok: true, draft }
}

/**
 * Read firewall (defense in depth behind the scoped SQL query): drop any record
 * whose `(worldId, sessionId, roomId)` does not match the scope exactly. Pure:
 * a new array of the same record references; no mutation.
 */
export function filterRoomMemoriesForScope(
  records: readonly RoomMemoryRecord[],
  scope: RoomMemoryScope,
): RoomMemoryRecord[] {
  return records.filter(
    (record) =>
      record.worldId === scope.worldId &&
      record.sessionId === scope.sessionId &&
      record.roomId === scope.roomId,
  )
}

/**
 * Bounded deterministic recall selection — the ONLY ordering authority. Sorts
 * by `seq` desc, then `memoryId` ascending as a stable tie-break; takes up to
 * `limit`; caps cumulative `text.length` at `maxChars`. Never uses
 * `confidence`, never a clock/recency-by-time, never relevance scoring.
 */
export function selectRecallRoomMemories(
  records: readonly RoomMemoryRecord[],
  options: { limit: number; maxChars: number },
): RoomMemoryRecord[] {
  const limit = Math.max(0, Math.trunc(options.limit))
  const maxChars = Math.max(0, Math.trunc(options.maxChars))

  const ordered = [...records].sort(compareForRecall)

  const selected: RoomMemoryRecord[] = []
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
function compareForRecall(a: RoomMemoryRecord, b: RoomMemoryRecord): number {
  if (a.seq !== b.seq) return b.seq - a.seq
  if (a.memoryId < b.memoryId) return -1
  if (a.memoryId > b.memoryId) return 1
  return 0
}

function validateProvenance(
  input: RoomMemoryDraftInput,
): { ok: true; value: { npcId?: string; turnIndex?: number } } | { ok: false } {
  const value: { npcId?: string; turnIndex?: number } = {}
  if (input.npcId !== undefined) {
    if (typeof input.npcId !== 'string' || input.npcId.trim().length === 0) {
      return { ok: false }
    }
    value.npcId = input.npcId.trim()
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

function reject(reason: RoomMemoryRejectReason): ValidateRoomMemoryDraftResult {
  return { ok: false, reason }
}
