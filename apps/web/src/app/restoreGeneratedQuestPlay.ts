import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { GeneratedQuestSaveState } from '../domain/quests/generatedQuestSaveState'
import type { QuestSpec } from '../domain/quests/questSpec'
import type { GeneratedStoryThreadKind } from '../domain/generatedStoryThread'
import type { WorldState } from '../domain/world/worldState'
import type { RoomSource } from '../domain/ports/RoomSource'
import { projectPlayerHud } from '../renderer/ui/playerHud'
import type { PlayerHudView } from '../renderer/ui/playerHud'
import { SessionRoomCache } from '../room/SessionRoomCache'
import { resolvedObjectIdsForGeneratedPlay } from './App.helpers'
import type { QuestHintState } from './App.helpers'

/**
 * Pure composition restore helper. Turns a validated, re-validated
 * `GeneratedQuestSaveState` (the parked restore-model blob) plus the already
 * restored authoritative `WorldState` into the generated-play `ActivePlay`
 * fields the App needs after a load.
 *
 * It never mutates `WorldState` or the snapshot, never calls a generator,
 * provider, or objective-assembly stage, and writes no events, memory, NPC,
 * objective, or cost state. `loadRoomSpec` is the only room-reconstruction call
 * — the parked objects are already post-assembly output, so the strict
 * `loadRoomSpec` boundary is the correct and sufficient re-validation step
 * (ADR-0059).
 *
 * `navigation` and `adjacentPregenerator` are intentionally not set here; the
 * caller supplies the authored fallback wiring (documented v0 known limitation).
 */
export type RestoredGeneratedQuestPlay = {
  room: LoadedRoom
  roomSource: RoomSource
  roomCache: SessionRoomCache
  initialPlayer: PlayerHudView
  objectivesPerRoom: true
  questSpec?: QuestSpec
  storyKind?: GeneratedStoryThreadKind
  hints?: QuestHintState
  entryResolvedObjectIds?: ReadonlySet<string>
}

export type RestoreGeneratedQuestPlayResult =
  | { ok: true; play: RestoredGeneratedQuestPlay }
  | { ok: false; code: 'room-load-failed' }

export function restoreGeneratedQuestPlay(
  state: GeneratedQuestSaveState,
  worldState: WorldState,
): RestoreGeneratedQuestPlayResult {
  // Re-validate the parked spec through the existing strict boundary. A bad
  // envelope throws; return a fixed code without echoing the room/object ids or
  // any input content.
  let room: LoadedRoom
  try {
    room = loadRoomSpec(state.room)
  } catch {
    return { ok: false, code: 'room-load-failed' }
  }

  const roomCache = new SessionRoomCache()
  roomCache.set(room.id, room)

  // Recomputed from the restored WorldState flags + the restored room, so the
  // room's object ids match the surviving flags again (object-state semantics
  // unchanged).
  const entryResolvedObjectIds = resolvedObjectIdsForGeneratedPlay({
    objectivesPerRoom: true,
    state: worldState,
    room,
  })

  return {
    ok: true,
    play: {
      room,
      roomSource: preloadedRoomSource(room),
      roomCache,
      initialPlayer: projectPlayerHud(worldState),
      objectivesPerRoom: true,
      ...(state.questSpec !== undefined ? { questSpec: state.questSpec } : {}),
      ...(state.storyKind !== undefined ? { storyKind: state.storyKind } : {}),
      ...(state.hints !== undefined ? { hints: state.hints } : {}),
      ...(entryResolvedObjectIds !== undefined ? { entryResolvedObjectIds } : {}),
    },
  }
}

function preloadedRoomSource(room: LoadedRoom): RoomSource {
  return { getRoom: async () => ({ ok: true, room }) }
}
