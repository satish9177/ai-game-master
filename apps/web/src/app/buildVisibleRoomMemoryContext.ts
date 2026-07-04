import { selectVisibleRoomMemories } from '../domain/facts/selectVisibleRoomMemories'
import type { RoomMemoryDialogueContext } from '../domain/dialogue/contracts'
import { DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT } from './recallRoomMemoryContext'
import type { RecalledRoomMemory } from './recallRoomMemoryContext'

export function buildVisibleRoomMemoryContext(
  recalled: RecalledRoomMemory,
  npcId: string,
): RoomMemoryDialogueContext | undefined {
  try {
    const visibleRecords = selectVisibleRoomMemories(recalled.records, {
      kind: 'npc',
      worldId: recalled.scope.worldId,
      sessionId: recalled.scope.sessionId,
      roomId: recalled.scope.roomId,
      npcId,
    })

    const entries = visibleRecords
      .slice(0, DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT)
      .map((record) => ({
        text: record.text,
        kind: record.kind,
      }))

    return { entries }
  } catch {
    return undefined
  }
}
