import type { RoomProvenance } from '../domain/assembleRoom'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import type {
  GeneratedRoomCacheSaveState,
  SavedGeneratedRoomObjective,
} from '../domain/quests/generatedRoomCacheSaveState'
import { SessionRoomCache } from '../room/SessionRoomCache'
import { validateMeaningfulObjectConsequenceCatalog } from '../domain/objectPurpose/meaningfulObjectConsequences'
import type { MeaningfulObjectConsequenceCatalog } from '../domain/objectPurpose/meaningfulObjectConsequences'
import type { QuestSpec } from '../domain/quests/questSpec'

export type RestoreGeneratedRoomCacheResult = {
  cache: SessionRoomCache
  provenance: Map<string, RoomProvenance>
  objectives: Map<string, SavedGeneratedRoomObjective>
  consequenceCatalogs: Map<string, MeaningfulObjectConsequenceCatalog>
  restoredRoomIds: string[]
  skippedRoomCount: number
}

export function restoreGeneratedRoomCache(
  state: GeneratedRoomCacheSaveState,
  currentRoom: LoadedRoom,
  currentQuestSpec?: QuestSpec,
): RestoreGeneratedRoomCacheResult {
  const cache = new SessionRoomCache()
  const provenance = new Map<string, RoomProvenance>()
  const objectives = new Map<string, SavedGeneratedRoomObjective>()
  const consequenceCatalogs = new Map<string, MeaningfulObjectConsequenceCatalog>()
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
    if (entry.objective !== undefined && room.id !== currentRoom.id) {
      objectives.set(room.id, entry.objective)
    }
    if (entry.consequenceCatalog !== undefined) {
      const questSpec = room.id === currentRoom.id
        ? currentQuestSpec
        : entry.objective?.questSpec
      const catalog = validateMeaningfulObjectConsequenceCatalog(entry.consequenceCatalog, {
        room,
        ...(questSpec !== undefined ? { questSpec } : {}),
      })
      if (catalog !== null) consequenceCatalogs.set(room.id, catalog)
    }
    if (!restoredRoomIds.includes(room.id)) restoredRoomIds.push(room.id)
  }

  cache.set(currentRoom.id, currentRoom)
  if (!restoredRoomIds.includes(currentRoom.id)) restoredRoomIds.push(currentRoom.id)

  return {
    cache,
    provenance,
    objectives,
    consequenceCatalogs,
    restoredRoomIds,
    skippedRoomCount,
  }
}
