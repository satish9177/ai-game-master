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
const RAW_VALID = raw(validSpec())
const RAW_REPAIRABLE = raw(validSpec({ spawn: { position: [100, 1.7, 0] } }))
const RAW_UNREPAIRABLE = raw(
  validSpec({ shell: { dimensions: { width: 2, depth: 2, height: 4 } } }),
)
// Repairable fatal (spawn oob) AND an unrepairable one (room too small): repair
// runs and moves the spawn, but a fatal survives → fallback.
const RAW_REPAIR_THEN_FAIL = raw(
  validSpec({
    shell: { dimensions: { width: 2, depth: 2, height: 4 } },
    spawn: { position: [100, 1.7, 0] },
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

  it('repairs a repairable semantic fatal as provenance "repaired"', () => {
    const { room, diagnostics } = assembleRoom(RAW_REPAIRABLE, fallback)
    expect(room.id).toBe('gen-room')
    expect(diagnostics.provenance).toBe('repaired')
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
    expect(diagnostics.initialFatalCodes).toContain('room-too-small')
    expect(diagnostics.residualFatalCodes).toContain('room-too-small')
  })

  it('falls back when a fatal survives repair after re-validation', () => {
    const { room, diagnostics } = assembleRoom(RAW_REPAIR_THEN_FAIL, fallback)
    expect(room).toBe(fallback)
    expect(diagnostics.provenance).toBe('fallback')
    expect(diagnostics.failedStage).toBe('semantic')
    expect(diagnostics.repairAttempted).toBe(true)
    // The repairable spawn fatal is gone after repair; the room-size one remains.
    expect(diagnostics.initialFatalCodes).toContain('spawn-out-of-bounds')
    expect(diagnostics.residualFatalCodes).toEqual(['room-too-small'])
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
})
