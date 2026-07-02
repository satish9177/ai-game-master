import { z } from 'zod'
import { RoomMemoryRecordSchema } from './roomContracts'
import type { RoomMemoryRecord } from './roomContracts'
import { hasRoomMemoryControlCharacters } from './roomFirewall'

/**
 * Pure save-state helpers for the runtime room-memory persistence sidecar
 * (runtime-room-memory-persistence-v0, Slice 3). This module is domain-pure: it
 * imports only `zod` and sibling `domain/memory` contracts/firewall. It exports
 * NO `WorldCommand`/`WorldEvent`-producing function — a parked room-memory blob
 * can never become authoritative truth.
 *
 * The blob is non-authoritative byte parking (localStorage sidecar), mirroring
 * the ADR-0059/0060 `generatedQuestJson`/`generatedRoomCacheJson` pattern: a
 * versioned envelope, strict per-record re-validation, deterministic caps, and
 * fixed reason codes. No memory text is ever logged; helpers return only records
 * plus safe counts.
 */

export const ROOM_MEMORY_SAVE_SCHEMA_VERSION = 1 as const

/** Newest-per-room cap; mirrors `DEFAULT_ROOM_RECALL_LIMIT`. */
export const ROOM_MEMORY_SAVE_MAX_PER_ROOM = 8
/** Hard total cap across all rooms in one saved session. */
export const ROOM_MEMORY_SAVE_MAX_TOTAL = 128

export const RoomMemorySaveStateSchema = z
  .object({
    schemaVersion: z.literal(ROOM_MEMORY_SAVE_SCHEMA_VERSION),
    records: z.array(RoomMemoryRecordSchema).min(1).max(ROOM_MEMORY_SAVE_MAX_TOTAL),
  })
  .strict()

export type RoomMemorySaveState = z.infer<typeof RoomMemorySaveStateSchema>

export const RoomMemorySaveStateVersionEnvelopeSchema = z
  .object({ schemaVersion: z.number().int() })
  .passthrough()

export type RoomMemorySaveLoadCode = 'invalid-json' | 'unsupported-version' | 'invalid-schema'

export type LoadRoomMemorySaveStateResult =
  | { ok: true; state: RoomMemorySaveState }
  | { ok: false; code: RoomMemorySaveLoadCode }

/** Optional scope filter. When a field is provided, non-matching records drop. */
export type RoomMemorySaveScope = { worldId?: string; sessionId?: string }

/** Restore result: surviving records plus safe, reason-coded drop counts only. */
export type RestorableRoomMemoriesResult = {
  records: RoomMemoryRecord[]
  keptCount: number
  droppedCount: number
  droppedByScope: number
  droppedBySource: number
  droppedByText: number
  droppedByCap: number
}

/**
 * Build a strict, bounded save-state from a snapshot of runtime records.
 *
 * Applies (in order): optional scope filter → drop any line-unsafe record
 * (control/newline text is never saved) → deterministic per-room + total caps →
 * strict envelope validation. Returns `null` when nothing survives (empty
 * session), so the caller can simply omit the sidecar key.
 */
export function buildRoomMemorySaveState(
  records: readonly RoomMemoryRecord[],
  scope?: RoomMemorySaveScope,
): RoomMemorySaveState | null {
  const scoped = records.filter((record) => matchesScope(record, scope))
  const lineSafe = scoped.filter((record) => !hasRoomMemoryControlCharacters(record.text))
  const capped = capRoomMemories(lineSafe)
  if (capped.length === 0) return null

  const candidate = { schemaVersion: ROOM_MEMORY_SAVE_SCHEMA_VERSION, records: capped }
  const parsed = RoomMemorySaveStateSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/**
 * Convenience wrapper: `buildRoomMemorySaveState` then `JSON.stringify`. Returns
 * the JSON string to park as `roomMemoryJson`, or `null` when there is nothing
 * to save.
 */
export function buildRoomMemorySaveJson(
  records: readonly RoomMemoryRecord[],
  scope?: RoomMemorySaveScope,
): string | null {
  const state = buildRoomMemorySaveState(records, scope)
  return state === null ? null : JSON.stringify(state)
}

/**
 * Parse + strictly validate a parked `roomMemoryJson` blob. Mirrors the
 * `generatedQuestSaveState` envelope pattern exactly. Fixed reason codes only;
 * never echoes blob content.
 */
export function loadRoomMemorySaveState(json: string): LoadRoomMemorySaveStateResult {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(json)
  } catch {
    return { ok: false, code: 'invalid-json' }
  }

  const envelope = RoomMemorySaveStateVersionEnvelopeSchema.safeParse(parsedJson)
  if (!envelope.success) return { ok: false, code: 'invalid-schema' }
  if (envelope.data.schemaVersion !== ROOM_MEMORY_SAVE_SCHEMA_VERSION) {
    return { ok: false, code: 'unsupported-version' }
  }

  const state = RoomMemorySaveStateSchema.safeParse(parsedJson)
  if (!state.success) return { ok: false, code: 'invalid-schema' }

  return { ok: true, state: state.data }
}

