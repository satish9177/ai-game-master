import { RoomMemoryRecordSchema } from '../domain/memory/roomContracts'
import type { RoomMemoryInsert, RoomMemoryRecord, RoomMemoryScope } from '../domain/memory/roomContracts'
import type { RoomMemoryStore, RoomMemoryWriteResult } from '../domain/ports/RoomMemoryStore'

/**
 * Pure in-memory `RoomMemoryStore` adapter (mirrors `InMemoryNpcMemoryStore`).
 * It assigns `seq = max(seq for (sessionId, roomId)) + 1`, stores immutable
 * copies, and returns freshly-copied, scope-filtered, seq-desc, limited
 * records so no caller can alias internal state. It does NOT enforce the
 * session FK — `session-not-found` is exercised against the SQLite adapter —
 * so `record` here never returns a failure. Silent: it never logs (the service
 * is the only logger).
 *
 * `snapshotAll`/`restoreAll` are adapter-only helpers beyond the
 * `RoomMemoryStore` port, added for future App save/load wiring
 * (runtime-room-memory-persistence-v0, Slice 4). Nothing wires them yet.
 */
export class InMemoryRoomMemoryStore implements RoomMemoryStore {
  private readonly records: RoomMemoryRecord[] = []

  async record(input: RoomMemoryInsert): Promise<RoomMemoryWriteResult> {
    if (input.dedupeKey !== undefined) {
      const existing = this.findByDedupeKey(input.sessionId, input.roomId, input.dedupeKey)
      if (existing !== undefined) return { ok: true, record: clone(existing), deduplicated: true }
    }

    const seq = this.nextSeq(input.sessionId, input.roomId)
    const record: RoomMemoryRecord = clone({ ...input, seq })
    this.records.push(record)
    return { ok: true, record: clone(record) }
  }

  async listForRoom(
    scope: RoomMemoryScope,
    options?: { limit?: number },
  ): Promise<RoomMemoryRecord[]> {
    const matched = this.records
      .filter(
        (record) =>
          record.worldId === scope.worldId &&
          record.sessionId === scope.sessionId &&
          record.roomId === scope.roomId,
      )
      .sort((a, b) => (a.seq !== b.seq ? b.seq - a.seq : compareIds(a.memoryId, b.memoryId)))

    const limited =
      options?.limit !== undefined ? matched.slice(0, Math.max(0, options.limit)) : matched
    return limited.map((record) => clone(record))
  }

  private findByDedupeKey(
    sessionId: string,
    roomId: string,
    dedupeKey: string,
  ): RoomMemoryRecord | undefined {
    return this.records.find(
      (record) =>
        record.sessionId === sessionId && record.roomId === roomId && record.dedupeKey === dedupeKey,
    )
  }

  private nextSeq(sessionId: string, roomId: string): number {
    let max = 0
    for (const record of this.records) {
      if (record.sessionId === sessionId && record.roomId === roomId && record.seq > max) {
        max = record.seq
      }
    }
    return max + 1
  }

  /**
   * Adapter-only helper (not on the `RoomMemoryStore` port): every record
   * currently held, in deterministic order (`worldId`, `sessionId`, `roomId`,
   * `seq` asc, `memoryId` tie-break) regardless of insertion/restore order.
   * Returns clones, so the caller cannot mutate internal state through the
   * result. For future App save/load wiring
   * (runtime-room-memory-persistence-v0); no caller wires this yet.
   */
  snapshotAll(): RoomMemoryRecord[] {
    return [...this.records].sort(compareSnapshotOrder).map((record) => clone(record))
  }

  /**
   * Adapter-only helper (not on the `RoomMemoryStore` port): replaces all
   * current records with `records`, after re-validating each against
   * `RoomMemoryRecordSchema` (defense in depth, mirroring the SQLite adapter's
   * read-boundary re-validation). An invalid record is silently dropped —
   * this store never logs. Stores clones, so caller mutation of the input
   * records after this call cannot reach internal state. `record()`'s seq/
   * dedupe lookups continue to work correctly afterward since both scan
   * `this.records` directly. For future App save/load wiring
   * (runtime-room-memory-persistence-v0); no caller wires this yet.
   */
  restoreAll(records: readonly RoomMemoryRecord[]): void {
    const validated: RoomMemoryRecord[] = []
    for (const candidate of records) {
      const parsed = RoomMemoryRecordSchema.safeParse(candidate)
      if (parsed.success) validated.push(clone(parsed.data))
    }
    this.records.length = 0
    this.records.push(...validated)
  }
}

function compareSnapshotOrder(a: RoomMemoryRecord, b: RoomMemoryRecord): number {
  return (
    compareIds(a.worldId, b.worldId) ||
    compareIds(a.sessionId, b.sessionId) ||
    compareIds(a.roomId, b.roomId) ||
    (a.seq !== b.seq ? a.seq - b.seq : compareIds(a.memoryId, b.memoryId))
  )
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
