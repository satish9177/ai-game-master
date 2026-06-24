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
// Spawn far outside an 18×18 room → spawn-out-of-bounds fatal, repaired by repairRoom.
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
// Repairable fatal (spawn oob) AND an unrepairable one (height=400 → room-too-large):
// repair runs and moves the spawn, but the height fatal survives → fallback.
const RAW_REPAIR_THEN_FAIL = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 400 }, exits: [{ side: 'north', width: 3 }] },
    spawn: { position: [100, 1.7, 0] },
  }),
)
// Generated rooms with out-of-contract dimensions — these should be clamped and
// returned as 'repaired', never reaching the fallback.
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

  it('repairs a repairable semantic fatal as provenance "repaired"', () => {
    const { room, diagnostics } = assembleRoom(RAW_REPAIRABLE, fallback)
    expect(room.id).toBe('gen-room')
    expect(diagnostics.provenance).toBe('repaired')
    expect(diagnostics.sizeRepaired).toBe(false) // a real repairRoom fix, not a size clamp
    expect(diagnostics.failedStage).toBeUndefined()
    expect(diagnostics.repairAttempted).toBe(true)
    expect(diagnostics.initialFatalCodes).toContain('spawn-out-of-bounds')
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
    // repairRoom clamps the spawn → spawn fatal gone; height=400 fatal survives.
    expect(diagnostics.initialFatalCodes).toContain('spawn-out-of-bounds')
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
})
