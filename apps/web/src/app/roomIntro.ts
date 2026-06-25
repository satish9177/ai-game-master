import { buildRoomSummary } from '../domain/roomSummary'
import type { RoomSummary } from '../domain/roomSummary'
import type { LoadedRoom } from '../domain/loadRoomSpec'

export type RoomIntroView = {
  summary: RoomSummary | null
  roomKey: string
}

export function buildRoomIntroView(
  room: LoadedRoom,
  sessionId: string,
  entrySeq: number,
): RoomIntroView {
  return {
    summary: buildRoomSummary(room),
    roomKey: `${sessionId}:${room.id}:${entrySeq}`,
  }
}
