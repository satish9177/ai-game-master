import { describe, it, expect } from 'vitest'
import { assembleRoom } from './assembleRoom'
import type { RoomDiagnostics } from './assembleRoom'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import { validateRoom } from './validateRoom'
import { fallbackRoom } from './examples/fallbackRoom'

/** The trusted, pre-validated fallback the pipeline falls back to. */
const fallback: LoadedRoom = loadRoomSpec(fallbackRoom)

/** A fully valid 8×8×4 generated room, with overridable envelope parts. */
function validSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'gen-room',
    name: 'Generated Room',
    shell: {
      dimensions: { width: 8, depth: 8, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 0] },
    objects: [],
    ...overrides,
  }
}

const raw = (spec: unknown): string => JSON.stringify(spec)

// Raw inputs covering every branch, reused by the matrix / safety tests.
const RAW_INVALID_JSON = '{ this is not valid json'
const RAW_INVALID_SCHEMA = raw({ not: 'a room' })
// Dimensions within the generated-room contract [14..24] so no dimension repair
// fires and provenance stays 'generated'.
const RAW_VALID = raw(
  validSpec({ shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] } }),
)
// Spawn far outside an 18×18 room → clamped by repairGeneratedSpawn (Stage 2.7).
// After Slice 4, Stage 2.7 fixes this before the validator runs, so provenance
// stays 'generated' (benign normalization, not a real repair).
const RAW_REPAIRABLE = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    spawn: { position: [100, 1.7, 0] },
  }),
)
// height=400 exceeds LIMITS.MAX_ROOM_DIM (300) → room-too-large fatal.
// clampGeneratedShell does not touch height, and repairRoom does not resize
// dimensions, so this fatal is genuinely unrepairable → fallback.
const RAW_UNREPAIRABLE = raw(
  validSpec({ shell: { dimensions: { width: 18, depth: 18, height: 400 }, exits: [{ side: 'north', width: 3 }] } }),
)
// Spawn oob (fixed at Stage 2.7) AND unrepairable height=400 (room-too-large):
// after spawn is clamped the height fatal still survives Stage 3, repairRoom
// cannot fix it → fallback. Spawn no longer appears in initialFatalCodes.
const RAW_REPAIR_THEN_FAIL = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 400 }, exits: [{ side: 'north', width: 3 }] },
    spawn: { position: [100, 1.7, 0] },
  }),
)
// Generated rooms with out-of-contract dimensions should be clamped and
// returned as "generated" because size normalization is benign.
const RAW_TINY_DIMS = raw(
  validSpec({ shell: { dimensions: { width: 5, depth: 5, height: 4 }, exits: [{ side: 'north', width: 3 }] } }),
)
const RAW_HUGE_DIMS = raw(
  validSpec({ shell: { dimensions: { width: 50, depth: 60, height: 4 }, exits: [{ side: 'north', width: 3 }] } }),
)
// height=1 is below MIN_ROOM_HEIGHT (2.2) → room-too-small fatal. clampGeneratedShell
// only touches width/depth and repairRoom never resizes, so this stays unrepairable
// → fallback. Exercises room-too-small at the assembly level (width/depth alone can
// no longer reach it, since they are always clamped into [14..24]).
const RAW_SHORT_HEIGHT = raw(
  validSpec({ shell: { dimensions: { width: 18, depth: 18, height: 1 }, exits: [{ side: 'north', width: 3 }] } }),
)
// Object with X position well outside 18×18 room bounds → position clamped.
const RAW_OUT_OF_BOUNDS_OBJ = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    objects: [{ type: 'pillar', position: [100, 0, 0] }],
  }),
)
// 35 crates at an in-bounds position → count capped to GENERATED_ROOM.MAX_OBJECTS (30).
const RAW_TOO_MANY_OBJECTS = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    objects: Array.from({ length: 35 }, () => ({ type: 'crate', position: [3, 0, 3] })),
  }),
)
// Exit arch placed in the room interior (z=3 → nearest wall = south at z=9) → snapped
// to south wall by Stage 2.8. Provenance stays 'generated' (benign normalization).
const RAW_MISPLACED_EXIT = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    spawn: { position: [0, 1.7, 0] },
    objects: [{
      type: 'arch',
      id: 'north-arch',
      position: [0, 0, 3],
      interaction: { key: 'E', prompt: 'Enter', exit: { toRoomId: 'next-room' } },
    }],
  }),
)
// Room with an exit arch already at the south wall (z=9) so Stage 2.6 clamps it
// inward then Stage 2.8 snaps it back. Both objectsRepaired and exitsRepaired fire.
const RAW_WALL_EXIT = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    spawn: { position: [0, 1.7, 0] },
    objects: [{
      type: 'arch',
      id: 'south-arch',
      position: [0, 0, 9],
      interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'lobby' } },
    }],
  }),
)

