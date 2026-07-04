import { describe, expect, it } from 'vitest'
import { deriveRoomVisualTheme } from './roomVisualTheme'
import { loadRoomSpec, type LoadedRoom } from './loadRoomSpec'
import type { RoomSpec } from './roomSpec'
import source from './roomVisualTheme.ts?raw'

function makeRoom(objects: unknown[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'theme-test-room',
    name: 'Theme Test Room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      wallThickness: 0.3,
      floorColor: '#4a4036',
      wallColor: '#6b6355',
      exits: [],
    },
    spawn: { position: [0, 0, 0], yaw: 0 },
    lighting: {
      ambient: { color: '#404858', intensity: 0.6 },
    },
    objects,
  } satisfies RoomSpec)
}

describe('deriveRoomVisualTheme', () => {
  it('derives fantasy-keep from a kingdom-like object mix', () => {
    const room = makeRoom([
      { type: 'throne', position: [0, 0, -4] },
      { type: 'altar', position: [-3, 0, -2] },
      { type: 'statue', position: [3, 0, -2] },
      { type: 'candle', position: [0, 0, 2] },
    ])

    expect(deriveRoomVisualTheme(room)).toBe('fantasy-keep')
  })

  it('derives post-apoc from a sci-fi or space-like object mix using the supported vocabulary', () => {
    const room = makeRoom([
      { type: 'machine', position: [0, 0, -3] },
      { type: 'barrel', position: [-3, 0, 1] },
      { type: 'crate', position: [3, 0, 1] },
      { type: 'machine', position: [0, 0, 3] },
    ])

    expect(deriveRoomVisualTheme(room)).toBe('post-apoc')
  })

  it('derives post-apoc from a horror or ruin-like object mix using the supported vocabulary', () => {
    const room = makeRoom([
      { type: 'corpse', position: [0, 0, -2] },
      { type: 'debris', position: [-3, 0, 1] },
      { type: 'barricade', position: [3, 0, 1] },
      { type: 'zombie', position: [0, 0, 3] },
    ])

    expect(deriveRoomVisualTheme(room)).toBe('post-apoc')
  })

  it('returns null for weak, ambiguous, or mixed object signals', () => {
    expect(deriveRoomVisualTheme(makeRoom([
      { type: 'machine', position: [0, 0, 0] },
      { type: 'table', position: [2, 0, 0] },
    ]))).toBeNull()

    expect(deriveRoomVisualTheme(makeRoom([
      { type: 'throne', position: [0, 0, -3] },
      { type: 'altar', position: [-3, 0, 0] },
      { type: 'machine', position: [3, 0, 0] },
      { type: 'barrel', position: [0, 0, 3] },
    ]))).toBeNull()
  })

  it('returns null for authored or minimal rooms', () => {
    expect(deriveRoomVisualTheme(makeRoom([]))).toBeNull()
    expect(deriveRoomVisualTheme(makeRoom([
      { type: 'table', position: [0, 0, -2] },
      { type: 'book', position: [0, 0, 0] },
      { type: 'paper', position: [0, 0, 2] },
    ]))).toBeNull()
  })

  it('does not throw on unknown object types and ignores skipped raw objects', () => {
    const room = makeRoom([
      { type: 'spaceship', position: [0, 0, -2] },
      { type: 'dragon-hoard', position: [0, 0, 2] },
    ])

    expect(room.skippedObjectReasonCounts.unknownType).toBe(2)
    expect(() => deriveRoomVisualTheme(room)).not.toThrow()
    expect(deriveRoomVisualTheme(room)).toBeNull()
  })

  it('does not mutate input', () => {
    const room = makeRoom([
      { type: 'throne', position: [0, 0, -4] },
      { type: 'altar', position: [-3, 0, -2] },
      { type: 'statue', position: [3, 0, -2] },
    ])
    const before = structuredClone(room)

    deriveRoomVisualTheme(room)

    expect(room).toEqual(before)
  })

  it('is deterministic', () => {
    const room = makeRoom([
      { type: 'machine', position: [0, 0, -3] },
      { type: 'barrel', position: [-3, 0, 1] },
      { type: 'crate', position: [3, 0, 1] },
    ])

    expect(deriveRoomVisualTheme(room)).toBe(deriveRoomVisualTheme(room))
  })

  it('does not import forbidden renderer, app, memory, persistence, provider, dialogue, or FTS modules', () => {
    expect(source).not.toContain('renderer/')
    expect(source).not.toContain('App')
    expect(source).not.toContain('memory')
    expect(source).not.toContain('persistence')
    expect(source).not.toContain('provider')
    expect(source).not.toContain('dialogue')
    expect(source).not.toContain('fts')
    expect(source).not.toContain('FTS')
  })
})
