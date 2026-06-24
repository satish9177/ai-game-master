import { describe, it, expect } from 'vitest'
import {
  GENERATED_ROOM,
  defaultGeneratedDimensions,
  clampGeneratedDimension,
  clampGeneratedShell,
  computePlayableBounds,
  isInsidePlayableBounds,
  isSpawnSafeAreaOverlap,
  classifyObjectImportance,
  repairGeneratedObjects,
} from './generatedRoomLayout'
import { loadRoomSpec } from './loadRoomSpec'
import { validateRoom, LIMITS } from './validateRoom'
import { fallbackRoom } from './examples/fallbackRoom'

/** Build a single validated RoomObject from a raw object literal. */
function loadSingleObject(obj: unknown) {
  const room = loadRoomSpec({
    schemaVersion: 1,
    id: 'tmp',
    name: 'tmp',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 0] },
    objects: [obj],
  })
  return room.objects[0]!
}

describe('GENERATED_ROOM constants', () => {
  it('default size is 18', () => {
    expect(GENERATED_ROOM.DEFAULT_SIZE).toBe(18)
  })
  it('min size is 14', () => {
    expect(GENERATED_ROOM.MIN_SIZE).toBe(14)
  })
  it('max size is 24', () => {
    expect(GENERATED_ROOM.MAX_SIZE).toBe(24)
  })
})

describe('defaultGeneratedDimensions', () => {
  it('returns 18 × 18 (default generated layout)', () => {
    expect(defaultGeneratedDimensions()).toEqual({ width: 18, depth: 18 })
  })
  it('is deterministic', () => {
    expect(defaultGeneratedDimensions()).toEqual(defaultGeneratedDimensions())
  })
})

describe('clampGeneratedDimension', () => {
  it('clamps a tiny room dimension to MIN_SIZE (14)', () => {
    expect(clampGeneratedDimension(2)).toBe(GENERATED_ROOM.MIN_SIZE)
    expect(clampGeneratedDimension(10)).toBe(GENERATED_ROOM.MIN_SIZE)
    expect(clampGeneratedDimension(13)).toBe(GENERATED_ROOM.MIN_SIZE)
  })
  it('preserves a dimension already inside [MIN_SIZE..MAX_SIZE]', () => {
    expect(clampGeneratedDimension(14)).toBe(14)
    expect(clampGeneratedDimension(18)).toBe(18)
    expect(clampGeneratedDimension(24)).toBe(24)
    expect(clampGeneratedDimension(20)).toBe(20)
  })
  it('clamps a too-large room dimension to MAX_SIZE (24)', () => {
    expect(clampGeneratedDimension(25)).toBe(GENERATED_ROOM.MAX_SIZE)
    expect(clampGeneratedDimension(50)).toBe(GENERATED_ROOM.MAX_SIZE)
    expect(clampGeneratedDimension(300)).toBe(GENERATED_ROOM.MAX_SIZE)
  })
  it('returns DEFAULT_SIZE for zero or negative inputs', () => {
    expect(clampGeneratedDimension(0)).toBe(GENERATED_ROOM.DEFAULT_SIZE)
    expect(clampGeneratedDimension(-5)).toBe(GENERATED_ROOM.DEFAULT_SIZE)
  })
  it('returns DEFAULT_SIZE for non-finite inputs', () => {
    expect(clampGeneratedDimension(Infinity)).toBe(GENERATED_ROOM.DEFAULT_SIZE)
    expect(clampGeneratedDimension(-Infinity)).toBe(GENERATED_ROOM.DEFAULT_SIZE)
    expect(clampGeneratedDimension(NaN)).toBe(GENERATED_ROOM.DEFAULT_SIZE)
  })
  it('is deterministic', () => {
    expect(clampGeneratedDimension(5)).toBe(clampGeneratedDimension(5))
    expect(clampGeneratedDimension(30)).toBe(clampGeneratedDimension(30))
    expect(clampGeneratedDimension(18)).toBe(clampGeneratedDimension(18))
  })
})

