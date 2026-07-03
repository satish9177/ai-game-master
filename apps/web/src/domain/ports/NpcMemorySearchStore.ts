import type { MemoryFtsQuery } from '../memory/ftsQuery'
import type { MemoryScope, NpcMemoryRecord } from '../memory/contracts'

/**
 * SQLite-only NPC memory FTS candidate search port.
 *
 * The query is a typed, prebuilt safe MATCH expression; raw player text must
 * not cross this boundary. Implementations return records from the base table,
 * re-validated through the normal stored-memory boundary.
 */
export interface NpcMemorySearchStore {
  searchForNpc(
    scope: MemoryScope,
    query: MemoryFtsQuery,
    options?: { limit?: number },
  ): Promise<NpcMemoryRecord[]>
}
