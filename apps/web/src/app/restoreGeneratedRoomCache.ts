import type { RoomProvenance } from '../domain/assembleRoom'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import type { GeneratedRoomCacheSaveState } from '../domain/quests/generatedRoomCacheSaveState'
import { SessionRoomCache } from '../room/SessionRoomCache'

export type RestoreGeneratedRoomCacheResult = {
  cache: SessionRoomCache
  provenance: Map<string, RoomProvenance>
  restoredRoomIds: string[]
  skippedRoomCount: number
}

export function restoreGeneratedRoomCache(
  state: GeneratedRoomCacheSaveState,
  currentRoom: LoadedRoom,
): RestoreGeneratedRoomCacheResult {
  const cache = new SessionRoomCache()
  const provenance = new Map<string, RoomProvenance>()
  const restoredRoomIds: string[] = []
  let skippedRoomCount = 0

  for (const entry of state.rooms) {
    let room: LoadedRoom
    try {
      room = loadRoomSpec(entry.room)
    } catch {
      skippedRoomCount += 1
      continue
    }

    cache.set(room.id, room)
    provenance.set(room.id, entry.provenance)
    if (!restoredRoomIds.includes(room.id)) restoredRoomIds.push(room.id)
  }

  cache.set(currentRoom.id, currentRoom)
  if (!restoredRoomIds.includes(currentRoom.id)) restoredRoomIds.push(currentRoom.id)

  return { cache, provenance, restoredRoomIds, skippedRoomCount }
}
