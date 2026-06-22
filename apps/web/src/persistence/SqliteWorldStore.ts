import type { DatabaseSync } from 'node:sqlite'
import type {
  CommitWorldEventInput,
  CreateSessionInput,
  RestoreSessionInput,
  WorldStore,
  WorldStoreErrorCode,
  WorldStoreWriteResult,
} from '../domain/ports/WorldStore'
import { WorldEventSchema } from '../domain/world/events'
import type { WorldEvent } from '../domain/world/events'
import { WorldStateSchema } from '../domain/world/worldState'
import type { WorldState } from '../domain/world/worldState'
import type { Logger } from '../platform/logger/Logger'
import { withTransaction } from './db'

/**
 * SQLite-backed implementation of the existing `WorldStore` port (ADR-0018),
 * unchanged. `node:sqlite` is synchronous; the port returns Promises, so each
 * method is `async` and runs the synchronous work inside.
 *
 * Invariants preserved from `InMemoryWorldStore` / ADR-0013:
 * - the event log is append-only (no update/delete; UNIQUE(session_id, seq) and
 *   DB triggers back it up);
 * - the snapshot is a projection cache, persisted atomically alongside its event;
 * - optimistic concurrency is a compare-and-set on `revision`.
 *
 * Logs carry ids / counts / codes only — never event payloads or story content.
 */

const PERSISTENCE_SCHEMA_VERSION = 1

// Internal control-flow signals used to roll a transaction back and map it to a
// typed result. They never escape the public async methods.
class AlreadyExistsSignal extends Error {}
class ConflictSignal extends Error {}
class NotFoundSignal extends Error {}

export class SqliteWorldStore implements WorldStore {
  private readonly db: DatabaseSync
  private readonly log: Logger

  constructor(db: DatabaseSync, logger: Logger) {
    this.db = db
    this.log = logger
  }

  async createSession(input: CreateSessionInput): Promise<WorldStoreWriteResult> {
    assertInitialCommit(input)
    try {
      withTransaction(this.db, () => {
        if (this.sessionExists(input.sessionId)) throw new AlreadyExistsSignal()
        this.insertSession(input.sessionId, input.worldId, input.snapshot)
        this.insertEvent(input.sessionId, input.firstEvent)
      })
    } catch (error) {
      if (error instanceof AlreadyExistsSignal) return this.fail(input.sessionId, 'already-exists')
      throw error
    }
    this.log.info('world session created', { sessionId: input.sessionId, revision: 1 })
    return { ok: true }
  }

  async commit(input: CommitWorldEventInput): Promise<WorldStoreWriteResult> {
    assertCommit(input)
    try {
      withTransaction(this.db, () => {
        // Optimistic concurrency: the snapshot/revision update only matches when
        // the stored revision still equals the caller's expectedRevision (CAS).
        const updated = this.db
          .prepare(
            `UPDATE world_sessions
               SET snapshot_json = ?, revision = ?, updated_at = ?
             WHERE session_id = ? AND revision = ?`,
          )
          .run(
            JSON.stringify(input.snapshot),
            input.snapshot.revision,
            input.snapshot.updatedAt,
            input.sessionId,
            input.expectedRevision,
          )
        if (Number(updated.changes) === 0) {
          // No row matched: distinguish a missing session from a stale revision.
          if (this.sessionExists(input.sessionId)) throw new ConflictSignal()
          throw new NotFoundSignal()
        }
        // Append the event; a UNIQUE(session_id, seq) violation here can only come
        // from a true concurrent writer and maps to conflict (rolls the CAS back).
        try {
          this.insertEvent(input.sessionId, input.event)
        } catch (error) {
          if (isUniqueViolation(error)) throw new ConflictSignal()
          throw error
        }
      })
    } catch (error) {
      if (error instanceof ConflictSignal) return this.fail(input.sessionId, 'conflict')
      if (error instanceof NotFoundSignal) return this.fail(input.sessionId, 'not-found')
      throw error
    }
    this.log.info('world event committed', {
      sessionId: input.sessionId,
      seq: input.event.seq,
      revision: input.snapshot.revision,
    })
    return { ok: true }
  }

