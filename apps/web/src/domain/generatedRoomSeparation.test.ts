import { describe, expect, it } from 'vitest'
import {
  objectFootprintsOverlap,
  separateGeneratedObjects,
} from './generatedRoomSeparation'
import { computePlayableBounds, objectFootprintRadius } from './generatedRoomLayout'
import { loadRoomSpec, type LoadedRoom } from './loadRoomSpec'
import type { RoomObject, RoomSpec } from './roomSpec'
import source from './generatedRoomSeparation.ts?raw'

function makeRoom(objects: unknown[], overrides: Partial<RoomSpec> = {}): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'separation-test-room',
    name: 'Separation Test Room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      wallThickness: 0.3,
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 5], yaw: 0 },
    objects,
    ...overrides,
  })
}

function overlapCount(objects: RoomObject[]): number {
  let count = 0
  for (let i = 0; i < objects.length; i += 1) {
    for (let j = i + 1; j < objects.length; j += 1) {
      if (objectFootprintsOverlap(objects[i]!, objects[j]!)) count += 1
    }
  }
  return count
}

function expectObjectsInBounds(room: LoadedRoom): void {
  const bounds = computePlayableBounds(room.shell.dimensions, room.shell.wallThickness)
  for (const object of room.objects) {
    const radius = objectFootprintRadius(object)
    expect(Math.abs(object.position[0])).toBeLessThanOrEqual(Math.max(0, bounds.halfX - radius))
    expect(Math.abs(object.position[2])).toBeLessThanOrEqual(Math.max(0, bounds.halfZ - radius))
  }
}

describe('separateGeneratedObjects', () => {
  it('detects pairwise footprint overlaps', () => {
    const room = makeRoom([
      { type: 'crate', position: [0, 0, 0] },
      { type: 'crate', position: [0.25, 0, 0] },
      { type: 'crate', position: [5, 0, 0] },
    ])

    expect(objectFootprintsOverlap(room.objects[0]!, room.objects[1]!)).toBe(true)
    expect(objectFootprintsOverlap(room.objects[0]!, room.objects[2]!)).toBe(false)
  })

  it('leaves no-overlap input as the same logical room and object reference', () => {
    const room = makeRoom([
      { type: 'crate', position: [-5, 0, 0] },
      { type: 'barrel', position: [0, 0, 0] },
      { type: 'prop', position: [5, 0, 0] },
    ])

    const result = separateGeneratedObjects(room)

    expect(result).toBe(room)
    expect(result).toEqual(room)
  })

  it('separates overlapping decorative props without deleting objects', () => {
    const room = makeRoom([
      { type: 'crate', position: [0, 0, 0] },
      { type: 'crate', position: [0, 0, 0] },
    ])

    const result = separateGeneratedObjects(room)

    expect(result.objects).toHaveLength(room.objects.length)
    expect(overlapCount(result.objects)).toBe(0)
    expect(result.objects[0]).toBe(room.objects[0])
    expect(result.objects[1]).not.toBe(room.objects[1])
  })

  it('preserves critical and protected objects without deletion', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Read' },
      },
      {
        type: 'npc',
        name: 'Guide',
        position: [0, 0, 0],
        interaction: { key: 'F', prompt: 'Talk' },
      },
      { type: 'crate', position: [0, 0, 0] },
    ])

    const result = separateGeneratedObjects(room)

    expect(result.objects).toHaveLength(3)
    expect(result.objects.map((object) => object.type)).toEqual(['scroll', 'npc', 'crate'])
  })

  it('does not delete objects when bounded repair cannot fully resolve crowding', () => {
    const room = makeRoom(
      Array.from({ length: 10 }, () => ({ type: 'crate', position: [0, 0, 0], size: [4, 1, 4] })),
    )

    const result = separateGeneratedObjects(room)

    expect(result.objects).toHaveLength(room.objects.length)
    expect(overlapCount(result.objects)).toBeLessThanOrEqual(overlapCount(room.objects))
  })

  it('does not throw on unknown or edge object sets', () => {
    const unknownOnly = makeRoom([
      { type: 'unknown-generator-object', position: [0, 0, 0] },
    ])
    const empty = makeRoom([])
    const frozenOnly = makeRoom([
      {
        type: 'arch',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'next-room' } },
      },
      { type: 'torch', position: [0, 2.2, 0] },
    ])

    expect(() => separateGeneratedObjects(unknownOnly)).not.toThrow()
    expect(() => separateGeneratedObjects(empty)).not.toThrow()
    expect(() => separateGeneratedObjects(frozenOnly)).not.toThrow()
  })

  it('is deterministic and does not mutate input', () => {
    const room = makeRoom([
      { type: 'crate', position: [0, 0, 0] },
      { type: 'barrel', position: [0, 0, 0] },
      { type: 'prop', position: [0, 0, 0] },
    ])
    const before = structuredClone(room)

    const first = separateGeneratedObjects(room)
    const second = separateGeneratedObjects(room)

    expect(first).toEqual(second)
    expect(room).toEqual(before)
  })

  it('keeps repaired objects inside playable bounds', () => {
    const room = makeRoom([
      { type: 'crate', position: [7.5, 0, 7.5] },
      { type: 'barrel', position: [7.5, 0, 7.5] },
      { type: 'prop', position: [7.5, 0, 7.5] },
    ])

    const result = separateGeneratedObjects(room)

    expectObjectsInBounds(result)
  })

  it('keeps story anchors, exit objects, and wall-light objects fixed while moving lower-priority props', () => {
    const room = makeRoom([
      { type: 'throne', position: [0, 0, -6] },
      {
        type: 'arch',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'next-room' } },
      },
      { type: 'torch', position: [0, 2.2, 0] },
      { type: 'crate', position: [0, 0, 0] },
    ])

    const result = separateGeneratedObjects(room)

    expect(result.objects[0]!.position).toEqual(room.objects[0]!.position)
    expect(result.objects[1]!.position).toEqual(room.objects[1]!.position)
    expect(result.objects[2]!.position).toEqual(room.objects[2]!.position)
    expect(result.objects[3]!.position).not.toEqual(room.objects[3]!.position)
    expect(result.objects).toHaveLength(room.objects.length)
  })

  it('does not import forbidden renderer, App, provider, memory, persistence, dialogue, or FTS modules', () => {
    expect(source).not.toContain('renderer/')
    expect(source).not.toContain('App')
    expect(source).not.toContain('provider')
    expect(source).not.toContain('memory')
    expect(source).not.toContain('persistence')
    expect(source).not.toContain('dialogue')
    expect(source).not.toContain('fts')
    expect(source).not.toContain('FTS')
  })
})