/** The fatal codes the v0 validator can emit — used to prove diagnostics are safe. */
const KNOWN_FATAL_CODES = [
  'room-too-small',
  'room-too-large',
  'spawn-out-of-bounds',
  'object-budget-hard-exceeded',
  'light-budget-hard-exceeded',
]

describe('assembleRoom', () => {
  it('accepts a valid generated room as provenance "generated"', () => {
    const { room, diagnostics } = assembleRoom(RAW_VALID, fallback)
    expect(room.id).toBe('gen-room')
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.failedStage).toBeUndefined()
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.initialFatalCodes).toEqual([])
    expect(diagnostics.residualFatalCodes).toEqual([])
    expect(validateRoom(room).ok).toBe(true)
  })

  it('falls back on invalid JSON with failedStage "json"', () => {
    const { room, diagnostics } = assembleRoom(RAW_INVALID_JSON, fallback)
    expect(room).toBe(fallback)
    expect(diagnostics.provenance).toBe('fallback')
    expect(diagnostics.failedStage).toBe('json')
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.initialFatalCodes).toEqual([])
  })

  it('falls back on an invalid schema envelope with failedStage "schema"', () => {
    const { room, diagnostics } = assembleRoom(RAW_INVALID_SCHEMA, fallback)
    expect(room).toBe(fallback)
    expect(diagnostics.provenance).toBe('fallback')
    expect(diagnostics.failedStage).toBe('schema')
    expect(diagnostics.repairAttempted).toBe(false)
  })

  it('spawn out-of-bounds is clamped by Stage 2.7 and stays provenance "generated" (no notice)', () => {
    // After Slice 4, repairGeneratedSpawn (Stage 2.7) handles this before the
    // semantic validator runs, so no fatal reaches repairRoom (Stage 4).
    const { room, diagnostics } = assembleRoom(RAW_REPAIRABLE, fallback)
    expect(room.id).toBe('gen-room')
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.spawnRepaired).toBe(true)
    expect(diagnostics.sizeRepaired).toBe(false)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.failedStage).toBeUndefined()
    expect(diagnostics.initialFatalCodes).toEqual([])
    expect(diagnostics.residualFatalCodes).toEqual([])
    expect(validateRoom(room).ok).toBe(true)
  })

  it('falls back on an unrepairable semantic fatal with failedStage "semantic"', () => {
    const { room, diagnostics } = assembleRoom(RAW_UNREPAIRABLE, fallback)
    expect(room).toBe(fallback)
    expect(diagnostics.provenance).toBe('fallback')
    expect(diagnostics.failedStage).toBe('semantic')
    expect(diagnostics.repairAttempted).toBe(true)
    // height=400 exceeds MAX_ROOM_DIM; dimension repair does not touch height.
    expect(diagnostics.initialFatalCodes).toContain('room-too-large')
    expect(diagnostics.residualFatalCodes).toContain('room-too-large')
  })

  it('falls back when a fatal survives repair after re-validation', () => {
    const { room, diagnostics } = assembleRoom(RAW_REPAIR_THEN_FAIL, fallback)
    expect(room).toBe(fallback)
    expect(diagnostics.provenance).toBe('fallback')
    expect(diagnostics.failedStage).toBe('semantic')
    expect(diagnostics.repairAttempted).toBe(true)
    // Stage 2.7 clamps the spawn before Stage 3, so spawn-out-of-bounds never
    // appears in initialFatalCodes. Only the unrepairable height=400 fatal does.
    expect(diagnostics.initialFatalCodes).not.toContain('spawn-out-of-bounds')
    expect(diagnostics.initialFatalCodes).toContain('room-too-large')
    expect(diagnostics.residualFatalCodes).toEqual(['room-too-large'])
  })

  it('always returns a fallback that itself passes validateRoom with zero fatal issues', () => {
    const { room } = assembleRoom(RAW_INVALID_JSON, fallback)
    const result = validateRoom(room)
    expect(result.ok).toBe(true)
    expect(result.issues.filter((i) => i.severity === 'fatal')).toEqual([])
  })

  it('matrix: the renderer-facing returned room is always valid', () => {
    const inputs = [
      RAW_VALID,
      RAW_INVALID_JSON,
      RAW_INVALID_SCHEMA,
      RAW_REPAIRABLE,
      RAW_UNREPAIRABLE,
      RAW_REPAIR_THEN_FAIL,
      '',
      'null',
      '42',
    ]
    for (const input of inputs) {
      const { room } = assembleRoom(input, fallback)
      expect(room.shell.dimensions.width).toBeGreaterThan(0)
      expect(validateRoom(room).ok).toBe(true)
    }
  })

  it('emits only safe codes / counts / booleans / stage / provenance', () => {
    const inputs = [
      RAW_VALID,
      RAW_INVALID_JSON,
      RAW_INVALID_SCHEMA,
      RAW_REPAIRABLE,
      RAW_UNREPAIRABLE,
      RAW_REPAIR_THEN_FAIL,
    ]
    const allowedKeys = new Set<keyof RoomDiagnostics>([
      'provenance',
      'failedStage',
      'sizeRepaired',
      'objectsRepaired',
      'spawnRepaired',
      'exitsRepaired',
      'initialFatalCodes',
      'repairAttempted',
      'residualFatalCodes',
      'skippedObjectCount',
      'warningCount',
    ])

    for (const input of inputs) {
      const { diagnostics } = assembleRoom(input, fallback)

      // No unexpected keys (e.g. a leaked message / room name / raw text).
      for (const key of Object.keys(diagnostics)) {
        expect(allowedKeys.has(key as keyof RoomDiagnostics)).toBe(true)
      }

      expect(['generated', 'repaired', 'fallback']).toContain(diagnostics.provenance)
      if (diagnostics.failedStage !== undefined) {
        expect(['json', 'schema', 'semantic']).toContain(diagnostics.failedStage)
      }
      expect(typeof diagnostics.repairAttempted).toBe('boolean')
      expect(typeof diagnostics.sizeRepaired).toBe('boolean')
      expect(typeof diagnostics.objectsRepaired).toBe('boolean')
      expect(typeof diagnostics.spawnRepaired).toBe('boolean')
      expect(typeof diagnostics.exitsRepaired).toBe('boolean')
      expect(typeof diagnostics.skippedObjectCount).toBe('number')
      expect(typeof diagnostics.warningCount).toBe('number')
      for (const code of [
        ...diagnostics.initialFatalCodes,
        ...diagnostics.residualFatalCodes,
      ]) {
        expect(KNOWN_FATAL_CODES).toContain(code)
      }
    }
  })

  it('is deterministic and does not mutate the loaded or fallback room', () => {
    const fallbackBefore = JSON.parse(JSON.stringify(fallback))

    const first = assembleRoom(RAW_REPAIRABLE, fallback)
    const second = assembleRoom(RAW_REPAIRABLE, fallback)
    expect(first).toEqual(second)

    // Drive a fallback path too, then prove the trusted fallback is untouched.
    assembleRoom(RAW_UNREPAIRABLE, fallback)
    expect(fallback).toEqual(fallbackBefore)
  })

  // --- generated-room dimension repair (Slice 2) ---
  //
  // A size-only clamp is a benign normalization: the room stays provenance
  // 'generated' (so the host shows NO repair/fallback notice) and the clamp is
  // reported via the safe `sizeRepaired` flag. Only a real repairRoom pass or a
  // fallback flips provenance away from 'generated'.

  it('generated tiny room is size-clamped to MIN_SIZE but stays "generated" (no notice)', () => {
    const { room, diagnostics } = assembleRoom(RAW_TINY_DIMS, fallback)
    expect(diagnostics.provenance).toBe('generated') // benign clamp → no notice
    expect(diagnostics.sizeRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false) // repairRoom not needed
    expect(diagnostics.failedStage).toBeUndefined()
    expect(room.shell.dimensions.width).toBeGreaterThanOrEqual(14)
    expect(room.shell.dimensions.depth).toBeGreaterThanOrEqual(14)
    expect(validateRoom(room).ok).toBe(true)
  })

  it('generated huge room clamps to MAX_SIZE 24 but stays "generated" (no notice)', () => {
    const { room, diagnostics } = assembleRoom(RAW_HUGE_DIMS, fallback)
    expect(diagnostics.provenance).toBe('generated') // benign clamp → no notice
    expect(diagnostics.sizeRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(room.shell.dimensions.width).toBe(24)
    expect(room.shell.dimensions.depth).toBe(24)
    expect(validateRoom(room).ok).toBe(true)
  })

  it('clamps an asymmetric room (width out-of-contract, depth already valid)', () => {
    const rawAsym = raw(
      validSpec({ shell: { dimensions: { width: 5, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] } }),
    )
    const { room, diagnostics } = assembleRoom(rawAsym, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.sizeRepaired).toBe(true)
    expect(room.shell.dimensions.width).toBe(14) // clamped up to MIN_SIZE
    expect(room.shell.dimensions.depth).toBe(18) // already in contract, untouched
    expect(validateRoom(room).ok).toBe(true)
  })

  it('generated valid 18 × 18 room passes through unchanged as "generated" (sizeRepaired false)', () => {
    const { room, diagnostics } = assembleRoom(RAW_VALID, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.sizeRepaired).toBe(false)
    expect(room.shell.dimensions.width).toBe(18)
    expect(room.shell.dimensions.depth).toBe(18)
  })

  it('authored fallback room is not mutated by generated-room dimension repair', () => {
    const widthBefore = fallback.shell.dimensions.width // 8
    const depthBefore = fallback.shell.dimensions.depth // 8
    assembleRoom(RAW_TINY_DIMS, fallback)
    assembleRoom(RAW_HUGE_DIMS, fallback)
    expect(fallback.shell.dimensions.width).toBe(widthBefore)
    expect(fallback.shell.dimensions.depth).toBe(depthBefore)
  })

  it('dimension repair is deterministic', () => {
    expect(assembleRoom(RAW_TINY_DIMS, fallback)).toEqual(assembleRoom(RAW_TINY_DIMS, fallback))
    expect(assembleRoom(RAW_HUGE_DIMS, fallback)).toEqual(assembleRoom(RAW_HUGE_DIMS, fallback))
  })

  it('falls back on a too-short height (room-too-small), which dimension clamp cannot fix', () => {
    const { room, diagnostics } = assembleRoom(RAW_SHORT_HEIGHT, fallback)
    expect(room).toBe(fallback)
    expect(diagnostics.provenance).toBe('fallback')
    expect(diagnostics.failedStage).toBe('semantic')
    expect(diagnostics.sizeRepaired).toBe(false) // returned room is the authored fallback
    expect(diagnostics.initialFatalCodes).toContain('room-too-small')
    expect(diagnostics.residualFatalCodes).toContain('room-too-small')
  })

  // --- generated-room object bounds repair (Slice 3) ---
  //
  // Object position clamping and count capping are benign normalizations: the
  // room stays provenance 'generated' (no notice) and the repair is reported via
  // the safe `objectsRepaired` flag only. Only a repairRoom pass or fallback
  // changes provenance away from 'generated'.

  it('out-of-bounds object position is clamped into the playable area, stays "generated"', () => {
    const { room, diagnostics } = assembleRoom(RAW_OUT_OF_BOUNDS_OBJ, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.objectsRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.failedStage).toBeUndefined()
    expect(room.objects).toHaveLength(1)
    // pillar was at x=100; must be clamped inside the 18×18 playable area
    const [x] = room.objects[0]!.position
    expect(Math.abs(x)).toBeLessThan(9) // strictly inside the room half-extent (9 m)
    expect(validateRoom(room).ok).toBe(true)
  })

  it('object count is capped to GENERATED_ROOM.MAX_OBJECTS (30), objectsRepaired true', () => {
    const { room, diagnostics } = assembleRoom(RAW_TOO_MANY_OBJECTS, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.objectsRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.failedStage).toBeUndefined()
    expect(room.objects).toHaveLength(30) // capped from 35 to MAX_OBJECTS
    expect(validateRoom(room).ok).toBe(true)
  })

  it('generated room with all in-bounds objects and count ≤ MAX_OBJECTS: objectsRepaired false', () => {
    const { diagnostics } = assembleRoom(RAW_VALID, fallback)
    expect(diagnostics.objectsRepaired).toBe(false)
  })

  it('objectsRepaired is false for all fallback paths (authored fallback objects are untouched)', () => {
    const paths = [RAW_INVALID_JSON, RAW_INVALID_SCHEMA, RAW_UNREPAIRABLE, RAW_REPAIR_THEN_FAIL]
    for (const input of paths) {
      const { diagnostics } = assembleRoom(input, fallback)
      expect(diagnostics.objectsRepaired).toBe(false)
    }
  })

  it('authored fallback room objects are not mutated by generated-room object repair', () => {
    const objectsBefore = JSON.parse(JSON.stringify(fallback.objects))
    assembleRoom(RAW_OUT_OF_BOUNDS_OBJ, fallback)
    assembleRoom(RAW_TOO_MANY_OBJECTS, fallback)
    expect(fallback.objects).toEqual(objectsBefore)
  })

  it('object bounds repair is deterministic', () => {
    expect(assembleRoom(RAW_OUT_OF_BOUNDS_OBJ, fallback)).toEqual(
      assembleRoom(RAW_OUT_OF_BOUNDS_OBJ, fallback),
    )
    expect(assembleRoom(RAW_TOO_MANY_OBJECTS, fallback)).toEqual(
      assembleRoom(RAW_TOO_MANY_OBJECTS, fallback),
    )
  })

  // --- generated-room spawn safe-area repair (Slice 4) ---
  //
  // Spawn repair is a benign normalization: the room stays provenance 'generated'
  // (so the host shows NO notice) and the repair is reported via the safe
  // `spawnRepaired` flag only. Only a real repairRoom pass or fallback changes
  // provenance away from 'generated'.

  it('spawn outside room bounds is clamped at Stage 2.7, stays "generated" (spawnRepaired true)', () => {
    const rawSpawnOob = raw(
      validSpec({
        shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
        spawn: { position: [100, 1.7, 0] },
      }),
    )
    const { room, diagnostics } = assembleRoom(rawSpawnOob, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.spawnRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.failedStage).toBeUndefined()
    expect(validateRoom(room).ok).toBe(true)
    // Spawn is now inside the room
    const [x, , z] = room.spawn.position
    expect(Math.abs(x)).toBeLessThan(9) // strictly inside half-extent (9 m)
    expect(Math.abs(z)).toBeLessThan(9)
  })

  it('spawn crowded by a blocking object is nudged, stays "generated" (spawnRepaired true)', () => {
    // Pillar at origin crowds spawn at origin; spawn must be nudged.
    const rawCrowded = raw(
      validSpec({
        shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
        spawn: { position: [0, 1.7, 0] },
        objects: [{ type: 'pillar', position: [0, 0, 0] }],
      }),
    )
    const { room, diagnostics } = assembleRoom(rawCrowded, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.spawnRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.failedStage).toBeUndefined()
    expect(validateRoom(room).ok).toBe(true)
  })

  it('safe spawn with no blocking objects nearby: spawnRepaired false', () => {
    const { diagnostics } = assembleRoom(RAW_VALID, fallback)
    expect(diagnostics.spawnRepaired).toBe(false)
  })

  it('objectsRepaired and spawnRepaired can both be true with provenance "generated"', () => {
    // Crate at X=200 (clamped by Stage 2.6), spawn at X=-100 (clamped by Stage 2.7).
    // Clamped positions are far apart — no crowding.
    const rawBothRepaired = raw(
      validSpec({
        shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
        spawn: { position: [-100, 1.7, 0] },
        objects: [{ type: 'crate', position: [200, 0, 0] }],
      }),
    )
    const { room, diagnostics } = assembleRoom(rawBothRepaired, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.objectsRepaired).toBe(true)
    expect(diagnostics.spawnRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(validateRoom(room).ok).toBe(true)
  })

  it('spawnRepaired is false for all fallback paths (authored fallback spawn is untouched)', () => {
    const paths = [RAW_INVALID_JSON, RAW_INVALID_SCHEMA, RAW_UNREPAIRABLE, RAW_REPAIR_THEN_FAIL]
    for (const input of paths) {
      const { diagnostics } = assembleRoom(input, fallback)
      expect(diagnostics.spawnRepaired).toBe(false)
    }
  })

  it('authored fallback room spawn is not mutated by generated-room spawn repair', () => {
    const spawnBefore = JSON.parse(JSON.stringify(fallback.spawn))
    assembleRoom(RAW_REPAIRABLE, fallback)
    assembleRoom(
      raw(validSpec({
        shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
        spawn: { position: [0, 1.7, 0] },
        objects: [{ type: 'pillar', position: [0, 0, 0] }],
      })),
      fallback,
    )
    expect(fallback.spawn).toEqual(spawnBefore)
  })

  it('spawn repair is deterministic', () => {
    expect(assembleRoom(RAW_REPAIRABLE, fallback)).toEqual(assembleRoom(RAW_REPAIRABLE, fallback))
  })

  // --- generated-room exit placement repair (Slice 5) ---
  //
  // Exit-carrying objects (those with interaction.exit) are snapped to the
  // nearest room wall face. This is a benign normalization: the room stays
  // provenance 'generated' (no notice) and the repair is reported via the
  // safe `exitsRepaired` flag only.

  it('misplaced exit arch in room interior is snapped to wall, stays "generated" (exitsRepaired true)', () => {
    // arch at [0, 0, 3]: Stage 2.8 snaps to south wall (nearest at z=9).
    const { room, diagnostics } = assembleRoom(RAW_MISPLACED_EXIT, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.exitsRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.failedStage).toBeUndefined()
    expect(validateRoom(room).ok).toBe(true)
    // The arch must be on a wall face
    const arch = room.objects.find((o) => o.type === 'arch')!
    const halfD = room.shell.dimensions.depth / 2
    const halfW = room.shell.dimensions.width / 2
    const [x, , z] = arch.position
    const onWall =
      Math.abs(Math.abs(z) - halfD) < 0.001 ||
      Math.abs(Math.abs(x) - halfW) < 0.001
    expect(onWall).toBe(true)
  })

  it('exit arch already at a wall: Stage 2.6 clamps inward; Stage 2.8 snaps back (exitsRepaired true)', () => {
    // arch at [0, 0, 9] (south wall): Stage 2.6 clamps to playable bounds (inward),
    // Stage 2.8 snaps back to z=9. Both objectsRepaired and exitsRepaired are true.
    const { room, diagnostics } = assembleRoom(RAW_WALL_EXIT, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.exitsRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(validateRoom(room).ok).toBe(true)
    const arch = room.objects.find((o) => o.type === 'arch')!
    expect(arch.position[2]).toBeCloseTo(9)  // south wall restored
  })

  it('room with no exit-carrying objects: exitsRepaired false', () => {
    const { diagnostics } = assembleRoom(RAW_VALID, fallback)
    expect(diagnostics.exitsRepaired).toBe(false)
  })

  it('exit-only repair does not show fallback notice (provenance stays "generated")', () => {
    const { diagnostics } = assembleRoom(RAW_MISPLACED_EXIT, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.failedStage).toBeUndefined()
  })

  it('exitsRepaired is false for all fallback paths (authored fallback is untouched)', () => {
    const paths = [RAW_INVALID_JSON, RAW_INVALID_SCHEMA, RAW_UNREPAIRABLE, RAW_REPAIR_THEN_FAIL]
    for (const input of paths) {
      const { diagnostics } = assembleRoom(input, fallback)
      expect(diagnostics.exitsRepaired).toBe(false)
    }
  })

  it('authored fallback room objects are not mutated by exit repair', () => {
    const objectsBefore = JSON.parse(JSON.stringify(fallback.objects))
    assembleRoom(RAW_MISPLACED_EXIT, fallback)
    assembleRoom(RAW_WALL_EXIT, fallback)
    expect(fallback.objects).toEqual(objectsBefore)
  })

  it('exit repair is deterministic', () => {
    expect(assembleRoom(RAW_MISPLACED_EXIT, fallback)).toEqual(
      assembleRoom(RAW_MISPLACED_EXIT, fallback),
    )
  })
})
