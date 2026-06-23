import type { DatabaseSync } from 'node:sqlite'

/**
 * NPC memory schema (npc-memory-persistence-v0). Follows the `world_events` /
 * `rooms` precedent: indexed scope columns alongside a JSON blob.
 *
 * - The FK to `world_sessions` (with `foreign_keys=ON`) makes "write a memory for
 *   a non-existent session" fail at the DB; the adapter pre-checks and maps it to
 *   `session-not-found`.
 * - `UNIQUE(session_id, npc_id, seq)` gives gapless per-NPC ordering and a
 *   concurrent-writer guard.
 * - The scope index serves both the exact-triple filter and seq-desc recall.
 * - Memories are immutable claims (insert-only in v0): a BEFORE UPDATE trigger
 *   aborts any mutation. DELETE is intentionally left OPEN for a future
 *   forgetting/eviction slice, so no no-delete trigger is added.
 *
 * Raw SQL lives ONLY in persistence migration/adapter files (AGENTS rule, ADR-0018).
 */
export function up(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE npc_memories (
       memory_id      TEXT PRIMARY KEY,
       world_id       TEXT NOT NULL,
       session_id     TEXT NOT NULL REFERENCES world_sessions(session_id),
       npc_id         TEXT NOT NULL,
       kind           TEXT NOT NULL,
       seq            INTEGER NOT NULL,
       schema_version INTEGER NOT NULL,
       memory_json    TEXT NOT NULL,
       created_at     TEXT NOT NULL,
       UNIQUE(session_id, npc_id, seq)
     )`,
  )

  db.exec(
    `CREATE INDEX idx_npc_memories_scope
       ON npc_memories(world_id, session_id, npc_id, seq)`,
  )

  // Immutability (defense in depth): the adapter exposes no update path, and this
  // trigger makes it provable at the DB level. No no-delete trigger — DELETE is
  // reserved for a future forgetting/eviction slice (v0 never deletes).
  db.exec(
    `CREATE TRIGGER npc_memories_no_update
       BEFORE UPDATE ON npc_memories
       BEGIN SELECT RAISE(ABORT, 'npc_memories rows are immutable'); END`,
  )
}
