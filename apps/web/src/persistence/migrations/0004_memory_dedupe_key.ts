import type { DatabaseSync } from 'node:sqlite'

/**
 * Memory dedupe key column (memory-display-name-persistence-v0, Slice C3).
 *
 * Adds a NULLABLE `dedupe_key` column to both memory tables plus a non-unique
 * index for the store's pre-check dedupe lookup. `schemaVersion` on the memory
 * record stays `1` — `dedupeKey` already rides inside `memory_json` (Slice C1);
 * this migration only lets the store query for it without a table scan.
 *
 * - Additive and backward-compatible: existing rows get `dedupe_key = NULL` and
 *   still parse/recall unchanged (their JSON simply lacks the field too).
 * - Non-unique by design: dedupe is enforced by a pre-check in the store, not a
 *   DB constraint, so a duplicate key is a normal, expected lookup hit rather
 *   than a UNIQUE-violation error path.
 *
 * Raw SQL lives ONLY in persistence migration/adapter files (AGENTS rule, ADR-0018).
 */
export function up(db: DatabaseSync): void {
  db.exec('ALTER TABLE npc_memories ADD COLUMN dedupe_key TEXT')
  db.exec('ALTER TABLE room_memories ADD COLUMN dedupe_key TEXT')

  db.exec(
    `CREATE INDEX idx_npc_memories_dedupe
       ON npc_memories(session_id, npc_id, dedupe_key)`,
  )
  db.exec(
    `CREATE INDEX idx_room_memories_dedupe
       ON room_memories(session_id, room_id, dedupe_key)`,
  )
}
