import { describe, it, expect } from 'vitest'
import { repairRoom } from './repairRoom'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import { validateRoom, LIMITS } from './validateRoom'
import { fallbackRoom } from './examples/fallbackRoom'

/** Build a LoadedRoom from a minimal valid 8×8×4 envelope with overridable bits. */
function makeRoom(overrides: {
  spawn?: [number, number, number]
  objects?: unknown[]
}): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'test-room',
    name: 'Test Room',
    shell: {
      dimensions: { width: 8, depth: 8, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: overrides.spawn ?? [0, 1.7, 0] },
    objects: overrides.objects ?? [],
  })
}

const pillar = () => ({ type: 'pillar', position: [0, 0, 0] })
const torch = () => ({ type: 'torch', position: [0, 3, 0] })

describe('repairRoom', () => {
  it('clamps an out-of-bounds spawn into the walkable AABB', () => {
    const room = makeRoom({ spawn: [100, 1.7, -100] })
    const margin = room.shell.wallThickness / 2 + LIMITS.WALL_CLEARANCE
    const maxX = 8 / 2 - margin
    const maxZ = 8 / 2 - margin

    const repaired = repairRoom(room)

    expect(repaired.spawn.position).toEqual([maxX, 1.7, -maxZ])
    // The clamp actually satisfies the validator: the fatal is gone.
    const stillOob = validateRoom(repaired).issues.some(
      (issue) => issue.code === 'spawn-out-of-bounds',
    )
    expect(stillOob).toBe(false)
  })

  it('leaves an in-bounds spawn untouched', () => {
    const room = makeRoom({ spawn: [1, 1.7, -2] })
    expect(repairRoom(room).spawn.position).toEqual([1, 1.7, -2])
  })

  it('truncates objects beyond the hard object budget', () => {
    const objects = Array.from({ length: LIMITS.MAX_OBJECTS_HARD + 5 }, pillar)
    const room = makeRoom({ objects })
    expect(room.objects).toHaveLength(LIMITS.MAX_OBJECTS_HARD + 5)

    expect(repairRoom(room).objects).toHaveLength(LIMITS.MAX_OBJECTS_HARD)
  })

  it('drops torches beyond the hard light budget, keeping non-torch objects', () => {
    const torches = Array.from({ length: LIMITS.MAX_LIGHTS_HARD + 3 }, torch)
    const room = makeRoom({ objects: [pillar(), ...torches] })

    const repaired = repairRoom(room)
    const torchCount = repaired.objects.filter((o) => o.type === 'torch').length
    const pillarCount = repaired.objects.filter((o) => o.type === 'pillar').length

    expect(torchCount).toBe(LIMITS.MAX_LIGHTS_HARD)
    expect(pillarCount).toBe(1)
  })

  it('is deterministic', () => {
    const room = makeRoom({
      spawn: [100, 1.7, -100],
      objects: Array.from({ length: 5 }, pillar),
    })
    expect(repairRoom(room)).toEqual(repairRoom(room))
  })

  it('does not mutate the input room', () => {
    const objects = Array.from({ length: LIMITS.MAX_OBJECTS_HARD + 2 }, pillar)
    const room = makeRoom({ spawn: [100, 1.7, -100], objects })
    const spawnBefore = [...room.spawn.position]
    const lengthBefore = room.objects.length

    repairRoom(room)

    expect(room.spawn.position).toEqual(spawnBefore)
    expect(room.objects).toHaveLength(lengthBefore)
  })

  it('returns an equivalent room when nothing needs repair', () => {
    const room = loadRoomSpec(fallbackRoom)
    expect(repairRoom(room)).toEqual(room)
  })
})
