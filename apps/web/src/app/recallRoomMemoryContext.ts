import { rankMemories } from '../domain/memory/ranking'
import type { RoomMemoryRecord, RoomMemoryScope } from '../domain/memory/roomContracts'
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

export type RecalledRoomMemory = {
  scope: RoomMemoryScope
  records: RoomMemoryRecord[]
}

export async function recallRoomMemoryContext(
  scope: RoomMemoryScope,
  roomMemory: RoomMemoryService,
  logger: Logger,
  options?: { activeNpcId?: string; limit?: number },
): Promise<RecalledRoomMemory> {
  try {
    const result = await roomMemory.recall(scope)
    const ranked = rankMemories(result.memories, {
      currentRoomId: scope.roomId,
      ...(options?.activeNpcId !== undefined ? { activeNpcId: options.activeNpcId } : {}),
    })
    const records = ranked.map((entry) => entry.record)
    logger.info('room memory context recalled', { roomId: scope.roomId, count: records.length })
    return { scope, records }
  } catch {
    logger.warn('room memory context failed', { roomId: scope.roomId, code: 'recall-threw' })
    return { scope, records: [] }
  }
}
