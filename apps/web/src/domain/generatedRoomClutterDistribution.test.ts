import { describe, expect, it } from 'vitest'
import {
  distributeGeneratedClutter,
  generatedClutterSectorForTesting,
  MAX_DECORATIVE_PER_SECTOR,
} from './generatedRoomClutterDistribution'
import { COMPOSITION } from './generatedRoomComposition'
import {
  classifyObjectImportance,
  computePlayableBounds,
  objectFootprintRadius,
} from './generatedRoomLayout'
import { loadRoomSpec, type LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'
import source from './generatedRoomClutterDistribution.ts?raw'

function makeRoom(objects: unknown[], overrides: Record<string, unknown> = {}): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'clutter-distribution-test-room',
    name: 'Clutter Distribution Test Room',
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

function crate(index: number, position: [number, number, number] = [-7, 0, -7]): unknown {
  return { type: 'crate', id: `crate-${index}`, position }
}

function movableDecorativeObjects(room: LoadedRoom): RoomObject[] {
  return room.objects.filter((object) => classifyObjectImportance(object) === 'decorative')
}

function movableSectorCounts(room: LoadedRoom): number[] {
  const counts = Array.from({ length: 9 }, () => 0)
  for (const object of movableDecorativeObjects(room)) {
    counts[generatedClutterSectorForTesting(room, object)]! += 1
  }
  return counts
}

function movedObjectIds(before: LoadedRoom, after: LoadedRoom): string[] {
  const ids: string[] = []
  for (let i = 0; i < before.objects.length; i += 1) {
    if (before.objects[i]!.position[0] !== after.objects[i]!.position[0]
      || before.objects[i]!.position[2] !== after.objects[i]!.position[2]) {
      ids.push(before.objects[i]!.id ?? `${i}`)
    }
  }
  return ids
}

function expectMovedObjectsInBounds(before: LoadedRoom, after: LoadedRoom): void {
  const bounds = computePlayableBounds(after.shell.dimensions, after.shell.wallThickness)
  for (let i = 0; i < before.objects.length; i += 1) {
    const original = before.objects[i]!
    const moved = after.objects[i]!
    if (original.position[0] === moved.position[0] && original.position[2] === moved.position[2]) continue
    const radius = objectFootprintRadius(moved)
    expect(Math.abs(moved.position[0])).toBeLessThanOrEqual(Math.max(0, bounds.halfX - radius))
    expect(Math.abs(moved.position[2])).toBeLessThanOrEqual(Math.max(0, bounds.halfZ - radius))
  }
}

describe('distributeGeneratedClutter', () => {
  it('spreads a corner trash pile of decorative clutter under the per-sector cap', () => {
    const room = makeRoom(Array.from({ length: 10 }, (_, i) => crate(i)))

    const result = distributeGeneratedClutter(room)

    expect(result).not.toBe(room)
    expect(result.objects).toHaveLength(room.objects.length)
    expect(Math.max(...movableSectorCounts(result))).toBeLessThanOrEqual(MAX_DECORATIVE_PER_SECTOR)
  })

  it('returns the same room reference and logical output for already distributed input', () => {
    const room = makeRoom([
      crate(0, [-7, 0, -7]),
      crate(1, [-6, 0, -6]),
      crate(2, [-5, 0, -5]),
      crate(3, [-4.5, 0, -4.5]),
    ])

    const result = distributeGeneratedClutter(room)

    expect(result).toBe(room)
    expect(result).toEqual(room)
  })

  it('does not add, delete, reorder, or mutate objects', () => {
    const room = makeRoom(Array.from({ length: 7 }, (_, i) => crate(i)))
    const before = structuredClone(room)

    const result = distributeGeneratedClutter(room)

    expect(room).toEqual(before)
    expect(result.objects).toHaveLength(room.objects.length)
    expect(result.objects.map((object) => object.id)).toEqual(room.objects.map((object) => object.id))
  })

  it('moves overflow in highest original index order first', () => {
    const room = makeRoom(Array.from({ length: 6 }, (_, i) => crate(i)))

    const result = distributeGeneratedClutter(room)

    expect(movedObjectIds(room, result)).toEqual(['crate-4', 'crate-5'])
  })

  it('protects the selected story anchor, exits, torches, NPCs, interactables, and structural objects', () => {
    const room = makeRoom([
      { type: 'corpse', id: 'anchor-corpse', position: [-7, 0, -7] },
      {
        type: 'arch',
        id: 'exit-arch',
        position: [-6.8, 0, -7],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'next-room' } },
      },
      { type: 'torch', id: 'wall-light', position: [-6.6, 2.2, -7] },
      {
        type: 'npc',
        id: 'npc',
        name: 'Guide',
        position: [-6.4, 0, -7],
        interaction: { key: 'F', prompt: 'Talk' },
      },
      {
        type: 'book',
        id: 'interactable-book',
        position: [-6.2, 0, -7],
        interaction: { key: 'E', prompt: 'Read' },
      },
      { type: 'pillar', id: 'pillar', position: [-6, 0, -7] },
      ...Array.from({ length: 8 }, (_, i) => crate(i, [-7 + i * 0.05, 0, -6.8])),
    ])

    const result = distributeGeneratedClutter(room, { storyKind: 'survive' })

    for (let i = 0; i < 6; i += 1) {
      expect(result.objects[i]).toEqual(room.objects[i])
    }
  })

  it('does not move structural or critical objects as decorative clutter', () => {
    const room = makeRoom([
      { type: 'arch', id: 'plain-arch', position: [-7, 0, -7] },
      { type: 'throne', id: 'throne', position: [-6.8, 0, -7] },
      { type: 'scroll', id: 'scroll', position: [-6.6, 0, -7], interaction: { key: 'E', prompt: 'Read' } },
      ...Array.from({ length: 8 }, (_, i) => crate(i, [-7 + i * 0.05, 0, -6.8])),
    ])

    const result = distributeGeneratedClutter(room)

    expect(result.objects[0]).toEqual(room.objects[0])
    expect(result.objects[1]).toEqual(room.objects[1])
    expect(result.objects[2]).toEqual(room.objects[2])
  })

  it('keeps moved objects inside footprint-adjusted playable bounds', () => {
    const room = makeRoom(Array.from({ length: 12 }, (_, i) => crate(i)))

    const result = distributeGeneratedClutter(room)

    expectMovedObjectsInBounds(room, result)
  })

  it('does not use center or north-center sectors as relocation targets', () => {
    const room = makeRoom(Array.from({ length: 12 }, (_, i) => crate(i)))

    const result = distributeGeneratedClutter(room)

    for (let i = 0; i < room.objects.length; i += 1) {
      if (room.objects[i]!.position[0] === result.objects[i]!.position[0]
        && room.objects[i]!.position[2] === result.objects[i]!.position[2]) continue
      expect(generatedClutterSectorForTesting(result, result.objects[i]!)).not.toBe(1)
      expect(generatedClutterSectorForTesting(result, result.objects[i]!)).not.toBe(4)
    }
  })

  it('respects the corridor band for every relocated slot', () => {
    const room = makeRoom(Array.from({ length: 12 }, (_, i) => crate(i)))

    const result = distributeGeneratedClutter(room)

    for (let i = 0; i < room.objects.length; i += 1) {
      if (room.objects[i]!.position[0] === result.objects[i]!.position[0]
        && room.objects[i]!.position[2] === result.objects[i]!.position[2]) continue
      expect(Math.abs(result.objects[i]!.position[0])).toBeGreaterThanOrEqual(COMPOSITION.CORRIDOR_HALF)
    }
  })

  it('uses south-center only when a non-corridor slot is valid', () => {
    const normalRoom = makeRoom([
      ...Array.from({ length: 8 }, (_, i) => crate(i)),
      ...Array.from({ length: MAX_DECORATIVE_PER_SECTOR }, (_, i) => crate(10 + i, [6, 0, -6])),
      ...Array.from({ length: MAX_DECORATIVE_PER_SECTOR }, (_, i) => crate(20 + i, [-6, 0, 1])),
      ...Array.from({ length: MAX_DECORATIVE_PER_SECTOR }, (_, i) => crate(30 + i, [-6, 0, 6])),
    ])
    const wideRoom = makeRoom(normalRoom.objects, {
      shell: {
        dimensions: { width: 30, depth: 30, height: 4 },
        wallThickness: 0.3,
        exits: [{ side: 'north', width: 3 }],
      },
    })

    const normalResult = distributeGeneratedClutter(normalRoom)
    const wideResult = distributeGeneratedClutter(wideRoom)

    expect(movedObjectIds(normalRoom, normalResult).some((id) => {
      const object = normalResult.objects.find((candidate) => candidate.id === id)!
      return generatedClutterSectorForTesting(normalResult, object) === 7
    })).toBe(false)
    expect(movedObjectIds(wideRoom, wideResult).some((id) => {
      const object = wideResult.objects.find((candidate) => candidate.id === id)!
      return generatedClutterSectorForTesting(wideResult, object) === 7
        && Math.abs(object.position[0]) >= COMPOSITION.CORRIDOR_HALF
    })).toBe(true)
  })

  it('uses same-type count as a target tie-break', () => {
    const room = makeRoom([
      ...Array.from({ length: 5 }, (_, i) => crate(i)),
      { type: 'crate', id: 'north-east-crate', position: [6, 0, -6] },
    ])

    const result = distributeGeneratedClutter(room)
    const moved = result.objects.find((object) => object.id === 'crate-4')!

    expect(generatedClutterSectorForTesting(result, moved)).toBe(3)
  })

  it('accepts residual crowding when decorative count exceeds available capacity', () => {
    const room = makeRoom(Array.from({ length: 30 }, (_, i) => crate(i)))

    const result = distributeGeneratedClutter(room)

    expect(result.objects).toHaveLength(room.objects.length)
    expect(movableDecorativeObjects(result)).toHaveLength(movableDecorativeObjects(room).length)
    expect(movableSectorCounts(result).some((count) => count > MAX_DECORATIVE_PER_SECTOR)).toBe(true)
  })

  it('is deterministic', () => {
    const room = makeRoom(Array.from({ length: 16 }, (_, i) => crate(i)))

    expect(distributeGeneratedClutter(room)).toEqual(distributeGeneratedClutter(room))
  })

  it('returns the same reference for degenerate bounds', () => {
    const room = makeRoom(Array.from({ length: 8 }, (_, i) => crate(i)), {
      shell: {
        dimensions: { width: 0.2, depth: 0.2, height: 4 },
        wallThickness: 0.3,
        exits: [{ side: 'north', width: 3 }],
      },
    })

    expect(distributeGeneratedClutter(room)).toBe(room)
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
