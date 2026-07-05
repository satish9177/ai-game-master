import { describe, it, expect } from 'vitest'
import { assembleRoom } from './assembleRoom'
import type { RoomDiagnostics } from './assembleRoom'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'
import { buildInteractables } from './ports/interaction'
import { buildExitLookup } from '../app/exits'
import { validateRoom } from './validateRoom'
import { fallbackRoom } from './examples/fallbackRoom'
import { objectFootprintsOverlap } from './generatedRoomSeparation'

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

const READ_BODY = 'You read over it carefully. Nothing changes yet.'
const INSPECT_BODY = 'You inspect it carefully, but do not take anything.'
const CORPSE_BODY = 'You inspect the remains without disturbing them.'
const EXAMINE_BODY = 'You examine it for meaning or danger. Nothing changes yet.'
const DEFAULT_GENERATED_NPC_PERSONAS = [
  'generated-room-guide',
  'generated-calm-witness',
]
const FANTASY_KEEP_GENERATED_NPC_PERSONAS = [
  'generated-keep-warden',
  'generated-archive-aide',
]
const POST_APOC_GENERATED_NPC_PERSONAS = [
  'generated-wasteland-scout',
  'generated-shelter-watch',
]
const GENERATED_NPC_PERSONAS = [
  ...DEFAULT_GENERATED_NPC_PERSONAS,
  ...FANTASY_KEEP_GENERATED_NPC_PERSONAS,
  ...POST_APOC_GENERATED_NPC_PERSONAS,
]

function interactionFor(object: RoomObject) {
  return 'interaction' in object ? object.interaction : undefined
}

function nonExitObjects(room: LoadedRoom): RoomObject[] {
  return room.objects.filter((object) => {
    const interaction = 'interaction' in object ? object.interaction : undefined
    return interaction?.exit == null
  })
}

