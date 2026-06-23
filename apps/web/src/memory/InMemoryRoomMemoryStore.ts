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
 */
export class InMemoryRoomMemoryStore implements RoomMemoryStore {
  private readonly records: RoomMemoryRecord[] = []

  async record(input: RoomMemoryInsert): Promise<RoomMemoryWriteResult> {
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

  private nextSeq(sessionId: string, roomId: string): number {
    let max = 0
    for (const record of this.records) {
      if (record.sessionId === sessionId && record.roomId === roomId && record.seq > max) {
        max = record.seq
      }
    }
    return max + 1
  }
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