describe('computePlayableBounds', () => {
  it('respects wall margin using LIMITS.WALL_CLEARANCE', () => {
    const dims = { width: 18, depth: 18 }
    const wallThickness = 0.3
    const margin = wallThickness / 2 + LIMITS.WALL_CLEARANCE
    const bounds = computePlayableBounds(dims, wallThickness)
    expect(bounds.halfX).toBeCloseTo(18 / 2 - margin)
    expect(bounds.halfZ).toBeCloseTo(18 / 2 - margin)
  })
  it('valid object area is strictly smaller than the room half-extent', () => {
    const bounds = computePlayableBounds({ width: 18, depth: 18 }, 0.3)
    expect(bounds.halfX).toBeGreaterThan(0)
    expect(bounds.halfX).toBeLessThan(9) // 9 is the raw half-extent
    expect(bounds.halfZ).toBeGreaterThan(0)
    expect(bounds.halfZ).toBeLessThan(9)
  })
  it('never returns negative half-extents for degenerate dimensions', () => {
    const bounds = computePlayableBounds({ width: 0.1, depth: 0.1 }, 10)
    expect(bounds.halfX).toBe(0)
    expect(bounds.halfZ).toBe(0)
  })
  it('is deterministic', () => {
    const dims = { width: 18, depth: 18 }
    expect(computePlayableBounds(dims, 0.3)).toEqual(computePlayableBounds(dims, 0.3))
  })
})

describe('isInsidePlayableBounds', () => {
  const STD_BOUNDS = computePlayableBounds({ width: 18, depth: 18 }, 0.3)

  it('returns true for the room origin in a standard 18 × 18 room', () => {
    expect(isInsidePlayableBounds([0, 1.7, 0], STD_BOUNDS)).toBe(true)
  })
  it('returns false for a position far outside bounds (outside position is detected)', () => {
    expect(isInsidePlayableBounds([100, 1.7, 0], STD_BOUNDS)).toBe(false)
    expect(isInsidePlayableBounds([0, 1.7, -100], STD_BOUNDS)).toBe(false)
    expect(isInsidePlayableBounds([20, 1.7, 20], STD_BOUNDS)).toBe(false)
  })
  it('returns false for a position just beyond the wall margin', () => {
    expect(isInsidePlayableBounds([STD_BOUNDS.halfX + 0.01, 1.7, 0], STD_BOUNDS)).toBe(false)
    expect(isInsidePlayableBounds([0, 1.7, -(STD_BOUNDS.halfZ + 0.01)], STD_BOUNDS)).toBe(false)
  })
  it('returns true for a position exactly at the walkable boundary', () => {
    expect(isInsidePlayableBounds([STD_BOUNDS.halfX, 1.7, 0], STD_BOUNDS)).toBe(true)
    expect(isInsidePlayableBounds([0, 1.7, -STD_BOUNDS.halfZ], STD_BOUNDS)).toBe(true)
  })
  it('is deterministic', () => {
    const pos: [number, number, number] = [5, 1.7, -3]
    expect(isInsidePlayableBounds(pos, STD_BOUNDS)).toBe(isInsidePlayableBounds(pos, STD_BOUNDS))
  })
})

describe('isSpawnSafeAreaOverlap', () => {
  const SPAWN: [number, number, number] = [0, 1.7, 0]

  it('returns true for a position very close to spawn (overlap is detected)', () => {
    expect(isSpawnSafeAreaOverlap([0.1, 0, 0.1], SPAWN)).toBe(true)
    expect(isSpawnSafeAreaOverlap([0, 0, 0], SPAWN)).toBe(true)
  })
  it('returns false for a position well outside spawn clearance', () => {
    expect(isSpawnSafeAreaOverlap([5, 0, 5], SPAWN)).toBe(false)
    expect(isSpawnSafeAreaOverlap([-4, 0, 4], SPAWN)).toBe(false)
  })
  it('returns false at exactly SPAWN_CLEARANCE distance (strict less-than)', () => {
    expect(isSpawnSafeAreaOverlap([LIMITS.SPAWN_CLEARANCE, 0, 0], SPAWN)).toBe(false)
  })
  it('works correctly for a non-origin spawn', () => {
    const otherSpawn: [number, number, number] = [3, 1.7, -2]
    expect(isSpawnSafeAreaOverlap([3, 0, -2], otherSpawn)).toBe(true)
    expect(isSpawnSafeAreaOverlap([0, 0, 0], otherSpawn)).toBe(false)
  })
  it('is deterministic', () => {
    const pos: [number, number, number] = [0.5, 0, 0.5]
    expect(isSpawnSafeAreaOverlap(pos, SPAWN)).toBe(isSpawnSafeAreaOverlap(pos, SPAWN))
  })
})

