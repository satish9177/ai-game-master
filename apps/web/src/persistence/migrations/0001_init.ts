import type { DatabaseSync } from 'node:sqlite'

/**
 * Initial schema (ADR-0018 SQLite data model).
 *
 * Creates the three durable tables — `world_sessions`, `world_events`,
 * `rooms` — and the append-only triggers on `world_events`. The
 * `schema_migrations` bookkeeping table is owned by `runMigrations` itself.
 *
 * Raw SQL lives ONLY in persistence migration/adapter files (AGENTS rule, ADR-0018).
 */
export function up(db: DatabaseSync): void {
  // Authoritative sessions: one row per session, holding the projection-cache
  // snapshot and the optimistic-concurrency `revision` (= last event seq).
  db.exec(
    `CREATE TABLE world_sessions (
       session_id     TEXT PRIMARY KEY,
       world_id       TEXT NOT NULL,
       schema_version INTEGER NOT NULL,
       revision       INTEGER NOT NULL,
       snapshot_json  TEXT NOT NULL,
       created_at     TEXT NOT NULL,
       updated_at     TEXT NOT NULL
     )`,
  )

  // Append-only event ledger. UNIQUE(session_id, seq) gives gapless ordering,
  // a double-append guard, and the ordered-read / sinceSeq index.
  db.exec(
    `CREATE TABLE world_events (
       event_id       TEXT PRIMARY KEY,
       session_id     TEXT NOT NULL REFERENCES world_sessions(session_id),
       seq            INTEGER NOT NULL,
       type           TEXT NOT NULL,
       occurred_at    TEXT NOT NULL,
       schema_version INTEGER NOT NULL,
       event_json     TEXT NOT NULL,
       UNIQUE(session_id, seq)
     )`,
  )

  // Saved RoomSpec documents, keyed by the spec's own stable id.
  db.exec(
    `CREATE TABLE rooms (
       room_id        TEXT PRIMARY KEY,
       schema_version INTEGER NOT NULL,
       name           TEXT NOT NULL,
       spec_json      TEXT NOT NULL,
       created_at     TEXT NOT NULL,
       updated_at     TEXT NOT NULL
     )`,
  )

  // Append-only enforcement (defense in depth): the adapter exposes no
  // update/delete of events, and these triggers make it provable at the DB level.
  db.exec(
    `CREATE TRIGGER world_events_no_update
       BEFORE UPDATE ON world_events
       BEGIN SELECT RAISE(ABORT, 'world_events is append-only'); END`,
  )
  db.exec(
    `CREATE TRIGGER world_events_no_delete
       BEFORE DELETE ON world_events
       BEGIN SELECT RAISE(ABORT, 'world_events is append-only'); END`,
  )
}
