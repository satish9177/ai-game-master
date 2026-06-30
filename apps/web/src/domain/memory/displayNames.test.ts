import { describe, expect, it } from 'vitest'

import { createDisplayNameResolver } from './displayNames'
import { EntitySnapshotsSchema, MAX_DISPLAY_NAME_CHARS } from './recallMetadata'

describe('createDisplayNameResolver', () => {
  const resolver = createDisplayNameResolver({
    room: { room_library_3a: 'Old Library', crypt: 'The Crypt' },
    npc: { 'npc-1': 'Elara' },
  })

  it('resolves a known id to a bounded { id, displayName } snapshot', () => {
    expect(resolver.resolve('room', 'room_library_3a')).toEqual({
      id: 'room_library_3a',
      displayName: 'Old Library',
    })
    expect(resolver.resolve('npc', 'npc-1')).toEqual({ id: 'npc-1', displayName: 'Elara' })
  })

  it('returns null for an unknown id or unknown kind (caller keeps generic text)', () => {
    expect(resolver.resolve('room', 'unknown-room')).toBeNull()
    expect(resolver.resolve('item', 'anything')).toBeNull()
  })

  it('never fabricates a display name from the raw id for an unknown id', () => {
    const out = resolver.resolve('room', 'room_secret_internal_id')
    expect(out).toBeNull()
  })

  it('returns null for a blank id or a blank/whitespace name', () => {
    const r = createDisplayNameResolver({ room: { blank: '   ' } })
    expect(r.resolve('room', '   ')).toBeNull()
    expect(r.resolve('room', 'blank')).toBeNull()
  })

  it('trims and bounds an over-long display name to MAX_DISPLAY_NAME_CHARS', () => {
    const long = 'x'.repeat(MAX_DISPLAY_NAME_CHARS + 50)
    const r = createDisplayNameResolver({ room: { big: `  ${long}  ` } })
    const out = r.resolve('room', 'big')
    expect(out?.displayName.length).toBe(MAX_DISPLAY_NAME_CHARS)
  })

  it('returns null when the id is too long to store as a bounded snapshot', () => {
    const tooLong = 'a'.repeat(MAX_DISPLAY_NAME_CHARS + 1)
    const r = createDisplayNameResolver({ room: { [tooLong]: 'Name' } })
    expect(r.resolve('room', tooLong)).toBeNull()
  })

  it('produces snapshots that satisfy EntitySnapshotsSchema', () => {
    const out = resolver.resolve('room', 'crypt')
    expect(out).not.toBeNull()
    expect(EntitySnapshotsSchema.safeParse({ room: out }).success).toBe(true)
  })

  it('is pure: resolving does not mutate the injected snapshot lookup', () => {
    const snapshots = { room: { a: 'A' } }
    const snapshot = structuredClone(snapshots)
    const r = createDisplayNameResolver(snapshots)
    r.resolve('room', 'a')
    expect(snapshots).toEqual(snapshot)
  })
})