// Raw inputs covering every branch, reused by the matrix / safety tests.
const RAW_INVALID_JSON = '{ this is not valid json'
const RAW_INVALID_SCHEMA = raw({ not: 'a room' })
// Dimensions within the generated-room contract [14..24] so no dimension repair
// fires and provenance stays 'generated'.
const RAW_VALID = raw(
  validSpec({ shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] } }),
)
// Spawn far outside an 18×18 room → clamped by repairGeneratedSpawn (Stage 2.8).
// Stage 2.8 fixes this before the validator runs, so provenance
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
// Spawn oob (fixed at Stage 2.8) AND unrepairable height=400 (room-too-large):
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
// Room with two aliased object types: desk→table, skeleton→corpse.
// Stage 1.5 rewrites them before loadRoomSpec, so both land in room.objects.
const RAW_WITH_ALIASES = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    objects: [
      { type: 'desk', position: [2, 0, 2] },
      { type: 'skeleton', position: [-2, 0, -2] },
    ],
  }),
)
// Aliased type ("desk"→"table") but remaining fields are malformed (position invalid).
// Stage 1.5 repairs the type; loadRoomSpec still rejects the object → skipped.
const RAW_ALIAS_MALFORMED = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    objects: [{ type: 'desk', position: 'not-a-vec' }],
  }),
)
// Unmapped alias ("lamp" is in the deferred list) → loadRoomSpec skips it.
const RAW_UNMAPPED_ALIAS = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    objects: [{ type: 'lamp', position: [1, 0, 1] }],
  }),
)
const RAW_MALFORMED_TRANSFORMS = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    objects: [
      { type: 'book', position: [-2, 0, 0], rotationY: '45deg' },
      { type: 'chest', position: [2, 0, 0], scale: 'large' },
      { type: 'map', position: [0, 0, -2], rotationY: null, scale: 0 },
    ],
  }),
)
const RAW_ALIAS_AND_TRANSFORM = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    objects: [{ type: 'desk', position: [2, 0, 2], rotationY: 'bad', scale: 'large' }],
  }),
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
// to south wall by Stage 2.9. Provenance stays 'generated' (benign normalization).
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
// inward then Stage 2.9 snaps it back. Both objectsRepaired and exitsRepaired fire.
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
const RAW_CENTER_CLUTTER = raw(
  validSpec({
    shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    spawn: { position: [0, 1.7, 4] },
    objects: [{ type: 'rug', position: [0, 0, 0] }],
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
    expect(diagnostics.exitNavigationEnsured).toBe(true)
    expect(buildExitLookup(room).size).toBeGreaterThanOrEqual(1)
    expect(diagnostics.failedStage).toBeUndefined()
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.initialFatalCodes).toEqual([])
    expect(diagnostics.residualFatalCodes).toEqual([])
    expect(validateRoom(room).ok).toBe(true)
  })

  it('post-apoc theme option changes the focal anchor while preserving later assembly behavior', () => {
    const token = 'adjacent:gen-1234abcd:exit:north'
    const { room, diagnostics } = assembleRoom(
      raw(validSpec({
        id: 'post-apoc-compose',
        name: `Generated room - ${token}`,
        shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
        spawn: { position: [0, 1.7, 4] },
        objects: [
          { type: 'throne', position: [0, 0, 0] },
          { type: 'altar', position: [0.5, 0, 0] },
          { type: 'statue', position: [-0.5, 0, 0] },
          { type: 'corpse', position: [1, 0, 1] },
          { type: 'machine', position: [3, 0, 3] },
          {
            type: 'paper',
            position: [0, 0, 2],
            interaction: {
              key: 'E',
              prompt: `Read ${token}`,
              body: `Notes mention ${token}`,
            },
          },
        ],
      })),
      fallback,
      { themePack: 'post-apoc', requestsNpc: true },
    )

    const machine = room.objects.find((object) => object.type === 'machine')
    expect(machine?.position[0]).toBe(0)
    expect(machine?.position[2]).toBeLessThan(0)
    expect(room.objects.map((object) => object.type)).toEqual(
      expect.arrayContaining(['throne', 'altar', 'statue', 'corpse', 'machine']),
    )
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.exitNavigationEnsured).toBe(true)
    expect(diagnostics.displayTextSanitized).toBe(true)
    expect(diagnostics.npcInserted).toBe(true)
    expect(buildExitLookup(room).size).toBeGreaterThanOrEqual(1)
    expect(room.objects.some((object) => object.type === 'npc')).toBe(true)
    expect(validateRoom(room).ok).toBe(true)
  })

  it('storyKind option changes the focal anchor while preserving generated assembly behavior', () => {
    const input = raw(validSpec({
      id: 'story-kind-compose',
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 4] },
      objects: [
        { type: 'throne', position: [0, 0, 0] },
        { type: 'book', position: [3, 0, 3] },
      ],
    }))

    const defaultResult = assembleRoom(input, fallback)
    const investigateResult = assembleRoom(input, fallback, { storyKind: 'investigate' })

    const defaultThrone = defaultResult.room.objects.find((object) => object.type === 'throne')
    const investigateBook = investigateResult.room.objects.find((object) => object.type === 'book')

    expect(defaultThrone?.position[0]).toBe(0)
    expect(defaultThrone?.position[2]).toBeLessThan(0)
    expect(investigateBook?.position[0]).toBe(0)
    expect(investigateBook?.position[2]).toBeLessThan(0)
    expect(investigateResult.diagnostics.provenance).toBe('generated')
    expect(investigateResult.diagnostics.exitNavigationEnsured).toBe(true)
    expect(validateRoom(investigateResult.room).ok).toBe(true)
  })

  it('falls back on invalid JSON with failedStage "json"', () => {
    const { room, diagnostics } = assembleRoom(RAW_INVALID_JSON, fallback)
    expect(room).toBe(fallback)
    expect(diagnostics.provenance).toBe('fallback')
    expect(diagnostics.failedStage).toBe('json')
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.initialFatalCodes).toEqual([])
  })

  it('post-apoc theme option keeps fallback branches safe', () => {
    const { room, diagnostics } = assembleRoom(RAW_INVALID_JSON, fallback, { themePack: 'post-apoc' })

    expect(room).toBe(fallback)
    expect(diagnostics.provenance).toBe('fallback')
    expect(diagnostics.failedStage).toBe('json')
    expect(diagnostics.composed).toBe(false)
    expect(diagnostics.exitNavigationEnsured).toBe(false)
    expect(validateRoom(room).ok).toBe(true)
  })

  it('falls back on an invalid schema envelope with failedStage "schema"', () => {
    const { room, diagnostics } = assembleRoom(RAW_INVALID_SCHEMA, fallback)
    expect(room).toBe(fallback)
    expect(diagnostics.provenance).toBe('fallback')
    expect(diagnostics.failedStage).toBe('schema')
    expect(diagnostics.repairAttempted).toBe(false)
  })

  it('spawn out-of-bounds is clamped by Stage 2.8 and stays provenance "generated" (no notice)', () => {
    // repairGeneratedSpawn (Stage 2.8) handles this before the
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
    // Stage 2.8 clamps the spawn before Stage 3, so spawn-out-of-bounds never
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
      'composed',
      'overlapRepaired',
      'clutterDistributed',
      'lacksAnchor',
      'lacksInteractable',
      'spawnRepaired',
      'exitsRepaired',
      'exitNavigationEnsured',
      'initialFatalCodes',
      'repairAttempted',
      'residualFatalCodes',
      'skippedObjectCount',
      'warningCount',
      'aliasesRepaired',
      'objectTransformsRepaired',
      'purposesAssigned',
      'npcInserted',
      'npcDialogueNormalizedCount',
      'objectiveTargetEnriched',
      'displayTextSanitized',
      'displayTextSanitizationCount',
      'skippedObjectReasonCounts',
      'mechanicalGateAvailable',
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
      expect(typeof diagnostics.composed).toBe('boolean')
      expect(typeof diagnostics.overlapRepaired).toBe('boolean')
      expect(typeof diagnostics.clutterDistributed).toBe('boolean')
      expect(typeof diagnostics.lacksAnchor).toBe('boolean')
      expect(typeof diagnostics.lacksInteractable).toBe('boolean')
      expect(typeof diagnostics.spawnRepaired).toBe('boolean')
      expect(typeof diagnostics.exitsRepaired).toBe('boolean')
      expect(typeof diagnostics.exitNavigationEnsured).toBe('boolean')
      expect(typeof diagnostics.skippedObjectCount).toBe('number')
      expect(typeof diagnostics.warningCount).toBe('number')
      expect(typeof diagnostics.aliasesRepaired).toBe('number')
      expect(typeof diagnostics.objectTransformsRepaired).toBe('number')
      expect(typeof diagnostics.purposesAssigned).toBe('number')
      expect(typeof diagnostics.npcInserted).toBe('boolean')
      expect(typeof diagnostics.npcDialogueNormalizedCount).toBe('number')
      expect(typeof diagnostics.objectiveTargetEnriched).toBe('boolean')
      expect(typeof diagnostics.displayTextSanitized).toBe('boolean')
      expect(typeof diagnostics.displayTextSanitizationCount).toBe('number')
      expect(typeof diagnostics.skippedObjectReasonCounts).toBe('object')
      expect(typeof diagnostics.mechanicalGateAvailable).toBe('boolean')
      expect(diagnostics.skippedObjectReasonCounts).not.toBeNull()
      for (const val of Object.values(diagnostics.skippedObjectReasonCounts)) {
        expect(typeof val).toBe('number')
      }
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
    expect(nonExitObjects(room)).toHaveLength(1)
    // pillar was at x=100; must be clamped inside the 18×18 playable area
    const [x] = nonExitObjects(room)[0]!.position
    expect(Math.abs(x)).toBeLessThan(9) // strictly inside the room half-extent (9 m)
    expect(validateRoom(room).ok).toBe(true)
  })

  it('object count is capped to GENERATED_ROOM.MAX_OBJECTS (30), objectsRepaired true', () => {
    const { room, diagnostics } = assembleRoom(RAW_TOO_MANY_OBJECTS, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.objectsRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.failedStage).toBeUndefined()
    expect(nonExitObjects(room)).toHaveLength(30) // capped from 35 to MAX_OBJECTS
    expect(buildExitLookup(room).size).toBe(1)
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

  it('out-of-bounds wall-light and unknown placeholder are normalized, stays "generated" (no notice)', () => {
    // A torch and an unknown ("gargoyle") object, both far outside the room. The
    // torch is nudged to a wall-side, the unknown is skipped + its placeholder
    // anchor clamped inside. All benign → provenance stays 'generated', no notice.
    const rawMixed = raw(
      validSpec({
        shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
        spawn: { position: [0, 1.7, 5] },
        objects: [
          { type: 'torch', position: [0, 3, 0] }, // central light → wall-side
          { type: 'gargoyle', position: [100, 0, -100] }, // unknown → skipped placeholder
        ],
      }),
    )
    const { room, diagnostics } = assembleRoom(rawMixed, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.objectsRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.failedStage).toBeUndefined()
    expect(validateRoom(room).ok).toBe(true)
    // The skipped placeholder anchor was clamped inside the visible floor.
    expect(room.skipped).toHaveLength(1)
    const placeholder = room.skipped[0]!.raw as { position: [number, number, number] }
    expect(Math.abs(placeholder.position[0])).toBeLessThan(9)
    expect(Math.abs(placeholder.position[2])).toBeLessThan(9)
  })

  // --- generated-room spawn safe-area repair (Slice 4) ---
  //
  // Spawn repair is a benign normalization: the room stays provenance 'generated'
  // (so the host shows NO notice) and the repair is reported via the safe
  // `spawnRepaired` flag only. Only a real repairRoom pass or fallback changes
  // provenance away from 'generated'.

  it('spawn outside room bounds is clamped at Stage 2.8, stays "generated" (spawnRepaired true)', () => {
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
    // Off-corridor pillar crowds an off-corridor spawn; composition leaves it in
    // place, then spawn repair must still nudge the spawn.
    const rawCrowded = raw(
      validSpec({
        shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
        spawn: { position: [3, 1.7, 0] },
        objects: [{ type: 'pillar', position: [3, 0, 0] }],
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
    // Crate at X=200 (clamped by Stage 2.6), spawn at X=-100 (clamped by Stage 2.8).
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
    // arch at [0, 0, 3]: Stage 2.9 snaps to south wall (nearest at z=9).
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

  it('exit arch already at a wall: Stage 2.6 clamps inward; Stage 2.9 snaps back (exitsRepaired true)', () => {
    // arch at [0, 0, 9] (south wall): Stage 2.6 clamps to playable bounds (inward),
    // Stage 2.9 snaps back to z=9. Both objectsRepaired and exitsRepaired are true.
    const { room, diagnostics } = assembleRoom(RAW_WALL_EXIT, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.exitsRepaired).toBe(true)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(validateRoom(room).ok).toBe(true)
    const arch = room.objects.find((o) => o.type === 'arch')!
    expect(arch.position[2]).toBeCloseTo(9)  // south wall restored
  })

  it('room with no exit-carrying objects gets a usable exit without exit movement', () => {
    const { room, diagnostics } = assembleRoom(RAW_VALID, fallback)
    expect(diagnostics.exitNavigationEnsured).toBe(true)
    expect(diagnostics.exitsRepaired).toBe(false)
    expect(buildExitLookup(room).size).toBe(1)
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
      expect(diagnostics.exitNavigationEnsured).toBe(false)
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

  // --- generated-room composition (generated-room-composition-v0 Slice 2) ---

  it('composes generated center clutter without changing provenance or failedStage', () => {
    const { room, diagnostics } = assembleRoom(RAW_CENTER_CLUTTER, fallback)
    expect(diagnostics.composed).toBe(true)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.failedStage).toBeUndefined()
    expect(room.objects[0]!.position[0]).not.toBe(0)
  })

  it('runs overlap separation after composition and before spawn repair', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 24, depth: 24, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 4] },
      objects: [
        { type: 'crate', position: [0, 0, 0] },
        { type: 'crate', position: [0, 0, 0] },
      ],
    })), fallback)

    expect(result.diagnostics.composed).toBe(true)
    expect(result.diagnostics.overlapRepaired).toBe(true)
    expect(result.diagnostics.spawnRepaired).toBe(false)
    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.failedStage).toBeUndefined()
    expect(objectFootprintsOverlap(result.room.objects[0]!, result.room.objects[1]!)).toBe(false)
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('runs clutter distribution after composition and before overlap repair', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 4] },
      objects: Array.from({ length: 8 }, (_, i) => ({
        type: 'crate',
        id: `corner-crate-${i}`,
        position: [-7, 0, -7],
      })),
    })), fallback)

    expect(result.diagnostics.clutterDistributed).toBe(true)
    expect(result.diagnostics.overlapRepaired).toBe(true)
    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.failedStage).toBeUndefined()
    const crates = result.room.objects.filter((object) => object.type === 'crate')
    expect(crates).toHaveLength(8)
    for (let i = 0; i < crates.length; i += 1) {
      for (let j = i + 1; j < crates.length; j += 1) {
        expect(objectFootprintsOverlap(crates[i]!, crates[j]!)).toBe(false)
      }
    }
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('reports clutterDistributed only when distribution moves decorative clutter', () => {
    const crowded = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 4] },
      objects: Array.from({ length: 6 }, (_, i) => ({
        type: 'crate',
        id: `crowded-crate-${i}`,
        position: [-7, 0, -7],
      })),
    })), fallback)
    const distributed = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 4] },
      objects: [
        { type: 'crate', position: [-7, 0, -7] },
        { type: 'crate', position: [-6, 0, -6] },
        { type: 'crate', position: [-5, 0, -5] },
        { type: 'crate', position: [-4.5, 0, -4.5] },
      ],
    })), fallback)

    expect(crowded.diagnostics.clutterDistributed).toBe(true)
    expect(distributed.diagnostics.clutterDistributed).toBe(false)
  })

  it('threads missing anchor and interactable diagnostics safely', () => {
    const missing = assembleRoom(RAW_CENTER_CLUTTER, fallback).diagnostics
    expect(missing.lacksAnchor).toBe(true)
    expect(missing.lacksInteractable).toBe(true)

    const present = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 4] },
      objects: [
        { type: 'throne', position: [0, 0, -6] },
        {
          type: 'scroll',
          position: [4, 0, 0],
          interaction: { key: 'E', prompt: 'Read' },
        },
      ],
    })), fallback).diagnostics
    expect(present.lacksAnchor).toBe(false)
    expect(present.lacksInteractable).toBe(false)
  })

  it('runs spawn repair after composition', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, -5.985] },
      objects: [{ type: 'throne', position: [0, 0, 0] }],
    })), fallback)
    expect(result.diagnostics.composed).toBe(true)
    expect(result.room.objects[0]!.position[2]).toBeCloseTo(-5.985)
    expect(result.diagnostics.spawnRepaired).toBe(true)
  })

  it('runs exit repair after composition', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 4] },
      objects: [
        { type: 'rug', position: [0, 0, 0] },
        {
          type: 'arch',
          position: [0, 0, 3],
          interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'next' } },
        },
      ],
    })), fallback)
    expect(result.diagnostics.composed).toBe(true)
    expect(result.diagnostics.exitNavigationEnsured).toBe(true)
    expect(result.room.objects[1]!.position[2]).toBeCloseTo(-9)
  })

  it('keeps composition diagnostics false and authored fallback untouched on fallback paths', () => {
    const before = JSON.parse(JSON.stringify(fallback))
    for (const input of [RAW_INVALID_JSON, RAW_INVALID_SCHEMA, RAW_UNREPAIRABLE]) {
      const { room, diagnostics } = assembleRoom(input, fallback)
      expect(room).toBe(fallback)
      expect(diagnostics.composed).toBe(false)
      expect(diagnostics.overlapRepaired).toBe(false)
      expect(diagnostics.clutterDistributed).toBe(false)
      expect(diagnostics.lacksAnchor).toBe(false)
      expect(diagnostics.lacksInteractable).toBe(false)
    }
    expect(fallback).toEqual(before)
  })

  it('assembles book, paper, and map as generated objects without fallback', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        { type: 'book', position: [-3, 0, -1] },
        { type: 'paper', position: [3, 0, 0] },
        {
          type: 'map',
          position: [0, 0, -2],
          interaction: { key: 'E', prompt: 'Study map', body: 'Validated body.' },
        },
      ],
    })), fallback)
    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.failedStage).toBeUndefined()
    expect(result.diagnostics.repairAttempted).toBe(false)
    expect(nonExitObjects(result.room).map((object) => object.type)).toEqual(['book', 'paper', 'map'])
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('assembles chest, corpse, and table as generated objects without fallback', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        {
          type: 'chest',
          position: [0, 0, -2],
          interaction: { key: 'E', prompt: 'Open chest', body: 'Validated body.' },
        },
        { type: 'corpse', position: [-3, 0, -1] },
        { type: 'table', position: [3, 0, 0] },
      ],
    })), fallback)
    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.failedStage).toBeUndefined()
    expect(result.diagnostics.repairAttempted).toBe(false)
    expect(nonExitObjects(result.room).map((object) => object.type)).toEqual(['chest', 'corpse', 'table'])
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('assembles altar and statue as generated story anchors without fallback', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        {
          type: 'altar',
          position: [0, 0, -2],
          interaction: { key: 'E', prompt: 'Inspect altar', body: 'Validated body.' },
        },
        { type: 'statue', position: [0, 0, 0] },
      ],
    })), fallback)
    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.failedStage).toBeUndefined()
    expect(result.diagnostics.repairAttempted).toBe(false)
    expect(result.diagnostics.lacksAnchor).toBe(false)
    expect(result.diagnostics.lacksInteractable).toBe(false)
    expect(nonExitObjects(result.room).map((object) => object.type)).toEqual(['altar', 'statue'])
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('assembles machine, artifact, and candle as generated objects without fallback', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        {
          type: 'machine',
          position: [0, 0, -2],
          interaction: { key: 'E', prompt: 'Inspect machine', body: 'Validated body.' },
        },
        { type: 'artifact', position: [-3, 0, -1] },
        { type: 'candle', position: [3, 0, 0] },
      ],
    })), fallback)
    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.failedStage).toBeUndefined()
    expect(result.diagnostics.repairAttempted).toBe(false)
    expect(result.diagnostics.lacksInteractable).toBe(false)
    expect(nonExitObjects(result.room).map((object) => object.type)).toEqual(['machine', 'artifact', 'candle'])
    expect(validateRoom(result.room).ok).toBe(true)
  })

  // --- generated-room object purpose assignment (generated-room-object-purpose-v0 Slice 2) ---
  //
  // Stage 2.10 assigns safe, presentation-only interactions to allowlisted
  // generated objects after geometry/composition/spawn/exit repair and before
  // final validation. It never runs on direct loadRoomSpec authored/static/
  // restored paths, and fallback diagnostics report zero assignments.

  // --- generated-room NPC presence enrichment (generated-room-npc-presence-v0 Slice 3) ---
  //
  // Stage 2.11 may insert one safe generated NPC when the app supplies a
  // boolean-only request signal. The raw prompt never enters assembleRoom.

  it('requestsNpc true inserts one NPC when the generated room has none', () => {
    const result = assembleRoom(RAW_VALID, fallback, { requestsNpc: true })

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.npcInserted).toBe(true)
    expect(result.room.objects.filter((object) => object.type === 'npc')).toHaveLength(1)
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('requestsNpc false preserves current behavior and does not insert an NPC', () => {
    const result = assembleRoom(RAW_VALID, fallback, { requestsNpc: false })

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.npcInserted).toBe(false)
    expect(result.room.objects.some((object) => object.type === 'npc')).toBe(false)
  })

  it('preserves an existing NPC and does not insert a second NPC', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{
        type: 'npc',
        id: 'existing-npc',
        name: 'Existing Guide',
        position: [-4, 0, 0],
        interaction: {
          key: 'F',
          prompt: 'Talk',
          body: 'Existing safe body.',
          dialogue: { greeting: 'Hello.' },
        },
      }],
    })), fallback, { requestsNpc: true })

    expect(result.diagnostics.npcInserted).toBe(false)
    expect(result.room.objects.filter((object) => object.type === 'npc')).toHaveLength(1)
    expect(result.room.objects.find((object) => object.type === 'npc')?.id).toBe('existing-npc')
  })

  it('no safe NPC tile still succeeds and reports npcInserted false', () => {
    const blockerPositions = [
      [4.050000000000001, 0],
      [4.050000000000001, 0],
      [-4.050000000000001, 0],
      [4.050000000000001, -2.835],
      [-4.050000000000001, -2.835],
      [4.050000000000001, 2.835],
      [-4.050000000000001, 2.835],
      [0, -3.6450000000000005],
      [0, 3.6450000000000005],
    ]
    const blockers = blockerPositions.map(([x, z], index) => ({
      type: 'throne',
      id: `blocker-${index}`,
      position: [x, 0, z],
    }))
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: blockers,
    })), fallback, { requestsNpc: true })

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.npcInserted).toBe(false)
    expect(result.room.objects.some((object) => object.type === 'npc')).toBe(false)
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('inserted NPC is final-validated and has id plus interaction dialogue', () => {
    const result = assembleRoom(RAW_VALID, fallback, { requestsNpc: true })
    const npc = result.room.objects.find((object) => object.type === 'npc')

    expect(npc).toMatchObject({
      type: 'npc',
      id: 'generated-npc',
      interaction: {
        key: 'F',
      },
    })
    const dialogue = npc && 'interaction' in npc ? npc.interaction.dialogue : undefined
    expect(dialogue).toBeDefined()
    expect(GENERATED_NPC_PERSONAS).toContain(dialogue?.persona)
    expect(dialogue?.greeting?.trim().length).toBeGreaterThan(0)
    expect(dialogue?.prompts?.map((prompt) => prompt.id)).toEqual(['ask-room', 'ask-help'])
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('requestsNpc true with fantasy-keep theme uses a fantasy generated NPC persona', () => {
    const result = assembleRoom(raw(validSpec({
      id: 'fantasy-npc-room',
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    })), fallback, { requestsNpc: true, themePack: 'fantasy-keep' })
    const npc = result.room.objects.find((object) => object.type === 'npc')
    const dialogue = npc && 'interaction' in npc ? npc.interaction.dialogue : undefined

    expect(result.diagnostics.npcInserted).toBe(true)
    expect(FANTASY_KEEP_GENERATED_NPC_PERSONAS).toContain(dialogue?.persona)
    expect(dialogue?.prompts?.map((prompt) => prompt.id)).toEqual(['ask-room', 'ask-help'])
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('requestsNpc true with post-apoc theme uses a post-apoc generated NPC persona', () => {
    const result = assembleRoom(raw(validSpec({
      id: 'post-apoc-npc-room',
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
    })), fallback, { requestsNpc: true, themePack: 'post-apoc' })
    const npc = result.room.objects.find((object) => object.type === 'npc')
    const dialogue = npc && 'interaction' in npc ? npc.interaction.dialogue : undefined

    expect(result.diagnostics.npcInserted).toBe(true)
    expect(POST_APOC_GENERATED_NPC_PERSONAS).toContain(dialogue?.persona)
    expect(dialogue?.prompts?.map((prompt) => prompt.id)).toEqual(['ask-room', 'ask-help'])
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('NPC diagnostics are boolean-only and do not include prompt or generated text', () => {
    const promptText = 'SECRET_RAW_PROMPT'
    const result = assembleRoom(raw(validSpec({
      name: 'SECRET_ROOM_NAME',
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      objects: [{
        type: 'book',
        id: 'SECRET_OBJECT_ID',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'SECRET_INTERACTION_PROMPT',
          body: 'SECRET_GENERATED_BODY',
        },
      }],
    })), fallback, { requestsNpc: true })

    const diagnosticsJson = JSON.stringify(result.diagnostics)
    expect(typeof result.diagnostics.npcInserted).toBe('boolean')
    for (const forbidden of [
      promptText,
      'SECRET_ROOM_NAME',
      'SECRET_OBJECT_ID',
      'SECRET_INTERACTION_PROMPT',
      'SECRET_GENERATED_BODY',
    ]) {
      expect(diagnosticsJson).not.toContain(forbidden)
    }
  })

  // --- generated-room NPC dialogue spec normalization (generated-npc-dialogue-spec-v0 Slice 3) ---
  //
  // Stage 2.12.2 runs unconditionally (not gated by requestsNpc) right after
  // Stage 2.12 NPC presence and before objective enrichment, so any generated-room
  // NPC that has an interaction but no interaction.dialogue becomes talkable: it
  // gets a collision-safe id (if absent) plus a deterministic dialogue spec.

  it('generator NPC with no id and no dialogue gets an id and a dialogue spec', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{
        type: 'npc',
        name: 'Guide',
        position: [-4, 0, 0],
        interaction: { key: 'F', prompt: 'Press F to speak with Guide', body: 'Guide nods quietly.' },
      }],
    })), fallback)

    const npc = result.room.objects.find((object) => object.type === 'npc')
    const dialogue = npc && 'interaction' in npc ? npc.interaction.dialogue : undefined

    expect(npc?.id).toBeTruthy()
    expect(dialogue).toBeDefined()
    expect(dialogue?.prompts?.map((prompt) => prompt.id)).toEqual(['ask-room', 'ask-help'])
    expect(result.diagnostics.npcDialogueNormalizedCount).toBeGreaterThanOrEqual(1)
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('generator NPC with an existing id but no dialogue keeps its id and gains a dialogue spec', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{
        type: 'npc',
        id: 'raw-npc-id',
        name: 'Guide',
        position: [-4, 0, 0],
        interaction: { key: 'F', prompt: 'Press F to speak with Guide', body: 'Guide nods quietly.' },
      }],
    })), fallback)

    const npc = result.room.objects.find((object) => object.type === 'npc')
    const dialogue = npc && 'interaction' in npc ? npc.interaction.dialogue : undefined

    expect(npc?.id).toBe('raw-npc-id')
    expect(dialogue).toBeDefined()
    expect(result.diagnostics.npcDialogueNormalizedCount).toBe(1)
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('generator NPC with dialogue but no id is assigned an id and keeps its dialogue, not counted', () => {
    const existingDialogue = { greeting: 'I have already arrived.' }
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{
        type: 'npc',
        name: 'Guide',
        position: [-4, 0, 0],
        interaction: {
          key: 'F',
          prompt: 'Press F to speak with Guide',
          body: 'Guide nods quietly.',
          dialogue: existingDialogue,
        },
      }],
    })), fallback)

    const npc = result.room.objects.find((object) => object.type === 'npc')
    const dialogue = npc && 'interaction' in npc ? npc.interaction.dialogue : undefined

    expect(npc?.id).toBeTruthy()
    expect(dialogue).toEqual(existingDialogue)
    expect(result.diagnostics.npcDialogueNormalizedCount).toBe(0)
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('normalizes a dialogue-less generator NPC even without requestsNpc (adjacent-style path)', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{
        type: 'npc',
        name: 'Guide',
        position: [-4, 0, 0],
        interaction: { key: 'F', prompt: 'Press F to speak with Guide', body: 'Guide nods quietly.' },
      }],
    })), fallback, {})

    const npc = result.room.objects.find((object) => object.type === 'npc')
    const dialogue = npc && 'interaction' in npc ? npc.interaction.dialogue : undefined

    expect(npc?.id).toBeTruthy()
    expect(dialogue).toBeDefined()
    expect(result.diagnostics.npcDialogueNormalizedCount).toBeGreaterThanOrEqual(1)
  })

  it('leaves an NPC with existing id and dialogue byte-identical', () => {
    const npcObject = {
      type: 'npc',
      id: 'existing-npc',
      name: 'Existing Guide',
      position: [-4, 0, 0],
      interaction: {
        key: 'F',
        prompt: 'Talk',
        body: 'Existing safe body.',
        dialogue: { greeting: 'Hello.' },
      },
    }
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [npcObject],
    })), fallback)

    const npc = result.room.objects.find((object) => object.type === 'npc')
    expect(npc).toMatchObject(npcObject)
    expect(result.diagnostics.npcDialogueNormalizedCount).toBe(0)
  })

  it('npcDialogueNormalizedCount is 0 for all fallback paths', () => {
    const paths = [RAW_INVALID_JSON, RAW_INVALID_SCHEMA, RAW_UNREPAIRABLE, RAW_REPAIR_THEN_FAIL]
    for (const input of paths) {
      const { diagnostics } = assembleRoom(input, fallback)
      expect(diagnostics.npcDialogueNormalizedCount).toBe(0)
    }
  })

  it('ensureGeneratedNpcPresence-inserted NPC already has dialogue, so normalization does not double-count', () => {
    const result = assembleRoom(RAW_VALID, fallback, { requestsNpc: true })
    expect(result.diagnostics.npcInserted).toBe(true)
    expect(result.diagnostics.npcDialogueNormalizedCount).toBe(0)
    expect(validateRoom(result.room).ok).toBe(true)
  })

  // --- generated-room display text sanitization (Slice B) ---
  //
  // Structural generated ids may remain authoritative identity/navigation data,
  // but must not leak through allowlisted player-facing display fields.

  it('sanitizes adjacent-style generated structural ids from player-facing display fields', () => {
    const result = assembleRoom(raw(validSpec({
      id: 'adjacent:gen-1234abcd:exit:north',
      name: 'Generated room - adjacent:gen-1234abcd:exit:north',
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        {
          type: 'arch',
          id: 'adjacent:gen-1234abcd:exit:north',
          position: [0, 0, -9],
          interaction: {
            key: 'E',
            prompt: 'Generated room - adjacent:gen-1234abcd:exit:north',
            exit: { toRoomId: 'adjacent:gen-1234abcd:exit:north' },
          },
        },
        {
          type: 'scroll',
          id: 'scroll-1',
          position: [3, 0, -2],
          interaction: {
            key: 'E',
            prompt: 'Read',
            body: 'The scroll reads: "adjacent:gen-1234abcd:exit:north"',
          },
        },
        {
          type: 'npc',
          id: 'npc-1',
          name: 'Guide adjacent:gen-1234abcd:exit:north',
          position: [-3, 0, -2],
          interaction: {
            key: 'F',
            prompt: 'Talk to adjacent:gen-1234abcd:exit:north',
            body: 'They gesture toward adjacent:gen-1234abcd:exit:north.',
            dialogue: {
              persona: 'adjacent:gen-1234abcd:exit:north',
              greeting: 'I came from adjacent:gen-1234abcd:exit:north.',
              prompts: [
                {
                  id: 'ask-adjacent:gen-1234abcd:exit:north',
                  label: 'Ask about adjacent:gen-1234abcd:exit:north',
                },
              ],
            },
          },
        },
      ],
    })), fallback)

    const arch = result.room.objects.find((object) => object.type === 'arch')
    const scroll = result.room.objects.find((object) => object.type === 'scroll')
    const npc = result.room.objects.find((object) => object.type === 'npc')

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.displayTextSanitized).toBe(true)
    expect(result.diagnostics.displayTextSanitizationCount).toBeGreaterThan(0)
    expect(result.room.name).toBe('Generated room')
    expect(interactionFor(arch!)?.prompt).toBe('Generated room - a nearby room')
    expect(interactionFor(scroll!)?.body).toBe('The scroll reads: "a nearby room"')
    expect(npc).toMatchObject({ name: 'Guide a nearby room' })
    expect(interactionFor(npc!)?.prompt).toBe('Talk to a nearby room')
    expect(interactionFor(npc!)?.body).toBe('They gesture toward a nearby room.')
    expect(interactionFor(npc!)?.dialogue?.greeting).toBe('I came from a nearby room.')
    expect(interactionFor(npc!)?.dialogue?.prompts?.[0]?.label).toBe('Ask about a nearby room')
  })

  it('keeps structural room id, object id, dialogue ids, and exit target unchanged after display sanitization', () => {
    const result = assembleRoom(raw(validSpec({
      id: 'adjacent:gen-1234abcd:exit:north',
      name: 'Generated room - adjacent:gen-1234abcd:exit:north',
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        {
          type: 'arch',
          id: 'adjacent:gen-1234abcd:exit:north',
          position: [0, 0, -9],
          interaction: {
            key: 'E',
            prompt: 'Enter adjacent:gen-1234abcd:exit:north',
            exit: { toRoomId: 'adjacent:gen-1234abcd:exit:north' },
          },
        },
        {
          type: 'npc',
          id: 'npc-1',
          name: 'Mira',
          position: [-3, 0, -2],
          interaction: {
            key: 'F',
            prompt: 'Talk',
            dialogue: {
              persona: 'adjacent:gen-1234abcd:exit:north',
              prompts: [
                {
                  id: 'ask-adjacent:gen-1234abcd:exit:north',
                  label: 'Ask about adjacent:gen-1234abcd:exit:north',
                },
              ],
            },
          },
        },
      ],
    })), fallback)

    const arch = result.room.objects.find((object) => object.type === 'arch')
    const npc = result.room.objects.find((object) => object.type === 'npc')

    expect(result.room.id).toBe('adjacent:gen-1234abcd:exit:north')
    expect(arch?.id).toBe('adjacent:gen-1234abcd:exit:north')
    expect(interactionFor(arch!)?.exit?.toRoomId).toBe('adjacent:gen-1234abcd:exit:north')
    expect(interactionFor(npc!)?.dialogue?.persona).toBe('adjacent:gen-1234abcd:exit:north')
    expect(interactionFor(npc!)?.dialogue?.prompts?.[0]?.id).toBe(
      'ask-adjacent:gen-1234abcd:exit:north',
    )
    expect(interactionFor(arch!)?.prompt).toBe('Enter a nearby room')
    expect(interactionFor(npc!)?.dialogue?.prompts?.[0]?.label).toBe('Ask about a nearby room')
  })

  it('clean generated content reports no display text sanitization', () => {
    const result = assembleRoom(RAW_VALID, fallback)

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.displayTextSanitized).toBe(false)
    expect(result.diagnostics.displayTextSanitizationCount).toBe(0)
  })

  it('fallback branches report no display text sanitization', () => {
    const semanticWithContaminatedText = raw(validSpec({
      name: 'Generated room - adjacent:gen-1234abcd:exit:north',
      shell: { dimensions: { width: 18, depth: 18, height: 400 }, exits: [{ side: 'north', width: 3 }] },
      objects: [{
        type: 'scroll',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Read adjacent:gen-1234abcd:exit:north',
          body: 'The scroll reads adjacent:gen-1234abcd:exit:north.',
        },
      }],
    }))

    for (const input of [RAW_INVALID_JSON, RAW_INVALID_SCHEMA, semanticWithContaminatedText]) {
      const { room, diagnostics } = assembleRoom(input, fallback)
      expect(room).toBe(fallback)
      expect(diagnostics.provenance).toBe('fallback')
      expect(diagnostics.displayTextSanitized).toBe(false)
      expect(diagnostics.displayTextSanitizationCount).toBe(0)
    }
  })

  it('returns generated rooms with safe synthesized interaction title and body', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        { type: 'book', position: [-6, 0, -1] },
        { type: 'chest', position: [-2, 0, -1] },
        { type: 'altar', position: [-2, 0, 1] },
        { type: 'corpse', position: [4, 0, -1] },
      ],
    })), fallback)

    const interactions = new Map(result.room.objects.map((object) => [
      object.type,
      interactionFor(object),
    ]))

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.failedStage).toBeUndefined()
    expect(result.diagnostics.repairAttempted).toBe(false)
    expect(result.diagnostics.purposesAssigned).toBe(4)
    expect(interactions.get('book')).toEqual({
      key: 'E',
      prompt: 'Read',
      title: 'Read',
      body: READ_BODY,
    })
    expect(interactions.get('chest')).toEqual({
      key: 'E',
      prompt: 'Inspect',
      title: 'Inspect',
      body: INSPECT_BODY,
    })
    expect(interactions.get('altar')).toEqual({
      key: 'E',
      prompt: 'Examine',
      title: 'Examine',
      body: EXAMINE_BODY,
    })
    expect(interactions.get('corpse')).toEqual({
      key: 'E',
      prompt: 'Inspect',
      title: 'Inspect',
      body: CORPSE_BODY,
    })
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('counts only newly synthesized purposes and keeps provenance generated', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        { type: 'book', position: [-2, 0, 0] },
        {
          type: 'chest',
          position: [0, 0, 0],
          interaction: { key: 'E', prompt: 'Open', body: 'Existing generated interaction.' },
        },
        { type: 'statue', position: [2, 0, 0] },
        { type: 'torch', position: [7, 2.2, 7] },
      ],
    })), fallback)

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.failedStage).toBeUndefined()
    expect(result.diagnostics.repairAttempted).toBe(false)
    expect(result.diagnostics.purposesAssigned).toBe(2)
  })

  it('preserves existing generated interactions and does not overwrite title, body, or effect', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        {
          type: 'chest',
          position: [0, 0, 0],
          interaction: {
            key: 'E',
            prompt: 'Search cache',
            title: 'Existing cache title',
            body: 'Existing safe body.',
            effect: { kind: 'inspect', flag: 'cache-seen' },
          },
        },
      ],
    })), fallback)

    const chest = result.room.objects[0]!
    const interaction = interactionFor(chest)

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.failedStage).toBeUndefined()
    expect(result.diagnostics.repairAttempted).toBe(false)
    expect(result.diagnostics.purposesAssigned).toBe(0)
    expect(interaction).toEqual({
      key: 'E',
      prompt: 'Search cache',
      title: 'Existing cache title',
      body: 'Existing safe body.',
      effect: { kind: 'inspect', flag: 'cache-seen' },
    })
  })

  it('leaves unsupported and excluded generated object types unchanged', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        { type: 'throne', position: [0, 0, -6] },
        { type: 'arch', position: [0, 0, -8] },
        { type: 'pillar', position: [-4, 0, -4] },
        { type: 'rug', position: [0, 0.01, 0] },
        { type: 'torch', position: [7, 2.2, -7] },
        { type: 'candle', position: [2, 0.8, 2] },
        { type: 'prop', position: [3, 0, 3] },
        { type: 'debris', position: [-3, 0, 3] },
        { type: 'barricade', position: [4, 0, 0] },
        { type: 'zombie', name: 'Shambler', position: [-4, 0, 0] },
        {
          type: 'scroll',
          position: [4, 0, 2],
          interaction: { key: 'E', prompt: 'Read scroll', body: 'Existing scroll body.' },
        },
        {
          type: 'npc',
          name: 'Mira',
          position: [-4, 0, 2],
          interaction: { key: 'F', prompt: 'Talk', body: 'Existing NPC body.' },
        },
      ],
    })), fallback)

    expect(result.diagnostics.purposesAssigned).toBe(0)
    for (const object of nonExitObjects(result.room)) {
      if (object.type === 'scroll' || object.type === 'npc') {
        expect('interaction' in object ? object.interaction : undefined).toBeDefined()
      } else {
        expect(object).not.toHaveProperty('interaction')
      }
    }
  })

  it('does not run purpose assignment on direct loadRoomSpec authored/static/restored paths', () => {
    const loaded = loadRoomSpec({
      schemaVersion: 1,
      id: 'authored',
      name: 'Authored Room',
      shell: { dimensions: { width: 8, depth: 8, height: 4 } },
      spawn: { position: [0, 1.7, 0] },
      objects: [
        { type: 'book', position: [0, 0, 0] },
        { type: 'chest', position: [2, 0, 0] },
      ],
    })

    expect(loaded.objects).toHaveLength(2)
    expect(loaded.objects[0]).not.toHaveProperty('interaction')
    expect(loaded.objects[1]).not.toHaveProperty('interaction')
    expect(buildInteractables(loaded)).toEqual([])
  })

  it('fallback branches report purposesAssigned 0 and do not mutate the authored fallback room', () => {
    const fallbackBefore = JSON.parse(JSON.stringify(fallback))
    const semanticWithAssignableObject = raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 400 }, exits: [{ side: 'north', width: 3 }] },
      objects: [{ type: 'book', position: [0, 0, 0] }],
    }))

    for (const input of [
      RAW_INVALID_JSON,
      RAW_INVALID_SCHEMA,
      RAW_UNREPAIRABLE,
      RAW_REPAIR_THEN_FAIL,
      semanticWithAssignableObject,
    ]) {
      const { room, diagnostics } = assembleRoom(input, fallback)
      expect(room).toBe(fallback)
      expect(diagnostics.provenance).toBe('fallback')
      expect(diagnostics.purposesAssigned).toBe(0)
    }
    expect(fallback).toEqual(fallbackBefore)
  })

  it('synthesized interactions become buildInteractables/HUD eligible with safe title and body', () => {
    const leakedName = 'ProviderTrace raw-json {"prompt":"steal-name"} generated_object_name'
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [
        { id: 'generated-book', type: 'book', name: leakedName, position: [-2, 0, 0] },
        { id: 'generated-chest', type: 'chest', name: leakedName, position: [2, 0, 0] },
      ],
    })), fallback)

    const byId = new Map(buildInteractables(result.room).map((interactable) => [
      interactable.id,
      interactable,
    ]))
    const book = byId.get('generated-book')
    const chest = byId.get('generated-chest')

    expect(result.diagnostics.purposesAssigned).toBe(2)
    expect(book).toMatchObject({
      type: 'book',
      label: 'book',
      affordance: 'inspect',
      key: 'E',
      prompt: 'Read',
      title: 'Read',
      body: READ_BODY,
    })
    expect(chest).toMatchObject({
      type: 'chest',
      label: 'chest',
      affordance: 'inspect',
      key: 'E',
      prompt: 'Inspect',
      title: 'Inspect',
      body: INSPECT_BODY,
    })
    expect(JSON.stringify(book)).not.toContain('ProviderTrace')
    expect(JSON.stringify(chest)).not.toContain('ProviderTrace')
    expect(JSON.stringify(chest)).not.toContain('steal-name')
    expect(JSON.stringify(chest)).not.toContain('generated_object_name')
  })

  it('enrichObjectiveTarget false/default preserves current behavior', () => {
    const input = raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{ type: 'book', position: [0, 0, -2] }],
    }))

    const implicitDefault = assembleRoom(input, fallback)
    const explicitFalse = assembleRoom(input, fallback, { enrichObjectiveTarget: false })

    expect(implicitDefault.diagnostics.objectiveTargetEnriched).toBe(false)
    expect(explicitFalse.diagnostics.objectiveTargetEnriched).toBe(false)
    expect(interactionFor(implicitDefault.room.objects.find((object) => object.type === 'book')!)?.effect).toBeUndefined()
    expect(explicitFalse).toEqual(implicitDefault)
  })

  it('deriveMechanicalGateDiagnostic is off by default and reports no gate', () => {
    const input = raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{ type: 'book', position: [0, 0, -2] }],
    }))

    const implicitDefault = assembleRoom(input, fallback)
    const explicitFalse = assembleRoom(input, fallback, {
      enrichObjectiveTarget: true,
      deriveMechanicalGateDiagnostic: false,
    })

    expect(implicitDefault.diagnostics.mechanicalGateAvailable).toBe(false)
    expect(explicitFalse.diagnostics.mechanicalGateAvailable).toBe(false)
  })

  it('deriveMechanicalGateDiagnostic true reports only mechanicalGateAvailable for a gated room', () => {
    const result = assembleRoom(raw(validSpec({
      id: 'secret-room-id',
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{ type: 'book', name: 'Secret Book Name', position: [0, 0, -2] }],
    })), fallback, {
      enrichObjectiveTarget: true,
      deriveMechanicalGateDiagnostic: true,
    })

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.objectiveTargetEnriched).toBe(true)
    expect(result.diagnostics.mechanicalGateAvailable).toBe(true)
    expect(Object.keys(result.diagnostics)).toContain('mechanicalGateAvailable')

    const diagnosticDump = JSON.stringify(result.diagnostics)
    expect(diagnosticDump).not.toContain('secret-room-id')
    expect(diagnosticDump).not.toContain('generated-objective-target')
    expect(diagnosticDump).not.toContain('interaction:generated-objective-target')
    expect(diagnosticDump).not.toContain('adjacent:')
    expect(diagnosticDump).not.toContain('Secret Book Name')
    expect(diagnosticDump).not.toContain('mechanical-gate')
    expect(diagnosticDump).not.toContain('locked-exit')
    expect(diagnosticDump).not.toContain('unlock-exit')
  })

  it('deriveMechanicalGateDiagnostic true reports false when no flag-writer exists', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{ type: 'pillar', position: [0, 0, -2] }],
    })), fallback, { deriveMechanicalGateDiagnostic: true })

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.mechanicalGateAvailable).toBe(false)
  })

  it('deriveMechanicalGateDiagnostic true reports false on fallback paths', () => {
    for (const input of [RAW_INVALID_JSON, RAW_INVALID_SCHEMA, RAW_UNREPAIRABLE]) {
      const { room, diagnostics } = assembleRoom(input, fallback, {
        enrichObjectiveTarget: true,
        deriveMechanicalGateDiagnostic: true,
      })
      expect(room).toBe(fallback)
      expect(diagnostics.provenance).toBe('fallback')
      expect(diagnostics.mechanicalGateAvailable).toBe(false)
    }
  })

  it('enrichObjectiveTarget true promotes an eligible object through assembleRoom', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{ type: 'book', position: [0, 0, -2] }],
    })), fallback, { enrichObjectiveTarget: true })

    const book = result.room.objects.find((object) => object.type === 'book')!
    const interaction = interactionFor(book)

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.objectiveTargetEnriched).toBe(true)
    expect(book.id).toBe('generated-objective-target')
    expect(interaction).toMatchObject({
      key: 'E',
      prompt: 'Read',
      title: 'Read',
      body: READ_BODY,
      effect: { kind: 'inspect' },
    })
    expect(interaction?.effect).not.toHaveProperty('flag')
    expect(validateRoom(result.room).ok).toBe(true)
  })

  it('objectiveTargetEnriched is false when enrichment no-ops', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{
        type: 'scroll',
        id: 'objective-document',
        position: [0, 0.5, -2],
        interaction: { key: 'E', prompt: 'Read', body: 'Existing safe body.', effect: { kind: 'inspect' } },
      }],
    })), fallback, { enrichObjectiveTarget: true })

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.objectiveTargetEnriched).toBe(false)
    expect(result.room.objects).toHaveLength(2)
  })

  it('objectiveTargetEnriched is false for fallback paths', () => {
    const semanticWithAssignableObject = raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 400 }, exits: [{ side: 'north', width: 3 }] },
      objects: [{ type: 'book', position: [0, 0, 0] }],
    }))

    for (const input of [RAW_INVALID_JSON, RAW_INVALID_SCHEMA, semanticWithAssignableObject]) {
      const { room, diagnostics } = assembleRoom(input, fallback, { enrichObjectiveTarget: true })
      expect(room).toBe(fallback)
      expect(diagnostics.provenance).toBe('fallback')
      expect(diagnostics.objectiveTargetEnriched).toBe(false)
    }
  })

  it('final validateRoom still runs after objective target enrichment', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      spawn: { position: [0, 1.7, 5] },
      objects: [{ type: 'book', position: [0, 10, -2] }],
    })), fallback, { enrichObjectiveTarget: true })

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.objectiveTargetEnriched).toBe(true)
    expect(result.diagnostics.warningCount).toBeGreaterThan(0)
    expect(validateRoom(result.room).issues.some((issue) => issue.code === 'object-above-ceiling')).toBe(true)
  })

  // --- generated-room optional transform repair (Slice 7F) ---
  //
  // Stage 1.6 removes malformed optional `rotationY` / `scale` fields before
  // loadRoomSpec so otherwise-valid generated objects can receive schema
  // defaults. It is a benign normalization: provenance stays 'generated', no
  // repair/fallback notice. Only the integer count is reported.

  it('repairs malformed optional transform fields before validation and keeps objects', () => {
    const { room, diagnostics } = assembleRoom(RAW_MALFORMED_TRANSFORMS, fallback)

    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.objectTransformsRepaired).toBe(3)
    expect(diagnostics.skippedObjectCount).toBe(0)
    expect(diagnostics.skippedObjectReasonCounts.invalidTransform).toBe(0)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.failedStage).toBeUndefined()
    expect(nonExitObjects(room).map((object) => object.type)).toEqual(['book', 'chest', 'map'])
    expect(nonExitObjects(room).map((object) => object.rotationY)).toEqual([0, 0, 0])
    expect(nonExitObjects(room).map((object) => object.scale)).toEqual([1, 1, 1])
    expect(validateRoom(room).ok).toBe(true)
  })

  it('clean generated room has objectTransformsRepaired 0', () => {
    const { diagnostics } = assembleRoom(RAW_VALID, fallback)
    expect(diagnostics.objectTransformsRepaired).toBe(0)
  })

  it('malformed position still skips after transform repair', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      objects: [{ type: 'book', position: 'not-a-vec', rotationY: 'bad' }],
    })), fallback)

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.objectTransformsRepaired).toBe(1)
    expect(result.diagnostics.skippedObjectCount).toBe(1)
    expect(result.diagnostics.skippedObjectReasonCounts.invalidPosition).toBe(1)
    expect(nonExitObjects(result.room)).toHaveLength(0)
  })

  it('malformed interaction still skips after transform repair', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      objects: [{ type: 'scroll', position: [0, 0, 0], rotationY: 'bad' }],
    })), fallback)

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.objectTransformsRepaired).toBe(1)
    expect(result.diagnostics.skippedObjectCount).toBe(1)
    expect(result.diagnostics.skippedObjectReasonCounts.invalidInteraction).toBe(1)
    expect(nonExitObjects(result.room)).toHaveLength(0)
  })

  it('unknown type still skips after transform repair', () => {
    const result = assembleRoom(raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      objects: [{ type: 'gargoyle', position: [0, 0, 0], scale: 'bad' }],
    })), fallback)

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.diagnostics.objectTransformsRepaired).toBe(1)
    expect(result.diagnostics.skippedObjectCount).toBe(1)
    expect(result.diagnostics.skippedObjectReasonCounts.unknownType).toBe(1)
    expect(nonExitObjects(result.room)).toHaveLength(0)
  })

  it('alias and transform repairs compose before loadRoomSpec', () => {
    const { room, diagnostics } = assembleRoom(RAW_ALIAS_AND_TRANSFORM, fallback)

    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.aliasesRepaired).toBe(1)
    expect(diagnostics.objectTransformsRepaired).toBe(1)
    expect(diagnostics.skippedObjectCount).toBe(0)
    expect(nonExitObjects(room)).toHaveLength(1)
    expect(nonExitObjects(room)[0]!.type).toBe('table')
    expect(nonExitObjects(room)[0]!.rotationY).toBe(0)
    expect(nonExitObjects(room)[0]!.scale).toBe(1)
  })

  it('fallback paths report objectTransformsRepaired 0', () => {
    const semanticWithBadTransform = raw(validSpec({
      shell: { dimensions: { width: 18, depth: 18, height: 400 }, exits: [{ side: 'north', width: 3 }] },
      objects: [{ type: 'book', position: [0, 0, 0], rotationY: 'bad' }],
    }))
    for (const input of [RAW_INVALID_JSON, RAW_INVALID_SCHEMA, RAW_UNREPAIRABLE, semanticWithBadTransform]) {
      const { diagnostics } = assembleRoom(input, fallback)
      expect(diagnostics.provenance).toBe('fallback')
      expect(diagnostics.objectTransformsRepaired).toBe(0)
    }
  })

  it('loadRoomSpec directly still rejects malformed transforms', () => {
    const loaded = loadRoomSpec({
      schemaVersion: 1,
      id: 'authored',
      name: 'Authored Room',
      shell: { dimensions: { width: 8, depth: 8, height: 4 } },
      spawn: { position: [0, 1.7, 0] },
      objects: [{ type: 'book', position: [0, 0, 0], rotationY: 'bad', scale: 0 }],
    })

    expect(loaded.objects).toHaveLength(0)
    expect(loaded.skipped).toHaveLength(1)
    expect(loaded.skippedObjectReasonCounts.invalidTransform).toBe(1)
  })

  // --- generated-room alias repair (Slice 7D) ---
  //
  // Stage 1.5 rewrites known natural-language noun type strings to canonical
  // RoomSpec types before loadRoomSpec runs. It is a benign normalization:
  // provenance stays 'generated', no repair/fallback notice. Only the integer
  // count is reported; alias strings are never logged.

  it('aliased object types are rewritten and appear in room.objects, provenance "generated"', () => {
    const { room, diagnostics } = assembleRoom(RAW_WITH_ALIASES, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.aliasesRepaired).toBe(2)
    expect(diagnostics.skippedObjectCount).toBe(0)
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.failedStage).toBeUndefined()
    const types = room.objects.map((o) => o.type)
    expect(types).toContain('table')   // "desk" → table
    expect(types).toContain('corpse')  // "skeleton" → corpse
    expect(validateRoom(room).ok).toBe(true)
  })

  it('aliasesRepaired equals the number of rewritten type entries', () => {
    const { diagnostics } = assembleRoom(RAW_WITH_ALIASES, fallback)
    expect(diagnostics.aliasesRepaired).toBe(2)
  })

  it('alias repair is a benign normalization: provenance stays "generated", no repair notice', () => {
    const { diagnostics } = assembleRoom(RAW_WITH_ALIASES, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.repairAttempted).toBe(false)
    expect(diagnostics.failedStage).toBeUndefined()
  })

  it('malformed aliased object is still skipped by loadRoomSpec after type repair', () => {
    // "desk" → "table" at Stage 1.5, but position:"not-a-vec" is invalid → skipped.
    const { room, diagnostics } = assembleRoom(RAW_ALIAS_MALFORMED, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.aliasesRepaired).toBe(1) // type WAS rewritten
    expect(diagnostics.skippedObjectCount).toBe(1) // but object still rejected
    expect(nonExitObjects(room)).toHaveLength(0)
  })

  it('unmapped alias stays skipped (mystery marker), aliasesRepaired 0', () => {
    // "lamp" is in the deferred list: not in the alias table → unchanged → skipped.
    const { room, diagnostics } = assembleRoom(RAW_UNMAPPED_ALIAS, fallback)
    expect(diagnostics.provenance).toBe('generated')
    expect(diagnostics.aliasesRepaired).toBe(0)
    expect(diagnostics.skippedObjectCount).toBe(1)
    expect(nonExitObjects(room)).toHaveLength(0)
  })

  it('json parse error path reports aliasesRepaired 0', () => {
    const { diagnostics } = assembleRoom(RAW_INVALID_JSON, fallback)
    expect(diagnostics.aliasesRepaired).toBe(0)
    expect(diagnostics.provenance).toBe('fallback')
  })

  it('schema fallback path reports aliasesRepaired 0', () => {
    const { diagnostics } = assembleRoom(RAW_INVALID_SCHEMA, fallback)
    expect(diagnostics.aliasesRepaired).toBe(0)
    expect(diagnostics.provenance).toBe('fallback')
  })

  it('semantic fallback path (unrepairable room) reports aliasesRepaired 0', () => {
    const { diagnostics } = assembleRoom(RAW_UNREPAIRABLE, fallback)
    expect(diagnostics.aliasesRepaired).toBe(0)
    expect(diagnostics.provenance).toBe('fallback')
  })

  it('aliasesRepaired is 0 for a valid room with only canonical types', () => {
    const { diagnostics } = assembleRoom(RAW_VALID, fallback)
    expect(diagnostics.aliasesRepaired).toBe(0)
  })

  it('loadRoomSpec directly does not repair aliases (authored/static/restored path is untouched)', () => {
    // Directly calling loadRoomSpec (as authored/static/restored rooms do) must NOT
    // alias-repair: "desk" is unknown and ends up in skipped, not objects.
    const loaded = loadRoomSpec({
      schemaVersion: 1,
      id: 'authored',
      name: 'Authored Room',
      shell: { dimensions: { width: 8, depth: 8, height: 4 } },
      spawn: { position: [0, 1.7, 0] },
      objects: [{ type: 'desk', position: [1, 0, 1] }],
    })
    expect(loaded.objects).toHaveLength(0)    // not repaired by loadRoomSpec
    expect(loaded.skipped).toHaveLength(1)    // stays skipped
    expect(loaded.skipped[0]!.type).toBe('desk')
  })

  it('alias repair is deterministic', () => {
    expect(assembleRoom(RAW_WITH_ALIASES, fallback)).toEqual(
      assembleRoom(RAW_WITH_ALIASES, fallback),
    )
  })

  it('aliasesRepaired is false for all fallback paths (authored fallback is untouched)', () => {
    const paths = [RAW_INVALID_JSON, RAW_INVALID_SCHEMA, RAW_UNREPAIRABLE, RAW_REPAIR_THEN_FAIL]
    for (const input of paths) {
      const { diagnostics } = assembleRoom(input, fallback)
      expect(diagnostics.aliasesRepaired).toBe(0)
    }
  })
})
