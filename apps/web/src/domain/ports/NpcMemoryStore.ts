import type { MemoryScope, NpcMemoryInsert, NpcMemoryRecord } from '../memory/contracts'

/**
 * Durable NPC memory port (npc-memory-persistence-v0). Mirrors `WorldStore` /
 * `RoomStore`: expected failures are typed results, not thrown. Memory is
 * insert-only in v0 (immutable claims); there is no update or delete on the port.
 *
 * The store assigns a gapless monotonic `seq` per `(sessionId, npcId)` and ties
 * each memory to a real session (the SQLite adapter via an FK). This port exposes
 * no path to mutate `WorldState` or the event log — memory cannot become truth.
 */

export type NpcMemoryStoreErrorCode = 'session-not-found' | 'conflict'

export type NpcMemoryWriteResult =
  | { ok: true; record: NpcMemoryRecord; deduplicated?: boolean } // includes the assigned seq
  | { ok: false; error: { code: NpcMemoryStoreErrorCode } }

export interface NpcMemoryStore {
  /**
   * Persist one memory (insert-only). Assigns the next seq for (sessionId, npcId).
   * When `input.dedupeKey` is set and a matching prior record already exists for
   * the same (sessionId, npcId, dedupeKey), the store returns that existing
   * record with `deduplicated: true` instead of inserting a new row (Slice C3).
   */
  record(input: NpcMemoryInsert): Promise<NpcMemoryWriteResult>
  /** Scoped read: exact (worldId, sessionId, npcId), seq desc, bounded by limit. */
  listForNpc(scope: MemoryScope, options?: { limit?: number }): Promise<NpcMemoryRecord[]>
}