describe('classifyObjectImportance', () => {
  it('npc is critical', () => {
    const obj = loadSingleObject({
      type: 'npc',
      name: 'Guard',
      position: [2, 0, -2],
      interaction: { key: 'F', prompt: 'Speak', body: 'Hello.' },
    })
    expect(classifyObjectImportance(obj)).toBe('critical')
  })
  it('scroll is critical', () => {
    const obj = loadSingleObject({
      type: 'scroll',
      position: [0, 0.5, 0],
      interaction: { key: 'E', prompt: 'Read', body: 'Text.' },
    })
    expect(classifyObjectImportance(obj)).toBe('critical')
  })
  it('arch without interaction is structural', () => {
    const obj = loadSingleObject({ type: 'arch', position: [0, 0, -8] })
    expect(classifyObjectImportance(obj)).toBe('structural')
  })
  it('arch with interaction is critical', () => {
    const obj = loadSingleObject({
      type: 'arch',
      position: [0, 0, -8],
      interaction: { key: 'E', prompt: 'Enter', exit: { toRoomId: 'next-room' } },
    })
    expect(classifyObjectImportance(obj)).toBe('critical')
  })
  it('pillar is structural', () => {
    const obj = loadSingleObject({ type: 'pillar', position: [4, 0, -4] })
    expect(classifyObjectImportance(obj)).toBe('structural')
  })
  it('throne is structural', () => {
    const obj = loadSingleObject({ type: 'throne', position: [0, 0, -7] })
    expect(classifyObjectImportance(obj)).toBe('structural')
  })
  it('torch is structural', () => {
    const obj = loadSingleObject({ type: 'torch', position: [4, 3, -4] })
    expect(classifyObjectImportance(obj)).toBe('structural')
  })
  it('prop is decorative', () => {
    const obj = loadSingleObject({ type: 'prop', position: [2, 0, 2] })
    expect(classifyObjectImportance(obj)).toBe('decorative')
  })
  it('rug is decorative', () => {
    const obj = loadSingleObject({ type: 'rug', position: [0, 0.01, 0] })
    expect(classifyObjectImportance(obj)).toBe('decorative')
  })
  it('crate without interaction is decorative', () => {
    const obj = loadSingleObject({ type: 'crate', position: [3, 0, 3] })
    expect(classifyObjectImportance(obj)).toBe('decorative')
  })
  it('crate with interaction is critical', () => {
    const obj = loadSingleObject({
      type: 'crate',
      position: [3, 0, 3],
      interaction: { key: 'E', prompt: 'Open crate', body: 'Empty.' },
    })
    expect(classifyObjectImportance(obj)).toBe('critical')
  })
  it('barrel without interaction is decorative', () => {
    const obj = loadSingleObject({ type: 'barrel', position: [-3, 0, 3] })
    expect(classifyObjectImportance(obj)).toBe('decorative')
  })
  it('zombie without interaction is decorative', () => {
    const obj = loadSingleObject({ type: 'zombie', position: [2, 0, 2] })
    expect(classifyObjectImportance(obj)).toBe('decorative')
  })
  it('is deterministic', () => {
    const obj = loadSingleObject({ type: 'pillar', position: [4, 0, -4] })
    expect(classifyObjectImportance(obj)).toBe(classifyObjectImportance(obj))
  })
})

