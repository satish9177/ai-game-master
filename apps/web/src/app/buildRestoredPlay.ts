import { SessionRoomCache } from '../room/SessionRoomCache'
import { projectPlayerHud } from '../renderer/ui/playerHud'
import type { PlayerHudView } from '../renderer/ui/playerHud'
import type { WorldState } from '../domain/world/worldState'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { RoomSource } from '../domain/ports/RoomSource'
import type { ResolveRoomResult } from './AdjacentRoomPregenerator'
import { withRoomId } from './AdjacentRoomPregenerator'

export type RestoredPlay = {
  roomSource: RoomSource
  sessionId: string
  roomCache: SessionRoomCache
  initialPlayer: PlayerHudView
}

export type BuildRestoredPlayResult = {
  play: RestoredPlay
  degraded: boolean
}

function preloadedRoomSource(room: LoadedRoom): RoomSource {
  return { getRoom: async () => ({ ok: true, room }) }
}

/**
 * Pure restore helper. Turns a validated, restored WorldState and a
 * room-resolve result into a RestoredPlay descriptor and a degraded flag.
 * Does not mutate state, does not touch localStorage, does not call services.
 */
export function buildRestoredPlay(
  state: WorldState,
  resolveResult: ResolveRoomResult,
  fallbackRoom: LoadedRoom,
): BuildRestoredPlayResult {
  // A room is faithful only when it came back through the authored registry
  // path. Deterministically-generated adjacents may match in v0, but we cannot
  // assert faithfulness from authoritative data (§9 of the plan).
  const degraded = !resolveResult.ok || resolveResult.source !== 'registry'

  const resolvedRoom = resolveResult.ok
    ? resolveResult.room
    : withRoomId(fallbackRoom, state.currentRoomId)

  const roomCache = new SessionRoomCache()
  roomCache.set(state.currentRoomId, resolvedRoom)

  return {
    play: {
      roomSource: preloadedRoomSource(resolvedRoom),
      sessionId: state.sessionId,
      roomCache,
      initialPlayer: projectPlayerHud(state),
    },
    degraded,
  }
}
