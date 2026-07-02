import generatedRoomCacheSaveStateSource from './generatedRoomCacheSaveState.ts?raw'
import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import type { RoomSpec } from '../roomSpec'
import {
  GENERATED_ROOM_CACHE_MAX,
  buildGeneratedRoomCacheSaveState,
  loadGeneratedRoomCacheSaveState,
  objectiveMatchesRoom,
  type SavedGeneratedRoomObjective,
  type GeneratedRoomCacheSaveInput,
} from './generatedRoomCacheSaveState'
import type { QuestSpec } from './questSpec'

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

function makeObjective(
  room: LoadedRoom,
  condition: QuestSpec['objectives'][number]['condition'] = {
    kind: 'room-flag',
    roomId: room.id,
    flag: `interaction:${room.id}-case-file`,
  },
): SavedGeneratedRoomObjective {
  return {
    questSpec: {
      questId: `${room.id}-objective`,
      title: 'Find the clue',
      anchorRoomId: room.id,
      objectives: [{ id: 'generated-0', text: 'Inspect the clue.', condition }],
    },
    hint: 'Look for a marked clue.',
    completionHint: 'The clue is resolved.',
  }
}

function makeEncounterRoom(id = 'encounter-room'): LoadedRoom {
  return makeRoom(id, {
    objects: [
      {
        type: 'scroll',
        id: `${id}-case-file`,
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
      {
        type: 'statue',
        id: `${id}-sentinel`,
        position: [2, 0, -2],
        interaction: {
          key: 'F',
          prompt: 'Face',
          encounter: {
            id: `${id}-encounter`,
            title: 'Sentinel',
            description: 'A sentinel blocks the way.',
            choices: [
              {
                id: 'steady',
                action: 'negotiate',
                label: 'Stand firm',
                outcome: {
                  resultText: 'The sentinel yields.',
                  effects: [{ kind: 'add-status', status: 'sentinel-resolved' }],
                },
              },
            ],
          },
        },
      },
      {
        type: 'arch',
        id: `${id}-north-arch`,
        position: [0, 0, -8],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: `${id}-north` } },
      },
    ],
  })
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

  it('old save without objective still parses', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()

    const loaded = loadGeneratedRoomCacheSaveState(JSON.stringify(state))

    expect(loaded.ok).toBe(true)
    expect(loaded.ok ? loaded.state.rooms[0]?.objective : 'missing').toBeUndefined()
  })

  it('round-trips with a valid objective', () => {
    const room = makeRoom()
    const objective = makeObjective(room)
    const state = buildGeneratedRoomCacheSaveState(
      makeInput({ rooms: [{ room, provenance: 'generated', objective }] }),
    )

    const loaded = loadGeneratedRoomCacheSaveState(JSON.stringify(state))

    expect(state?.rooms[0]?.objective).toEqual(objective)
    expect(loaded).toEqual({ ok: true, state })
  })

  it('malformed objective does not invalidate the room or cache', () => {
    const room = makeRoom()
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()

    const loaded = loadGeneratedRoomCacheSaveState(
      JSON.stringify({
        ...state,
        rooms: [{ ...state!.rooms[0], objective: { questSpec: 'bad' } }],
      }),
    )

    expect(loaded.ok).toBe(true)
    expect(loaded.ok ? loaded.state.rooms[0]?.room.id : null).toBe(room.id)
    expect(loaded.ok ? loaded.state.rooms[0]?.objective : 'missing').toBeUndefined()
  })

  it('does not emit invalid, empty, or overlong hint objectives', () => {
    const room = makeRoom()
    const valid = makeObjective(room)

    const emptyHint = buildGeneratedRoomCacheSaveState(
      makeInput({ rooms: [{ room, provenance: 'generated', objective: { ...valid, hint: '' } }] }),
    )
    const overlongHint = buildGeneratedRoomCacheSaveState(
      makeInput({
        rooms: [
          {
            room,
            provenance: 'generated',
            objective: { ...valid, hint: 'x'.repeat(161) },
          },
        ],
      }),
    )

    expect(emptyHint?.rooms[0]?.objective).toBeUndefined()
    expect(overlongHint?.rooms[0]?.objective).toBeUndefined()
  })

  it('schema-valid but semantically mismatched objective restores as absent', () => {
    const room = makeRoom()
    const mismatched = makeObjective(room, {
      kind: 'room-flag',
      roomId: room.id,
      flag: 'interaction:missing-object',
    })

    const state = buildGeneratedRoomCacheSaveState(
      makeInput({ rooms: [{ room, provenance: 'generated', objective: mismatched }] }),
    )

    expect(state?.rooms[0]?.objective).toBeUndefined()
  })

  it('interaction objective round-trips', () => {
    const room = makeRoom()
    const objective = makeObjective(room, {
      kind: 'room-flag',
      roomId: room.id,
      flag: `interaction:${room.id}-case-file`,
    })

    const state = buildGeneratedRoomCacheSaveState(
      makeInput({ rooms: [{ room, provenance: 'generated', objective }] }),
    )

    expect(loadGeneratedRoomCacheSaveState(JSON.stringify(state))).toEqual({ ok: true, state })
    expect(state?.rooms[0]?.objective).toEqual(objective)
  })

  it('encounter objective round-trips', () => {
    const room = makeEncounterRoom()
    const objective = makeObjective(room, {
      kind: 'room-flag',
      roomId: room.id,
      flag: `encounter:${room.id}-encounter`,
    })

    const state = buildGeneratedRoomCacheSaveState(
      makeInput({ rooms: [{ room, provenance: 'generated', objective }] }),
    )

    expect(loadGeneratedRoomCacheSaveState(JSON.stringify(state))).toEqual({ ok: true, state })
    expect(state?.rooms[0]?.objective).toEqual(objective)
  })

  it('room-visited self round-trips', () => {
    const room = makeRoom()
    const objective = makeObjective(room, { kind: 'room-visited', roomId: room.id })

    const state = buildGeneratedRoomCacheSaveState(
      makeInput({ rooms: [{ room, provenance: 'generated', objective }] }),
    )

    expect(loadGeneratedRoomCacheSaveState(JSON.stringify(state))).toEqual({ ok: true, state })
    expect(state?.rooms[0]?.objective).toEqual(objective)
  })

  it('room-visited adjacent exit round-trips', () => {
    const room = makeRoom()
    const objective = makeObjective(room, { kind: 'room-visited', roomId: `${room.id}-north` })

    const state = buildGeneratedRoomCacheSaveState(
      makeInput({ rooms: [{ room, provenance: 'generated', objective }] }),
    )

    expect(loadGeneratedRoomCacheSaveState(JSON.stringify(state))).toEqual({ ok: true, state })
    expect(state?.rooms[0]?.objective).toEqual(objective)
  })

  it('room-visited non-adjacent mismatch restores as absent', () => {
    const room = makeRoom()
    const objective = makeObjective(room, { kind: 'room-visited', roomId: 'not-adjacent' })

    const state = buildGeneratedRoomCacheSaveState(
      makeInput({ rooms: [{ room, provenance: 'generated', objective }] }),
    )

    expect(state?.rooms[0]?.objective).toBeUndefined()
  })

  it('multi-objective tamper restores as absent', () => {
    const state = buildGeneratedRoomCacheSaveState(makeInput())
    expect(state).not.toBeNull()
    const room = makeRoom()
    const objective = makeObjective(room)

    const loaded = loadGeneratedRoomCacheSaveState(
      JSON.stringify({
        ...state,
        rooms: [
          {
            ...state!.rooms[0],
            objective: {
              ...objective,
              questSpec: {
                ...objective.questSpec,
                objectives: [
                  objective.questSpec.objectives[0],
                  { ...objective.questSpec.objectives[0], id: 'generated-1' },
                ],
              },
            },
          },
        ],
      }),
    )

    expect(loaded.ok).toBe(true)
    expect(loaded.ok ? loaded.state.rooms[0]?.objective : 'missing').toBeUndefined()
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

  it('cap and eviction drop the room and objective together', () => {
    const rooms = Array.from({ length: GENERATED_ROOM_CACHE_MAX + 1 }, (_, index) => {
      const room = makeRoom(`room-${index}`)
      return {
        room,
        provenance: 'generated' as const,
        objective: makeObjective(room),
      }
    })

    const state = buildGeneratedRoomCacheSaveState(makeInput({ rooms }))

    expect(state?.rooms).toHaveLength(GENERATED_ROOM_CACHE_MAX)
    expect(state?.rooms.every((entry) => entry.objective != null)).toBe(true)
    expect(state?.rooms.some((entry) => entry.room.id === `room-${GENERATED_ROOM_CACHE_MAX}`)).toBe(false)
    expect(JSON.stringify(state)).not.toContain(`room-${GENERATED_ROOM_CACHE_MAX}-objective`)
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

describe('objectiveMatchesRoom', () => {
  it('requires anchor room, exactly one objective, and a supported matching condition', () => {
    const room = makeRoom()
    const objective = makeObjective(room)

    expect(objectiveMatchesRoom(objective.questSpec, room)).toBe(true)
    expect(objectiveMatchesRoom({ ...objective.questSpec, anchorRoomId: 'other-room' }, room)).toBe(false)
    expect(objectiveMatchesRoom({ ...objective.questSpec, objectives: [] }, room)).toBe(false)
    expect(
      objectiveMatchesRoom(
        {
          ...objective.questSpec,
          objectives: [
            objective.questSpec.objectives[0]!,
            { ...objective.questSpec.objectives[0]!, id: 'generated-1' },
          ],
        },
        room,
      ),
    ).toBe(false)
    expect(
      objectiveMatchesRoom(
        makeObjective(room, { kind: 'has-status', status: 'secret' }).questSpec,
        room,
      ),
    ).toBe(false)
  })

  it('does not treat a plain object-id flag as a valid interaction objective', () => {
    const room = makeRoom()

    expect(
      objectiveMatchesRoom(
        makeObjective(room, { kind: 'room-flag', roomId: room.id, flag: `${room.id}-case-file` })
          .questSpec,
        room,
      ),
    ).toBe(false)
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
