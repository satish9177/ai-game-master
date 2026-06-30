import generatedRoomCacheSaveStateSource from './generatedRoomCacheSaveState.ts?raw'
import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import type { RoomSpec } from '../roomSpec'
import {
  GENERATED_ROOM_CACHE_MAX,
  buildGeneratedRoomCacheSaveState,
  loadGeneratedRoomCacheSaveState,
  type GeneratedRoomCacheSaveInput,
} from './generatedRoomCacheSaveState'

function makeRoom(id = 'generated-room', overrides: Partial<RoomSpec> = {}): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name: `Generated Room ${id}`,
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 2.5 }],
    },
    spawn: { position: [0, 0, 0], yaw: 0 },
    lighting: { ambient: { color: '#404858', intensity: 0.6 } },
    objects: [
      {
        type: 'scroll',
        id: `${id}-case-file`,
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
      {
        type: 'arch',
        id: `${id}-north-arch`,
        position: [0, 0, -8],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: `${id}-north` } },
      },
    ],
    ...overrides,
  })
}

function makeInput(overrides: Partial<GeneratedRoomCacheSaveInput> = {}): GeneratedRoomCacheSaveInput {
  return {
    rooms: [{ room: makeRoom(), provenance: 'generated' }],
    ...overrides,
  }
}

function expectInvalidSchema(json: string): void {
  expect(loadGeneratedRoomCacheSaveState(json)).toEqual({
    ok: false,
    code: 'invalid-schema',
  })
}

