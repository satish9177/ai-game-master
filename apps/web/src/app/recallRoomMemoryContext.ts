import { rankMemories } from '../domain/memory/ranking'
import type { RoomMemoryScope } from '../domain/memory/roomContracts'
import type { RoomMemoryDialogueContext } from '../domain/dialogue/contracts'
import type { RoomMemoryService } from '../memory/RoomMemoryService'
import type { Logger } from '../platform/logger/Logger'

/**
 * Composition-root orchestrator (room-memory-recall-context-v0, Slice F).
 *
 * Bridges the headless `RoomMemoryService.recall` plus the pure Slice B
 * `rankMemories` helper into a small, bounded, dialogue-local view. It never
 * writes, never touches `WorldSession`, and any failure — including a
 * throwing store, which `RoomMemoryService.recall` does not itself catch —
 * degrades to an empty context instead of propagating.
 *
 * The returned shape is dialogue-local (`RoomMemoryDialogueContext`), not the
 * `RoomMemoryRecord` type: `domain/dialogue` must not import `domain/memory`,
 * so mapping `record.kind` to a plain `string` happens here in the app layer.
 */
export const DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT = 5

export async function recallRoomMemoryContext(
  scope: RoomMemoryScope,
  roomMemory: RoomMemoryService,
  logger: Logger,
  options?: { activeNpcId?: string; limit?: number },
): Promise<RoomMemoryDialogueContext> {
  const limit = options?.limit ?? DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT
  try {
    const result = await roomMemory.recall(scope)
    const ranked = rankMemories(result.memories, {
      currentRoomId: scope.roomId,
      ...(options?.activeNpcId !== undefined ? { activeNpcId: options.activeNpcId } : {}),
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
