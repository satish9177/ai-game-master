import type { RoomSource, RoomLoadResult } from '../domain/ports/RoomSource'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { throneRoom } from '../domain/examples/throneRoom'

/**
 * The first RoomSource: returns the hardcoded throne room, validated through the
 * same loadRoomSpec boundary every source uses. It implements the async,
 * result-typed RoomSource contract so the host treats it identically to a future
 * generated or fetched source — only this file knows the room is static.
 *
 * This is a composition-layer adapter, not domain: it picks the concrete room
 * and runs the loader, so it lives outside the pure domain (BOUNDARIES.md).
 *
 * An invalid envelope makes loadRoomSpec throw (FAILURE-MODES.md case 1). The
 * hardcoded throne room is always valid, so that path can't fire today, but the
 * contract still models it as a typed result rather than letting it throw — the
 * detail (zod issues) is left to richer future sources where it can occur.
 */
export class StaticRoomSource implements RoomSource {
  async getRoom(): Promise<RoomLoadResult> {
    try {
      return { ok: true, room: loadRoomSpec(throneRoom) }
    } catch {
      return {
        ok: false,
        error: { code: 'invalid-room', message: 'This room could not be loaded.' },
      }
    }
  }
}