describe('buildGeneratedRoomCacheSaveState', () => {
  it('returns null for empty room input', () => {
    expect(buildGeneratedRoomCacheSaveState(makeInput({ rooms: [] }))).toBeNull()
  })

  it('builds a valid generated room cache save state', () => {
    const input = makeInput({
      rooms: [
        { room: makeRoom('current-room'), provenance: 'generated' },
        { room: makeRoom('west-room'), provenance: 'repaired' },
      ],
    })

    const state = buildGeneratedRoomCacheSaveState(input)

    expect(state).toEqual({
      schemaVersion: 1,
      rooms: [
        { room: expect.objectContaining({ id: 'current-room' }), provenance: 'generated' },
        { room: expect.objectContaining({ id: 'west-room' }), provenance: 'repaired' },
      ],
    })
  })

  it('round-trips through JSON and load', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()

    const loaded = loadGeneratedRoomCacheSaveState(JSON.stringify(state))

    expect(loaded).toEqual({ ok: true, state })
  })

  it('preserves room ids and object ids internally', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())

    expect(state?.rooms[0]?.room.id).toBe('generated-room')
    expect(state?.rooms[0]?.room.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'generated-room-case-file' }),
        expect.objectContaining({ id: 'generated-room-north-arch' }),
      ]),
    )
  })

  it('parks only RoomSpec data and omits load-time diagnostics', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()
    const room = state!.rooms[0]!.room as Record<string, unknown>

    expect(room.skipped).toBeUndefined()
    expect(room.warnings).toBeUndefined()
    expect(room.skippedObjectReasonCounts).toBeUndefined()
  })

  it('preserves and validates all provenance values', () => {
    const state = buildGeneratedRoomCacheSaveState(
      makeInput({
        rooms: [
          { room: makeRoom('generated-room'), provenance: 'generated' },
          { room: makeRoom('repaired-room'), provenance: 'repaired' },
          { room: makeRoom('fallback-room'), provenance: 'fallback' },
        ],
      }),
    )

    expect(state?.rooms.map((entry) => entry.provenance)).toEqual([
      'generated',
      'repaired',
      'fallback',
    ])
  })

  it('rejects invalid provenance', () => {
    expect(
      buildGeneratedRoomCacheSaveState(
        makeInput({
          rooms: [
            {
              room: makeRoom(),
              provenance: 'unknown',
            },
          ] as unknown as GeneratedRoomCacheSaveInput['rooms'],
        }),
      ),
    ).toBeNull()
  })

  it('accepts a valid themePack and omits it when absent', () => {
    const themed = buildGeneratedRoomCacheSaveState(makeInput({ themePack: 'fantasy-keep' }))
    const unthemed = buildGeneratedRoomCacheSaveState(makeInput())

    expect(themed?.themePack).toBe('fantasy-keep')
    expect(unthemed).not.toBeNull()
    expect('themePack' in unthemed!).toBe(false)
  })

  it('rejects invalid themePack values', () => {
    expect(
      buildGeneratedRoomCacheSaveState(
        makeInput({ themePack: 'sci-fi' } as unknown as GeneratedRoomCacheSaveInput),
      ),
    ).toBeNull()
  })

  it('deduplicates by room id with first occurrence winning', () => {
    const first = makeRoom('same-room', { name: 'First Room' })
    const second = makeRoom('same-room', { name: 'Second Room' })

    const state = buildGeneratedRoomCacheSaveState(
      makeInput({
        rooms: [
          { room: first, provenance: 'generated' },
          { room: second, provenance: 'fallback' },
        ],
      }),
    )

    expect(state?.rooms).toHaveLength(1)
    expect(state?.rooms[0]).toEqual({
      room: expect.objectContaining({ id: 'same-room', name: 'First Room' }),
      provenance: 'generated',
    })
  })

  it('enforces the hard cap deterministically', () => {
    const rooms = Array.from({ length: GENERATED_ROOM_CACHE_MAX + 1 }, (_, index) => ({
      room: makeRoom(`room-${index}`),
      provenance: 'generated' as const,
    }))

    const state = buildGeneratedRoomCacheSaveState(makeInput({ rooms }))

    expect(state?.rooms).toHaveLength(GENERATED_ROOM_CACHE_MAX)
    expect(state?.rooms.map((entry) => entry.room.id)).toEqual(
      rooms.slice(0, GENERATED_ROOM_CACHE_MAX).map((entry) => entry.room.id),
    )
  })

  it('preserves caller order and current-room-first ordering up to the cap', () => {
    const rooms = Array.from({ length: GENERATED_ROOM_CACHE_MAX + 1 }, (_, index) => ({
      room: makeRoom(index === 0 ? 'current-room' : `room-${index}`),
      provenance: 'generated' as const,
    }))

    const state = buildGeneratedRoomCacheSaveState(makeInput({ rooms }))

    expect(state?.rooms[0]?.room.id).toBe('current-room')
    expect(state?.rooms.at(-1)?.room.id).toBe(`room-${GENERATED_ROOM_CACHE_MAX - 1}`)
    expect(state?.rooms.some((entry) => entry.room.id === `room-${GENERATED_ROOM_CACHE_MAX}`)).toBe(false)
  })

  it('returns null for invalid rooms', () => {
    const invalidRoom = {
      ...makeRoom(),
      shell: { dimensions: { width: 0, depth: 18, height: 4 }, exits: [] },
    } as unknown as LoadedRoom

    expect(
      buildGeneratedRoomCacheSaveState(
        makeInput({ rooms: [{ room: invalidRoom, provenance: 'generated' }] }),
      ),
    ).toBeNull()
  })

  it('does not mutate input and is deterministic', () => {
    const input = makeInput({
      rooms: [
        { room: makeRoom('current-room'), provenance: 'generated' },
        { room: makeRoom('west-room'), provenance: 'fallback' },
      ],
      themePack: 'post-apoc',
    })
    const before = JSON.stringify(input)

    const first = buildGeneratedRoomCacheSaveState(input)
    const second = buildGeneratedRoomCacheSaveState(input)

    expect(JSON.stringify(input)).toBe(before)
    expect(second).toEqual(first)
  })

  it('does not serialize prompt, provider, seed, or world bible text outside valid RoomSpec fields', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    const serialized = JSON.stringify(state)

    expect(serialized).not.toContain('SENTINEL_RAW_PROMPT')
    expect(serialized).not.toContain('SENTINEL_PROVIDER_OUTPUT')
    expect(serialized).not.toContain('SENTINEL_ADJACENT_THEME_SEED')
    expect(serialized).not.toContain('SENTINEL_WORLDBIBLE_TEXT')
  })
})

