import { rankMemories } from '../domain/memory/ranking'
import type { RoomMemoryScope } from '../domain/memory/roomContracts'
import type { RoomMemoryDialogueContext } from '../domain/dialogue/contracts'
import type { RoomMemoryService } from '../memory/RoomMemoryService'
import type { Logger } from '../platform/logger/Logger'

/**
 * Eval-only sibling of `app/recallRoomMemoryContext.ts` (sqlite-fts-memory-retrieval
 * Slice 3a). It is NOT wired into any runtime/browser path; `app/recallRoomMemoryContext.ts`
 * and `App.tsx` stay untouched. It exists only so the Node-side evaluation suite can prove
 * `RoomMemoryService.recallRelevant` (FTS candidate order) feeds the same bounded dialogue
 * context / prompt chain the runtime path builds from `recall()` + `rankMemories`.
 *
 * FTS-first, `recall()`-fallback (never blends): a `recalled` result with at least one
 * FTS match is used in its incoming (bm25) order; an `unavailable` search store, an empty
 * safe-token query, or a keyword miss all fall back to the existing `recall()` +
 * `rankMemories` path exactly as `recallRoomMemoryContext` does today, so context is never
 * emptied by a bad or missing query.
 */
export const DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT = 5

export async function recallRelevantRoomMemoryContext(
  scope: RoomMemoryScope,
  roomMemory: RoomMemoryService,
  logger: Logger,
  options: { tokens: readonly string[]; activeNpcId?: string; limit?: number },
): Promise<RoomMemoryDialogueContext> {
  const limit = options.limit ?? DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT
  try {
    const relevant = await roomMemory.recallRelevant(scope, { tokens: options.tokens })
    if (relevant.status === 'recalled' && relevant.memories.length > 0) {
      const entries = relevant.memories.slice(0, limit).map((record) => ({
        text: record.text,
        kind: record.kind,
      }))
      logger.info('room memory relevant context recalled', { roomId: scope.roomId, count: entries.length })
      return { entries }
    }

    const result = await roomMemory.recall(scope)
    const ranked = rankMemories(result.memories, {
      currentRoomId: scope.roomId,
      ...(options.activeNpcId !== undefined ? { activeNpcId: options.activeNpcId } : {}),
    })
    const entries = ranked.slice(0, limit).map((entry) => ({
      text: entry.record.text,
      kind: entry.record.kind,
    }))
    logger.info('room memory context recalled', { roomId: scope.roomId, count: entries.length })
    return { entries }
  } catch {
    logger.warn('room memory context failed', { roomId: scope.roomId, code: 'recall-threw' })
    return { entries: [] }
  }
}
