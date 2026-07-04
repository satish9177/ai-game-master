import { selectVisibleRoomMemories } from '../domain/facts/selectVisibleRoomMemories'
import type { RoomMemoryDialogueContext } from '../domain/dialogue/contracts'
import type { RoomMemoryRecord, RoomMemoryScope } from '../domain/memory/roomContracts'
import { DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT } from './recallRoomMemoryContext'

export type RecalledRoomMemory = {
  scope: RoomMemoryScope
  records: RoomMemoryRecord[]
}

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
