import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { SessionRoomCache } from './SessionRoomCache'

const room = loadRoomSpec({
  schemaVersion: 1,
  id: 'cached-room',
  name: 'Cached Room',
  shell: { dimensions: { width: 10, depth: 10, height: 4 } },
  spawn: { position: [0, 1.7, 3] },
  objects: [],
})

describe('SessionRoomCache', () => {
  it('misses, stores, and returns the identical LoadedRoom reference', () => {
    const cache = new SessionRoomCache()
    expect(cache.has(room.id)).toBe(false)
    expect(cache.get(room.id)).toBeUndefined()
    cache.set(room.id, room)
    expect(cache.has(room.id)).toBe(true)
    expect(cache.get(room.id)).toBe(room)
  })

  it('keeps cache instances isolated per session', () => {
    const first = new SessionRoomCache()
    const second = new SessionRoomCache()
    first.set(room.id, room)
    expect(first.has(room.id)).toBe(true)
    expect(second.has(room.id)).toBe(false)
  })
})
