import { describe, expect, it } from 'vitest'
import { RoomRegistry } from './RoomRegistry'

describe('RoomRegistry', () => {
  it('resolves both known example rooms through loadRoomSpec', () => {
    const registry = new RoomRegistry()
    const throne = registry.resolve('throne-room')
    const ruined = registry.resolve('ruined-safehouse')
    expect(throne.ok && throne.room.id).toBe('throne-room')
    expect(ruined.ok && ruined.room.id).toBe('ruined-safehouse')
    expect(throne.ok && throne.room.skipped).toEqual([])
    expect(throne.ok && throne.room.warnings).toEqual([])
    expect(ruined.ok && ruined.room.skipped).toEqual([])
    expect(ruined.ok && ruined.room.warnings).toEqual([])
  })

  it('returns typed unknown-room and invalid-room failures', () => {
    const registry = new RoomRegistry({ broken: { schemaVersion: 1, id: 'broken' } })
    expect(registry.resolve('missing')).toEqual({ ok: false, reason: 'unknown-room' })
    expect(registry.resolve('broken')).toEqual({ ok: false, reason: 'invalid-room' })
  })
})
