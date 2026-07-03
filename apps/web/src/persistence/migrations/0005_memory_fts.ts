import type { DatabaseSync } from 'node:sqlite'

/**
 * SQLite FTS5 index for NPC and room memory retrieval candidates.
 *
 * These virtual tables are derived indexes only: record bytes still come from
 * `npc_memories` / `room_memories`. Live writes are store-driven from the
 * already-validated in-memory record text; the json_extract calls below are a
 * one-time backfill for rows that existed before this migration.
 */
export function up(db: DatabaseSync): void {
  db.exec(
    `CREATE VIRTUAL TABLE npc_memories_fts USING fts5(
       text,
       memory_id UNINDEXED,
       world_id UNINDEXED,
       session_id UNINDEXED,
       npc_id UNINDEXED,
       tokenize = 'unicode61 remove_diacritics 2'
     )`,
  )

  db.exec(
    `CREATE VIRTUAL TABLE room_memories_fts USING fts5(
       text,
       memory_id UNINDEXED,
       world_id UNINDEXED,
       session_id UNINDEXED,
       room_id UNINDEXED,
       tokenize = 'unicode61 remove_diacritics 2'
     )`,
  )

  db.exec(
    `INSERT INTO npc_memories_fts(text, memory_id, world_id, session_id, npc_id)
       SELECT json_extract(memory_json, '$.text'), memory_id, world_id, session_id, npc_id
       FROM npc_memories`,
  )

  db.exec(
    `INSERT INTO room_memories_fts(text, memory_id, world_id, session_id, room_id)
       SELECT json_extract(memory_json, '$.text'), memory_id, world_id, session_id, room_id
       FROM room_memories`,
  )
}
