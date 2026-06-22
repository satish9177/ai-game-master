import { ruinedRoom } from '../domain/examples/ruinedRoom'
import { throneRoom } from '../domain/examples/throneRoom'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { LoadedRoom } from '../domain/loadRoomSpec'

export type RoomRegistryResult =
  | { ok: true; room: LoadedRoom }
  | { ok: false; reason: 'unknown-room' | 'invalid-room' }

const EXAMPLE_ROOMS: Readonly<Record<string, unknown>> = {
  'throne-room': throneRoom,
  'ruined-safehouse': ruinedRoom,
}

export class RoomRegistry {
  private readonly rooms: ReadonlyMap<string, unknown>

  constructor(rooms: Readonly<Record<string, unknown>> = EXAMPLE_ROOMS) {
    this.rooms = new Map(Object.entries(rooms))
  }

  resolve(roomId: string): RoomRegistryResult {
    const raw = this.rooms.get(roomId)
    if (raw === undefined) return { ok: false, reason: 'unknown-room' }
    try {
      return { ok: true, room: loadRoomSpec(raw) }
    } catch {
      return { ok: false, reason: 'invalid-room' }
    }
  }
}