/**
 * Restore filter over already schema-validated records (the output of
 * `loadRoomMemorySaveState`). DROPS — never normalizes — records with:
 * `worldId`/`sessionId` scope mismatch, `provenance.source === 'llm'`, or text
 * still carrying control/newline characters (defense in depth against a tampered
 * sidecar). Then applies the same deterministic caps as save. `roomId` is
 * deliberately NOT cross-checked against loaded rooms. Returns surviving records
 * plus safe drop counts; no memory text.
 */
export function filterRestorableRoomMemories(
  records: readonly RoomMemoryRecord[],
  scope: RoomMemorySaveScope,
): RestorableRoomMemoriesResult {
  let droppedByScope = 0
  let droppedBySource = 0
  let droppedByText = 0
  const survivors: RoomMemoryRecord[] = []

  for (const record of records) {
    if (!matchesScope(record, scope)) {
      droppedByScope += 1
      continue
    }
    if (record.provenance.source === 'llm') {
      droppedBySource += 1
      continue
    }
    if (hasRoomMemoryControlCharacters(record.text)) {
      droppedByText += 1
      continue
    }
    survivors.push(record)
  }

  const capped = capRoomMemories(survivors)
  const droppedByCap = survivors.length - capped.length

  return {
    records: capped,
    keptCount: capped.length,
    droppedCount: records.length - capped.length,
    droppedByScope,
    droppedBySource,
    droppedByText,
    droppedByCap,
  }
}

function matchesScope(record: RoomMemoryRecord, scope?: RoomMemorySaveScope): boolean {
  if (scope?.worldId !== undefined && record.worldId !== scope.worldId) return false
  if (scope?.sessionId !== undefined && record.sessionId !== scope.sessionId) return false
  return true
}

/**
 * Deterministic caps. Per room: keep the newest `ROOM_MEMORY_SAVE_MAX_PER_ROOM`
 * by `seq` desc (`memoryId` asc tie-break). If the total still exceeds
 * `ROOM_MEMORY_SAVE_MAX_TOTAL`, drop whole-room groups by the group's oldest
 * `createdAt` (then `roomId` asc) until under the cap. Final order is stable:
 * `roomId` asc, then `seq` asc, then `memoryId` asc.
 */
function capRoomMemories(records: readonly RoomMemoryRecord[]): RoomMemoryRecord[] {
  const groups = new Map<string, RoomMemoryRecord[]>()
  for (const record of records) {
    const group = groups.get(record.roomId)
    if (group !== undefined) group.push(record)
    else groups.set(record.roomId, [record])
  }

  const capped = new Map<string, RoomMemoryRecord[]>()
  for (const [roomId, group] of groups) {
    const newestFirst = [...group].sort(compareNewestFirst)
    capped.set(roomId, newestFirst.slice(0, ROOM_MEMORY_SAVE_MAX_PER_ROOM))
  }

  let total = 0
  for (const group of capped.values()) total += group.length

  if (total > ROOM_MEMORY_SAVE_MAX_TOTAL) {
    const oldestRoomsFirst = [...capped.keys()].sort((a, b) => {
      const keyA = groupOldestCreatedAt(capped.get(a) ?? [])
      const keyB = groupOldestCreatedAt(capped.get(b) ?? [])
      if (keyA !== keyB) return keyA < keyB ? -1 : 1
      return compareStrings(a, b)
    })
    for (const roomId of oldestRoomsFirst) {
      if (total <= ROOM_MEMORY_SAVE_MAX_TOTAL) break
      total -= (capped.get(roomId) ?? []).length
      capped.delete(roomId)
    }
  }

  const result: RoomMemoryRecord[] = []
  for (const roomId of [...capped.keys()].sort(compareStrings)) {
    const group = [...(capped.get(roomId) ?? [])].sort(compareOldestFirst)
    result.push(...group)
  }
  return result
}

function groupOldestCreatedAt(group: readonly RoomMemoryRecord[]): string {
  let oldest = ''
  for (const record of group) {
    if (oldest === '' || record.createdAt < oldest) oldest = record.createdAt
  }
  return oldest
}

function compareNewestFirst(a: RoomMemoryRecord, b: RoomMemoryRecord): number {
  if (a.seq !== b.seq) return b.seq - a.seq
  return compareStrings(a.memoryId, b.memoryId)
}

function compareOldestFirst(a: RoomMemoryRecord, b: RoomMemoryRecord): number {
  if (a.seq !== b.seq) return a.seq - b.seq
  return compareStrings(a.memoryId, b.memoryId)
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}