describe('loadGeneratedRoomCacheSaveState', () => {
  it('rejects malformed JSON', () => {
    expect(loadGeneratedRoomCacheSaveState('{bad')).toEqual({
      ok: false,
      code: 'invalid-json',
    })
  })

  it('rejects wrong schemaVersion', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()

    expect(loadGeneratedRoomCacheSaveState(JSON.stringify({ ...state, schemaVersion: 2 }))).toEqual({
      ok: false,
      code: 'unsupported-version',
    })
  })

  it('rejects missing schemaVersion', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()
    const withoutVersion: Record<string, unknown> = { ...state! }
    delete withoutVersion.schemaVersion

    expectInvalidSchema(JSON.stringify(withoutVersion))
  })

  it('rejects missing rooms field', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()
    const withoutRooms: Record<string, unknown> = { ...state! }
    delete withoutRooms.rooms

    expectInvalidSchema(JSON.stringify(withoutRooms))
  })

  it('rejects rooms over the hard cap', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()
    const roomEntry = state!.rooms[0]!

    expectInvalidSchema(
      JSON.stringify({
        ...state,
        rooms: Array.from({ length: GENERATED_ROOM_CACHE_MAX + 1 }, () => roomEntry),
      }),
    )
  })

  it('rejects extra top-level keys', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()

    expectInvalidSchema(JSON.stringify({ ...state, extra: true }))
  })

  it('rejects invalid provenance', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()

    expectInvalidSchema(
      JSON.stringify({
        ...state,
        rooms: [{ ...state!.rooms[0], provenance: 'unknown' }],
      }),
    )
  })

  it('rejects invalid themePack values', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()

    expectInvalidSchema(JSON.stringify({ ...state, themePack: 'sci-fi' }))
  })

  it('rejects invalid rooms', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()

    expectInvalidSchema(
      JSON.stringify({
        ...state,
        rooms: [
          {
            ...state!.rooms[0],
            room: {
              ...state!.rooms[0]!.room,
              shell: { dimensions: { width: -1, depth: 18, height: 4 }, exits: [] },
            },
          },
        ],
      }),
    )
  })

  it('returns fixed error codes without echoing unsafe input', () => {
    const unsafe = 'SENTINEL_RAW_PROMPT interaction:secret-object flag:secret Generated Room'
    const result = loadGeneratedRoomCacheSaveState(
      JSON.stringify({ schemaVersion: 1, rooms: [], unsafe }),
    )

    expect(result).toEqual({ ok: false, code: 'invalid-schema' })
    expect(JSON.stringify(result)).not.toContain('SENTINEL_RAW_PROMPT')
    expect(JSON.stringify(result)).not.toContain('secret-object')
    expect(JSON.stringify(result)).not.toContain('flag:secret')
    expect(JSON.stringify(result)).not.toContain('Generated Room')
  })
})

describe('generatedRoomCacheSaveState import boundary', () => {
  it('does not import forbidden app/runtime modules', () => {
    const source = generatedRoomCacheSaveStateSource
    const forbiddenFragments = [
      '/App',
      '../app',
      '../renderer',
      '../generation',
      '../persistence',
      '../server',
      '../world-session',
      '../memory',
      '../dialogue',
      '../providers',
      '../cost',
      '../SessionRoomCache',
      '../AdjacentRoomPregenerator',
    ]

    for (const fragment of forbiddenFragments) {
      expect(source).not.toContain(fragment)
    }
  })
})
