import type { MemoryFtsQuery } from '../memory/ftsQuery'
import type { RoomMemoryRecord, RoomMemoryScope } from '../memory/roomContracts'

/**
 * SQLite-only room memory FTS candidate search port.
 *
 * The query is a typed, prebuilt safe MATCH expression; raw player text must
 * not cross this boundary. Implementations return records from the base table,
 * re-validated through the normal stored-memory boundary.
 */
export interface RoomMemorySearchStore {
  searchForRoom(
    scope: RoomMemoryScope,
    query: MemoryFtsQuery,
    options?: { limit?: number },
  ): Promise<RoomMemoryRecord[]>
}