describe('clampGeneratedShell', () => {
  it('returns the same reference when dimensions are already within [14..24]', () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'r', name: 'r',
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 0] }, objects: [],
    })
    expect(clampGeneratedShell(room)).toBe(room)
  })

  it('clamps a tiny room (width=5, depth=5) to MIN_SIZE (14)', () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'r', name: 'r',
      shell: { dimensions: { width: 5, depth: 5, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 0] }, objects: [],
    })
    const fixed = clampGeneratedShell(room)
    expect(fixed).not.toBe(room)
    expect(fixed.shell.dimensions.width).toBe(GENERATED_ROOM.MIN_SIZE)
    expect(fixed.shell.dimensions.depth).toBe(GENERATED_ROOM.MIN_SIZE)
  })

  it('clamps a huge room (width=50, depth=60) to MAX_SIZE (24)', () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'r', name: 'r',
      shell: { dimensions: { width: 50, depth: 60, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 0] }, objects: [],
    })
    const fixed = clampGeneratedShell(room)
    expect(fixed.shell.dimensions.width).toBe(GENERATED_ROOM.MAX_SIZE)
    expect(fixed.shell.dimensions.depth).toBe(GENERATED_ROOM.MAX_SIZE)
  })

  it('clamps each dimension independently (width out-of-contract, depth already valid)', () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'r', name: 'r',
      shell: { dimensions: { width: 5, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 0] }, objects: [],
    })
    const fixed = clampGeneratedShell(room)
    expect(fixed).not.toBe(room)
    expect(fixed.shell.dimensions.width).toBe(GENERATED_ROOM.MIN_SIZE) // 5 → 14
    expect(fixed.shell.dimensions.depth).toBe(18) // already in [14..24], untouched
  })

  it('does not clamp height (height is not constrained by the contract)', () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'r', name: 'r',
      shell: { dimensions: { width: 18, depth: 18, height: 10 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 0] }, objects: [],
    })
    expect(clampGeneratedShell(room).shell.dimensions.height).toBe(10)
  })

  it('preserves all other shell fields and objects unchanged', () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'preserve', name: 'Preserve',
      shell: {
        dimensions: { width: 5, depth: 5, height: 4 },
        floorColor: '#3c3a33',
        wallColor: '#5a5347',
        exits: [{ side: 'north', width: 3 }],
      },
      spawn: { position: [0, 1.7, 0] },
      objects: [{ type: 'pillar', position: [1, 0, -1] }],
    })
    const fixed = clampGeneratedShell(room)
    expect(fixed.shell.floorColor).toBe(room.shell.floorColor)
    expect(fixed.shell.wallColor).toBe(room.shell.wallColor)
    expect(fixed.shell.exits).toEqual(room.shell.exits)
    expect(fixed.objects).toEqual(room.objects)
    expect(fixed.spawn).toEqual(room.spawn)
    expect(fixed.id).toBe('preserve')
  })

  it('does not mutate the input room', () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'r', name: 'r',
      shell: { dimensions: { width: 5, depth: 5, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 0] }, objects: [],
    })
    const widthBefore = room.shell.dimensions.width
    clampGeneratedShell(room)
    expect(room.shell.dimensions.width).toBe(widthBefore)
  })

  it('handles non-positive dimensions defensively by returning DEFAULT_SIZE (18)', () => {
    // Construct a room with invalid dimensions bypassing schema validation — tests
    // the defensive branch in clampGeneratedDimension for robustness.
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'r', name: 'r',
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 0] }, objects: [],
    })
    const badRoom = {
      ...room,
      shell: { ...room.shell, dimensions: { width: 0, depth: 0, height: 4 } },
    }
    const fixed = clampGeneratedShell(badRoom)
    expect(fixed.shell.dimensions.width).toBe(GENERATED_ROOM.DEFAULT_SIZE)
    expect(fixed.shell.dimensions.depth).toBe(GENERATED_ROOM.DEFAULT_SIZE)
  })

  it('is deterministic', () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'r', name: 'r',
      shell: { dimensions: { width: 5, depth: 5, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 0] }, objects: [],
    })
    expect(clampGeneratedShell(room)).toEqual(clampGeneratedShell(room))
  })
})

/** Build a LoadedRoom with the given objects in an 18×18×4 shell. */
function makeRoom(objects: unknown[]) {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'test',
    name: 'test',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 0] },
    objects,
  })
}

