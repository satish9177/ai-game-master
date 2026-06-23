import type { RoomMemoryInsert, RoomMemoryRecord, RoomMemoryScope } from '../memory/roomContracts'

/**
 * Durable room memory port (living-world-room-memory-v0). Mirrors
 * `NpcMemoryStore` / `WorldStore` / `RoomStore`: expected failures are typed
 * results, not thrown. Memory is insert-only in v0 (immutable claims); there
 * is no update or delete on the port.
 *
 * The store assigns a gapless monotonic `seq` per `(sessionId, roomId)` and
 * ties each memory to a real session (the SQLite adapter via an FK). This port
 * exposes no path to mutate `WorldState`, `roomStates`, or the event log —
 * room memory cannot become truth.
 */

export type RoomMemoryStoreErrorCode = 'session-not-found' | 'conflict'

export type RoomMemoryWriteResult =
  | { ok: true; record: RoomMemoryRecord } // includes the assigned seq
  | { ok: false; error: { code: RoomMemoryStoreErrorCode } }

export interface RoomMemoryStore {
  /** Persist one memory (insert-only). Assigns the next seq for (sessionId, roomId). */
  record(input: RoomMemoryInsert): Promise<RoomMemoryWriteResult>
  /** Scoped read: exact (worldId, sessionId, roomId), seq desc, bounded by limit. */
  listForRoom(scope: RoomMemoryScope, options?: { limit?: number }): Promise<RoomMemoryRecord[]>
}
