import type { DatabaseSync } from 'node:sqlite'
import { RoomMemoryRecordSchema } from '../domain/memory/roomContracts'
import type { RoomMemoryInsert, RoomMemoryRecord, RoomMemoryScope } from '../domain/memory/roomContracts'
import type {
  RoomMemoryStore,
  RoomMemoryStoreErrorCode,
  RoomMemoryWriteResult,
} from '../domain/ports/RoomMemoryStore'
import type { Logger } from '../platform/logger/Logger'
import { withTransaction } from './db'

/**
 * SQLite-backed implementation of the `RoomMemoryStore` port
 * (living-world-room-memory-v0). Node-only; `node:sqlite` is synchronous, so
 * each port method is `async` and runs the synchronous work inside.
 *
 * Invariants:
 * - Insert-only: memories are immutable claims (a DB BEFORE UPDATE trigger
 *   backs it up). `seq` is gapless and monotonic per `(session_id, room_id)`.
 * - The FK to `world_sessions` ties a memory to a real session; a missing
 *   session maps to the typed `session-not-found` (never a thrown fault).
 * - No FK to `rooms`: `room_id` is a plain scope string; room memory must not
 *   require a persisted room row (mirrors `npc_id` being FK'd to nothing). An
 *   unknown room id is allowed on write and simply recalls [].
 * - Reads are scope-filtered in SQL and re-validated at the boundary. A corrupt
 *   stored memory is an EXPECTED content failure → that row is skipped (contrast
 *   session/event corruption, which is a fault → throw). Recall is never blocked.
 *
 * Memory is supporting context only: this store exposes no path to the event
 * log, `WorldState`, or `roomStates`. Logs carry ids / seq / codes only —
 * never `memory_json` or text.
 */

const PERSISTENCE_SCHEMA_VERSION = 1

// Internal control-flow signals used to roll a transaction back and map it to
// a typed result. They never escape the public async methods.
class ConflictSignal extends Error {}
class NotFoundSignal extends Error {}

export class SqliteRoomMemoryStore implements RoomMemoryStore {
  private readonly db: DatabaseSync
  private readonly log: Logger

  constructor(db: DatabaseSync, logger: Logger) {
    this.db = db
    this.log = logger
  }

  async record(input: RoomMemoryInsert): Promise<RoomMemoryWriteResult> {
    let record: RoomMemoryRecord
    try {
      record = withTransaction(this.db, () => {
        if (!this.sessionExists(input.sessionId)) throw new NotFoundSignal()

        const seq = this.nextSeq(input.sessionId, input.roomId)
        const next: RoomMemoryRecord = { ...input, seq }
        try {
          this.insertMemory(next)
        } catch (error) {
          // A UNIQUE(session_id, room_id, seq) violation here can only come from
          // a true concurrent writer; map it to conflict (rolls the insert back).
          if (isUniqueViolation(error)) throw new ConflictSignal()
          throw error
        }
        return next
      })
    } catch (error) {
      if (error instanceof NotFoundSignal) return this.fail(input.sessionId, 'session-not-found')
      if (error instanceof ConflictSignal) return this.fail(input.sessionId, 'conflict')
      throw error
    }

    this.log.info('room memory recorded', {
      memoryId: record.memoryId,
      sessionId: record.sessionId,
      roomId: record.roomId,
      seq: record.seq,
    })
    return { ok: true, record }
  }

  async listForRoom(
    scope: RoomMemoryScope,
    options: { limit?: number } = {},
  ): Promise<RoomMemoryRecord[]> {
    // LIMIT -1 means "no limit" in SQLite; the service always passes a bound.
    const limit = options.limit ?? -1
    const rows = this.db
      .prepare(
        `SELECT memory_id, memory_json FROM room_memories
           WHERE world_id = ? AND session_id = ? AND room_id = ?
           ORDER BY seq DESC
           LIMIT ?`,
      )
      .all(scope.worldId, scope.sessionId, scope.roomId, limit)

    const records: RoomMemoryRecord[] = []
    for (const row of rows) {
      const parsed = this.parseStoredMemory(row.memory_id, row.memory_json, scope)
      if (parsed) records.push(parsed)
    }
    return records
  }

  private sessionExists(sessionId: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM world_sessions WHERE session_id = ?').get(sessionId) !==
      undefined
    )
  }

  private nextSeq(sessionId: string, roomId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS next
           FROM room_memories WHERE session_id = ? AND room_id = ?`,
      )
      .get(sessionId, roomId)
    return Number(row?.next ?? 1)
  }

  private insertMemory(record: RoomMemoryRecord): void {
    this.db
      .prepare(
        `INSERT INTO room_memories
           (memory_id, world_id, session_id, room_id, kind, seq, schema_version, memory_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.memoryId,
        record.worldId,
        record.sessionId,
        record.roomId,
        record.kind,
        record.seq,
        PERSISTENCE_SCHEMA_VERSION,
        JSON.stringify(record),
        record.createdAt,
      )
  }

  /**
   * Read-boundary re-validation. A corrupt stored memory is an EXPECTED content
   * failure → skip the row and return null (logged `invalid-stored-memory`,
   * memoryId/code only). The stored text is never logged. Recall is never blocked.
   *
   * Defense in depth (living-world-room-memory-v0): the SQL query already
   * filters by the scope columns, but the parsed `memory_json` scope is
   * re-asserted to match the query triple exactly. A divergence (column/JSON
   * tamper or corruption) is treated like any other invalid stored row —
   * skipped, never leaked across scope.
   */
  private parseStoredMemory(
    memoryId: unknown,
    memoryJson: unknown,
    scope: RoomMemoryScope,
  ): RoomMemoryRecord | null {
    if (typeof memoryJson !== 'string') {
      this.log.warn('room memory read rejected', {
        memoryId: String(memoryId),
        code: 'invalid-stored-memory',
      })
      return null
    }
    let json: unknown
    try {
      json = JSON.parse(memoryJson)
    } catch {
      this.log.warn('room memory read rejected', {
        memoryId: String(memoryId),
        code: 'invalid-stored-memory',
      })
      return null
    }
    const parsed = RoomMemoryRecordSchema.safeParse(json)
    if (!parsed.success) {
      this.log.warn('room memory read rejected', {
        memoryId: String(memoryId),
        code: 'invalid-stored-memory',
      })
      return null
    }
    const record = parsed.data
    if (
      record.worldId !== scope.worldId ||
      record.sessionId !== scope.sessionId ||
      record.roomId !== scope.roomId
    ) {
      this.log.warn('room memory read rejected', {
        memoryId: String(memoryId),
        code: 'invalid-stored-memory',
      })
      return null
    }
    return record
  }

  private fail(sessionId: string, code: RoomMemoryStoreErrorCode): RoomMemoryWriteResult {
    this.log.warn('room memory write rejected', { sessionId, code })
    return { ok: false, error: { code } }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}
