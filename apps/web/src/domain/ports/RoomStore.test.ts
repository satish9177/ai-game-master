import { describe, expect, it } from 'vitest'
import { throneRoom } from '../examples/throneRoom'
import { loadRoomSpec } from '../loadRoomSpec'
import { RoomSpecSchema } from '../roomSpec'
import type { RoomSpec } from '../roomSpec'
import type { RoomStore } from './RoomStore'

/**
 * Port-shape test: a trivial in-memory conformant implementation proves the
 * `RoomStore` contract compiles and its typed results are usable with no
 * persistence dependency (the port is pure domain).
 */
class FakeRoomStore implements RoomStore {
  private readonly rooms = new Map<string, RoomSpec>()

  async saveRoom(spec: RoomSpec) {
    if (spec.id.length === 0) return { ok: false as const, error: { code: 'invalid-room' as const } }
    this.rooms.set(spec.id, spec)
    return { ok: true as const }
  }

  async getRoom(roomId: string) {
    const spec = this.rooms.get(roomId)
    if (!spec) return { ok: false as const, reason: 'not-found' as const }
    return { ok: true as const, room: loadRoomSpec(spec) }
  }
}

describe('RoomStore port', () => {
  const spec = RoomSpecSchema.parse(throneRoom)

  it('saves and retrieves a validated room by its stable id', async () => {
    const store: RoomStore = new FakeRoomStore()
    expect(await store.saveRoom(spec)).toEqual({ ok: true })
    const got = await store.getRoom(spec.id)
    expect(got.ok && got.room.id).toBe(spec.id)
  })

  it('returns a typed not-found for an unknown id', async () => {
    const store: RoomStore = new FakeRoomStore()
    expect(await store.getRoom('missing-room')).toEqual({ ok: false, reason: 'not-found' })
  })
})