describe('repairGeneratedObjects', () => {
  const STD_BOUNDS = computePlayableBounds({ width: 18, depth: 18 }, 0.3)

  it('returns the same reference when all objects are in bounds and count ≤ MAX_OBJECTS', () => {
    const room = makeRoom([{ type: 'pillar', position: [3, 0, -3] }])
    expect(repairGeneratedObjects(room)).toBe(room)
  })

  it('object outside room is clamped to the playable boundary', () => {
    const room = makeRoom([{ type: 'pillar', position: [100, 0, 0] }])
    const fixed = repairGeneratedObjects(room)
    expect(fixed).not.toBe(room)
    const [x, y, z] = fixed.objects[0]!.position
    expect(x).toBeCloseTo(STD_BOUNDS.halfX)
    expect(y).toBe(0) // y unchanged
    expect(z).toBe(0) // z was already 0
  })

  it('object outside on only the Z axis is clamped on Z only', () => {
    const room = makeRoom([{ type: 'crate', position: [3, 0, -50] }])
    const fixed = repairGeneratedObjects(room)
    const [x, , z] = fixed.objects[0]!.position
    expect(x).toBe(3) // x already in bounds, unchanged
    expect(z).toBeCloseTo(-STD_BOUNDS.halfZ)
  })

  it('object exactly at the playable boundary stays unchanged (same object reference)', () => {
    const room = makeRoom([{ type: 'pillar', position: [STD_BOUNDS.halfX, 0, 0] }])
    const fixed = repairGeneratedObjects(room)
    expect(fixed).toBe(room)
    expect(fixed.objects[0]).toBe(room.objects[0])
  })

  it('object near wall (just inside boundary) stays unchanged', () => {
    const room = makeRoom([{ type: 'pillar', position: [STD_BOUNDS.halfX - 0.01, 0, 0] }])
    expect(repairGeneratedObjects(room)).toBe(room)
  })

  it('object count is capped at GENERATED_ROOM.MAX_OBJECTS (30)', () => {
    const objects = Array.from({ length: 35 }, () => ({ type: 'crate', position: [2, 0, 2] }))
    const room = makeRoom(objects)
    const fixed = repairGeneratedObjects(room)
    expect(fixed).not.toBe(room)
    expect(fixed.objects).toHaveLength(GENERATED_ROOM.MAX_OBJECTS)
  })

  it('critical objects are preserved when dropping by count', () => {
    // 35 objects: 34 decorative (prop) + 1 critical (npc) — after cap to 30 the npc must survive.
    const objects: unknown[] = Array.from({ length: 34 }, () => ({
      type: 'prop',
      position: [2, 0, 2],
    }))
    objects.push({
      type: 'npc',
      name: 'Guard',
      position: [1, 0, -1],
      interaction: { key: 'F', prompt: 'Talk', body: 'Hello.' },
    })
    const room = makeRoom(objects)
    const fixed = repairGeneratedObjects(room)
    expect(fixed.objects).toHaveLength(GENERATED_ROOM.MAX_OBJECTS)
    const npc = fixed.objects.find((o) => o.type === 'npc')
    expect(npc).toBeDefined()
  })

  it('generated room remains valid (no fatals) after object repair', () => {
    const objects = Array.from({ length: 35 }, () => ({ type: 'crate', position: [100, 0, -100] }))
    const room = makeRoom(objects)
    const fixed = repairGeneratedObjects(room)
    expect(validateRoom(fixed).ok).toBe(true)
  })

  it('does not mutate the input room', () => {
    const room = makeRoom([{ type: 'pillar', position: [100, 0, 0] }])
    const xBefore = room.objects[0]!.position[0]
    repairGeneratedObjects(room)
    expect(room.objects[0]!.position[0]).toBe(xBefore)
  })

  it('is deterministic', () => {
    const room = makeRoom([{ type: 'pillar', position: [100, 0, -50] }])
    expect(repairGeneratedObjects(room)).toEqual(repairGeneratedObjects(room))
  })
})

describe('authored fallback room is unchanged by this slice', () => {
  it('fallback room validates with zero fatal issues', () => {
    const result = validateRoom(loadRoomSpec(fallbackRoom))
    expect(result.ok).toBe(true)
    expect(result.issues.filter((i) => i.severity === 'fatal')).toEqual([])
  })
  it('fallback room is pristine — zero warnings', () => {
    const result = validateRoom(loadRoomSpec(fallbackRoom))
    expect(result.issues).toEqual([])
  })
  it('fallback room dimensions are still 8 × 8 × 4 (unaffected by generated-room constants)', () => {
    const { dimensions } = loadRoomSpec(fallbackRoom).shell
    expect(dimensions.width).toBe(8)
    expect(dimensions.depth).toBe(8)
    expect(dimensions.height).toBe(4)
  })
})
