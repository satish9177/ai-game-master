import {
  DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT,
  type RecalledRoomMemory,
} from '../app/recallRoomMemoryContext'
import type { RoomMemoryDialogueContext } from '../domain/dialogue/contracts'

export function toUngatedRoomMemoryDialogueContext(
  recalled: RecalledRoomMemory,
  limit = DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT,
): RoomMemoryDialogueContext {
  return {
    entries: recalled.records.slice(0, limit).map((record) => ({
      text: record.text,
      kind: record.kind,
    })),
  }
}
