import type { DatabaseSync } from 'node:sqlite'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { RoomSpecSchema } from '../domain/roomSpec'
import type { RoomSpec } from '../domain/roomSpec'
import type {
  RoomStore,
  RoomStoreGetResult,
  RoomStoreSaveResult,
} from '../domain/ports/RoomStore'
import type { Logger } from '../platform/logger/Logger'
import { withTransaction } from './db'

/**
 * SQLite-backed implementation of the `RoomStore` port (ADR-0018). It persists
 * the validated RoomSpec *data document* only (never renderer objects) and loads
 * it back through the same `loadRoomSpec` boundary every room crosses.
 *
 * Last-writer-wins upsert: rooms are content, not event-sourced truth.
 *
 * Logs carry `roomId` / `code` only — never the room `name` or `spec_json`.
 */

const PERSISTENCE_SCHEMA_VERSION = 1

export class SqliteRoomStore implements RoomStore {
  private readonly db: DatabaseSync
  private readonly log: Logger

  constructor(db: DatabaseSync, logger: Logger) {
    this.db = db
    this.log = logger
  }

  async saveRoom(spec: RoomSpec): Promise<RoomStoreSaveResult> {
    // Re-validate at the boundary — never persist garbage (ADR-0004 rule 7).
    const parsed = RoomSpecSchema.safeParse(spec)
    if (!parsed.success) {
      this.log.warn('room save rejected', { code: 'invalid-room' })
      return { ok: false, error: { code: 'invalid-room' } }
    }
    const room = parsed.data
    const now = new Date().toISOString()
    const specJson = JSON.stringify(room)

    withTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO rooms (room_id, schema_version, name, spec_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(room_id) DO UPDATE SET
             schema_version = excluded.schema_version,
             name           = excluded.name,
             spec_json      = excluded.spec_json,
             updated_at     = excluded.updated_at`,
        )
        .run(room.id, PERSISTENCE_SCHEMA_VERSION, room.name, specJson, now, now)
    })

    this.log.info('room saved', { roomId: room.id })
    return { ok: true }
  }

  async getRoom(roomId: string): Promise<RoomStoreGetResult> {
    const row = this.db.prepare('SELECT spec_json FROM rooms WHERE room_id = ?').get(roomId)
    if (row === undefined) return { ok: false, reason: 'not-found' }

    const specJson = row.spec_json
    if (typeof specJson !== 'string') {
      this.log.warn('room load rejected', { roomId, code: 'invalid-stored-room' })
      return { ok: false, reason: 'invalid-stored-room' }
    }
    try {
      // Stored room corruption is an EXPECTED content failure → typed result
      // (contrast session snapshot/event corruption, which is a fault → throw).
      const room = loadRoomSpec(JSON.parse(specJson))
      return { ok: true, room }
    } catch {
      this.log.warn('room load rejected', { roomId, code: 'invalid-stored-room' })
      return { ok: false, reason: 'invalid-stored-room' }
    }
  }
}