  async restoreSession(input: RestoreSessionInput): Promise<WorldStoreWriteResult> {
    if (input.log.length === 0 || input.snapshot.sessionId !== input.sessionId) {
      throw new Error('restoreSession requires a validated, non-empty session')
    }
    try {
      withTransaction(this.db, () => {
        if (this.sessionExists(input.sessionId)) throw new AlreadyExistsSignal()
        this.insertSession(input.sessionId, input.snapshot.worldId, input.snapshot)
        for (const event of input.log) this.insertEvent(input.sessionId, event)
      })
    } catch (error) {
      if (error instanceof AlreadyExistsSignal) return this.fail(input.sessionId, 'already-exists')
      throw error
    }
    this.log.info('world session restored', {
      sessionId: input.sessionId,
      eventCount: input.log.length,
      revision: input.snapshot.revision,
    })
    return { ok: true }
  }

  async getSnapshot(sessionId: string): Promise<WorldState | null> {
    const row = this.db
      .prepare('SELECT snapshot_json FROM world_sessions WHERE session_id = ?')
      .get(sessionId)
    if (row === undefined) return null
    return parseStored(row.snapshot_json, WorldStateSchema, 'snapshot')
  }

  async listEvents(
    sessionId: string,
    options: { sinceSeq?: number } = {},
  ): Promise<WorldEvent[]> {
    const sinceSeq = options.sinceSeq ?? 0
    const rows = this.db
      .prepare(
        `SELECT event_json FROM world_events
         WHERE session_id = ? AND seq > ?
         ORDER BY seq`,
      )
      .all(sessionId, sinceSeq)
    return rows.map((row) => parseStored(row.event_json, WorldEventSchema, 'event'))
  }

  private sessionExists(sessionId: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM world_sessions WHERE session_id = ?').get(sessionId) !==
      undefined
    )
  }

  private insertSession(sessionId: string, worldId: string, snapshot: WorldState): void {
    this.db
      .prepare(
        `INSERT INTO world_sessions
           (session_id, world_id, schema_version, revision, snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        worldId,
        PERSISTENCE_SCHEMA_VERSION,
        snapshot.revision,
        JSON.stringify(snapshot),
        snapshot.updatedAt,
        snapshot.updatedAt,
      )
  }

  private insertEvent(sessionId: string, event: WorldEvent): void {
    this.db
      .prepare(
        `INSERT INTO world_events
           (event_id, session_id, seq, type, occurred_at, schema_version, event_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        sessionId,
        event.seq,
        event.type,
        event.occurredAt,
        PERSISTENCE_SCHEMA_VERSION,
        JSON.stringify(event),
      )
  }

  private fail(sessionId: string, code: WorldStoreErrorCode): WorldStoreWriteResult {
    this.log.warn('world store write rejected', { sessionId, code })
    return { ok: false, error: { code } }
  }
}

/**
 * Read-boundary validation (ADR-0018, ADR-0004 rule 7). Corruption of a session
 * snapshot or event is a genuine fault, not control flow: throw rather than mask
 * it as `null`/`not-found`. The stored row text is never logged.
 */
function parseStored<T>(
  value: unknown,
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
  kind: 'snapshot' | 'event',
): T {
  if (typeof value !== 'string') throw new Error(`corrupt stored ${kind}: non-text column`)
  let json: unknown
  try {
    json = JSON.parse(value)
  } catch {
    // Never include the stored text in the error — no raw row is ever leaked.
    throw new Error(`corrupt stored ${kind}: invalid JSON`)
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new Error(`corrupt stored ${kind}: failed schema validation`)
  return parsed.data
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

function assertInitialCommit(input: CreateSessionInput): void {
  if (
    input.firstEvent.type !== 'session-started' ||
    input.firstEvent.seq !== 1 ||
    input.firstEvent.sessionId !== input.sessionId ||
    input.firstEvent.payload.seed.worldId !== input.worldId ||
    input.snapshot.sessionId !== input.sessionId ||
    input.snapshot.worldId !== input.worldId ||
    input.snapshot.revision !== 1
  ) {
    throw new Error('createSession received an inconsistent initial commit')
  }
}

function assertCommit(input: CommitWorldEventInput): void {
  const nextRevision = input.expectedRevision + 1
  if (
    input.event.type === 'session-started' ||
    input.event.sessionId !== input.sessionId ||
    input.event.seq !== nextRevision ||
    input.snapshot.sessionId !== input.sessionId ||
    input.snapshot.revision !== nextRevision
  ) {
    throw new Error('commit received an inconsistent event/snapshot pair')
  }
}
