import { describe, expect, it } from 'vitest'
import { buildAdjacentRoomSeed } from './buildAdjacentRoomSeed'

describe('buildAdjacentRoomSeed', () => {
  it('puts the theme seed before the structural salt', () => {
    const seed = buildAdjacentRoomSeed('room-north-1', 'The Ember Crown | fantasy-keep')

    expect(seed).toBe('The Ember Crown | fantasy-keep | adjacent:room-north-1')
    expect(seed.indexOf('The Ember Crown | fantasy-keep')).toBeLessThan(
      seed.indexOf('adjacent:room-north-1'),
    )
    expect(seed).toContain('adjacent:room-north-1')
  })

  it('returns the current structural seed byte-for-byte without a theme seed', () => {
    expect(buildAdjacentRoomSeed('room-north-1')).toBe('adjacent:room-north-1')
  })

  it('puts the theme and story phrase before the structural salt', () => {
    expect(
      buildAdjacentRoomSeed(
        'room-north-1',
        'fantasy-keep | mysterious | embers',
        'investigation | early clues',
      ),
    ).toBe(
      'fantasy-keep | mysterious | embers | investigation | early clues | adjacent:room-north-1',
    )
  })

  it('puts the story phrase before the structural salt when no theme seed exists', () => {
    expect(
      buildAdjacentRoomSeed('room-north-1', undefined, 'investigation | early clues'),
    ).toBe('investigation | early clues | adjacent:room-north-1')
  })

  it('keeps previous theme behavior byte-for-byte when story phrase is absent', () => {
    expect(buildAdjacentRoomSeed('room-north-1', 'The Ember Crown | fantasy-keep')).toBe(
      'The Ember Crown | fantasy-keep | adjacent:room-north-1',
    )
    expect(buildAdjacentRoomSeed('room-north-1', 'The Ember Crown | fantasy-keep', '')).toBe(
      'The Ember Crown | fantasy-keep | adjacent:room-north-1',
    )
    expect(
      buildAdjacentRoomSeed('room-north-1', 'The Ember Crown | fantasy-keep', '   \t\n  '),
    ).toBe('The Ember Crown | fantasy-keep | adjacent:room-north-1')
  })

  it('returns the current structural seed for an empty theme seed', () => {
    expect(buildAdjacentRoomSeed('room-north-1', '')).toBe('adjacent:room-north-1')
  })

  it('returns the current structural seed for a whitespace-only theme seed', () => {
    expect(buildAdjacentRoomSeed('room-north-1', '   \t\n  ')).toBe('adjacent:room-north-1')
  })

  it('keeps distinct room ids distinct with the same theme seed', () => {
    const themeSeed = 'The Ember Crown | fantasy-keep'

    expect(buildAdjacentRoomSeed('room-north-1', themeSeed)).not.toBe(
      buildAdjacentRoomSeed('room-south-1', themeSeed),
    )
  })

  it('is deterministic for the same inputs', () => {
    expect(buildAdjacentRoomSeed('room-north-1', 'The Ember Crown | fantasy-keep')).toBe(
      buildAdjacentRoomSeed('room-north-1', 'The Ember Crown | fantasy-keep'),
    )
  })

  it('does not mutate input strings or depend on global state', () => {
    const roomId = 'room-north-1'
    const themeSeed = 'The Ember Crown | fantasy-keep'
    const beforeRoomId = roomId.slice()
    const beforeThemeSeed = themeSeed.slice()

    const first = buildAdjacentRoomSeed(roomId, themeSeed)
    const second = buildAdjacentRoomSeed(roomId, themeSeed)

    expect(roomId).toBe(beforeRoomId)
    expect(themeSeed).toBe(beforeThemeSeed)
    expect(second).toBe(first)
  })
})
