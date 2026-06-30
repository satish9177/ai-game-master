import generatedQuestSaveStateSource from './generatedQuestSaveState.ts?raw'
import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import type { RoomSpec } from '../roomSpec'
import { GENERATED_OBJECTIVE_TEXT_MAX_LENGTH } from './generatedObjectiveSpec'
import {
  buildGeneratedQuestSaveState,
  loadGeneratedQuestSaveState,
  GeneratedStoryThreadKindSchema,
  type GeneratedQuestSaveInput,
} from './generatedQuestSaveState'
import type { GeneratedStoryThreadKind } from '../generatedStoryThread'
import type { QuestSpec } from './questSpec'

const validStoryKinds = ['escape', 'investigate', 'survive', 'rescue', 'recover-item'] as const

function makeRoom(overrides: Partial<RoomSpec> = {}): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'generated-room',
    name: 'Generated Room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 2.5 }],
    },
    spawn: { position: [0, 0, 0], yaw: 0 },
    lighting: { ambient: { color: '#404858', intensity: 0.6 } },
    objects: [
      {
        type: 'scroll',
        id: 'case-file',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
      {
        type: 'arch',
        id: 'north-arch',
        position: [0, 0, -8],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'north-room' } },
      },
    ],
    ...overrides,
  })
}

function makeQuestSpec(overrides: Partial<QuestSpec> = {}): QuestSpec {
  return {
    questId: 'generated-room-objective',
    title: 'Resolve the room',
    anchorRoomId: 'generated-room',
    objectives: [
      {
        id: 'generated-0',
        text: 'Inspect the useful object.',
        condition: { kind: 'room-flag', roomId: 'generated-room', flag: 'interaction:case-file' },
      },
    ],
    ...overrides,
  }
}

function makeInput(overrides: Partial<GeneratedQuestSaveInput> = {}): GeneratedQuestSaveInput {
  return {
    room: makeRoom(),
    objectivesPerRoom: true,
    questSpec: makeQuestSpec(),
    storyKind: 'investigate',
    hints: { hint: 'Look for the useful object.', completionHint: 'The room feels settled.' },
    ...overrides,
  }
}

function expectInvalidSchema(json: string): void {
  expect(loadGeneratedQuestSaveState(json)).toEqual({ ok: false, code: 'invalid-schema' })
}

describe('buildGeneratedQuestSaveState', () => {
  it('returns null for authored or non-generated play inputs', () => {
    const input = { ...makeInput(), objectivesPerRoom: false } as unknown as GeneratedQuestSaveInput

    expect(buildGeneratedQuestSaveState(input)).toBeNull()
  })

  it('builds a valid generated quest save state', () => {
    const input = makeInput()
    const state = buildGeneratedQuestSaveState(input)

    expect(state).not.toBeNull()
    expect(state).toMatchObject({
      schemaVersion: 1,
      objectivesPerRoom: true,
      questSpec: input.questSpec,
      storyKind: 'investigate',
      hints: input.hints,
    })
  })

  it('round-trips full input through JSON and load', () => {
    const state = buildGeneratedQuestSaveState(makeInput())
    expect(state).not.toBeNull()

    const loaded = loadGeneratedQuestSaveState(JSON.stringify(state))

    expect(loaded).toEqual({ ok: true, state })
  })

  it('round-trips minimal input with optional fields absent', () => {
    const state = buildGeneratedQuestSaveState(
      makeInput({ questSpec: undefined, storyKind: undefined, hints: undefined }),
    )
    expect(state).not.toBeNull()

    const loaded = loadGeneratedQuestSaveState(JSON.stringify(state))

    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect('questSpec' in loaded.state).toBe(false)
    expect('storyKind' in loaded.state).toBe(false)
    expect('hints' in loaded.state).toBe(false)
  })

  it('parks only RoomSpec data and omits load-time diagnostics', () => {
    const state = buildGeneratedQuestSaveState(makeInput())
    expect(state).not.toBeNull()
    const room = state!.room as Record<string, unknown>

    expect(room.skipped).toBeUndefined()
    expect(room.warnings).toBeUndefined()
    expect(room.skippedObjectReasonCounts).toBeUndefined()
  })

  it('preserves object ids internally for later flag matching', () => {
    const state = buildGeneratedQuestSaveState(makeInput())

    expect(state?.room.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'case-file' }),
        expect.objectContaining({ id: 'north-arch' }),
      ]),
    )
  })

  it('preserves and validates questSpec', () => {
    const questSpec = makeQuestSpec()
    const state = buildGeneratedQuestSaveState(makeInput({ questSpec }))
    expect(state?.questSpec).toEqual(questSpec)

    const invalidQuestSpec = { ...questSpec, objectives: [] } as unknown as QuestSpec
    expect(buildGeneratedQuestSaveState(makeInput({ questSpec: invalidQuestSpec }))).toBeNull()
  })

  it('accepts the closed storyKind enum values', () => {
    for (const storyKind of validStoryKinds) {
      const state = buildGeneratedQuestSaveState(makeInput({ storyKind }))
      expect(state?.storyKind).toBe(storyKind)
    }
  })

  it('rejects invalid rooms', () => {
    const invalidRoom = {
      ...makeRoom(),
      shell: { dimensions: { width: 0, depth: 18, height: 4 }, exits: [] },
    } as unknown as LoadedRoom

    expect(buildGeneratedQuestSaveState(makeInput({ room: invalidRoom }))).toBeNull()
  })

  it('enforces hint length without mutating sanitized hint text', () => {
    const maxHint = 'x'.repeat(GENERATED_OBJECTIVE_TEXT_MAX_LENGTH)
    const exact = buildGeneratedQuestSaveState(
      makeInput({ hints: { hint: maxHint, completionHint: maxHint } }),
    )
    expect(exact?.hints).toEqual({ hint: maxHint, completionHint: maxHint })

    const tooLong = `${maxHint}x`
    expect(
      buildGeneratedQuestSaveState(makeInput({ hints: { hint: tooLong, completionHint: maxHint } })),
    ).toBeNull()
  })

  it('round-trips already-sanitized hints without structural id text', () => {
    const state = buildGeneratedQuestSaveState(
      makeInput({
        hints: {
          hint: 'Try a nearby room.',
          completionHint: 'Done with a nearby room.',
        },
      }),
    )

    expect(JSON.stringify(state?.hints)).not.toContain('interaction:')
    expect(JSON.stringify(state?.hints)).not.toContain('gen-1234abcd')
  })

  it('does not mutate input and is deterministic', () => {
    const input = makeInput()
    const before = JSON.stringify(input)

    const first = buildGeneratedQuestSaveState(input)
    const second = buildGeneratedQuestSaveState(input)

    expect(JSON.stringify(input)).toBe(before)
    expect(second).toEqual(first)
  })
})

describe('loadGeneratedQuestSaveState', () => {
  it('rejects malformed JSON', () => {
    expect(loadGeneratedQuestSaveState('{bad')).toEqual({ ok: false, code: 'invalid-json' })
  })

  it('rejects wrong schemaVersion', () => {
    const state = buildGeneratedQuestSaveState(makeInput())
    expect(state).not.toBeNull()

    expect(loadGeneratedQuestSaveState(JSON.stringify({ ...state, schemaVersion: 2 }))).toEqual({
      ok: false,
      code: 'unsupported-version',
    })
  })

  it('rejects missing schemaVersion', () => {
    const state = buildGeneratedQuestSaveState(makeInput())
    expect(state).not.toBeNull()
    const withoutVersion: Record<string, unknown> = { ...state! }
    delete withoutVersion.schemaVersion

    expectInvalidSchema(JSON.stringify(withoutVersion))
  })

  it('rejects missing required fields', () => {
    const state = buildGeneratedQuestSaveState(makeInput())
    expect(state).not.toBeNull()
    const withoutRoom: Record<string, unknown> = { ...state! }
    delete withoutRoom.room

    expectInvalidSchema(JSON.stringify(withoutRoom))
  })

  it('rejects extra top-level keys', () => {
    const state = buildGeneratedQuestSaveState(makeInput())
    expect(state).not.toBeNull()

    expectInvalidSchema(JSON.stringify({ ...state, extra: true }))
  })

  it('rejects objectivesPerRoom values other than true', () => {
    const state = buildGeneratedQuestSaveState(makeInput())
    expect(state).not.toBeNull()

    expectInvalidSchema(JSON.stringify({ ...state, objectivesPerRoom: false }))
  })

  it('rejects invalid storyKind values', () => {
    const state = buildGeneratedQuestSaveState(makeInput())
    expect(state).not.toBeNull()

    expectInvalidSchema(JSON.stringify({ ...state, storyKind: 'unknown-kind' }))
  })

  it('rejects invalid rooms', () => {
    const state = buildGeneratedQuestSaveState(makeInput())
    expect(state).not.toBeNull()

    const invalidRoom = {
      ...state!.room,
      shell: { dimensions: { width: -1, depth: 18, height: 4 }, exits: [] },
    }
    expectInvalidSchema(JSON.stringify({ ...state, room: invalidRoom }))
  })

  it('rejects invalid questSpec', () => {
    const state = buildGeneratedQuestSaveState(makeInput())
    expect(state).not.toBeNull()

    expectInvalidSchema(JSON.stringify({ ...state, questSpec: { ...state!.questSpec, objectives: [] } }))
  })

  it('rejects invalid hints', () => {
    const state = buildGeneratedQuestSaveState(makeInput())
    expect(state).not.toBeNull()

    expectInvalidSchema(JSON.stringify({ ...state, hints: { hint: '', completionHint: 'Done.' } }))
    expectInvalidSchema(
      JSON.stringify({ ...state, hints: { hint: 'Look.', completionHint: 'Done.', extra: true } }),
    )
  })

  it('uses fixed error codes without echoing unsafe input', () => {
    const unsafe = 'interaction:case-file Generated Room Resolve the room'
    const result = loadGeneratedQuestSaveState(
      JSON.stringify({ schemaVersion: 1, objectivesPerRoom: false, unsafe }),
    )

    expect(result).toEqual({ ok: false, code: 'invalid-schema' })
    expect(JSON.stringify(result)).not.toContain('interaction:case-file')
    expect(JSON.stringify(result)).not.toContain('Generated Room')
    expect(JSON.stringify(result)).not.toContain('Resolve the room')
  })
})

describe('storyKind schema parity', () => {
  it('schema options exactly cover the domain GeneratedStoryThreadKind union', () => {
    // Compile-time (schema ⊆ domain): assigning schema options to a
    // GeneratedStoryThreadKind[] fails to build if the schema adds a value
    // absent from the domain union.
    const schemaOptions: readonly GeneratedStoryThreadKind[] = GeneratedStoryThreadKindSchema.options
    // Runtime (domain ⊆ schema): all expected domain values must be in the
    // schema. Update this list when adding a new GeneratedStoryThreadKind value.
    expect([...schemaOptions].sort()).toEqual(
      (['escape', 'investigate', 'survive', 'rescue', 'recover-item'] satisfies GeneratedStoryThreadKind[]).sort(),
    )
  })
})

describe('generatedQuestSaveState import boundary', () => {
  it('does not import app, renderer, providers, persistence, backend, world-session, memory, or dialogue modules', () => {
    const source = generatedQuestSaveStateSource
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
    ]

    for (const fragment of forbiddenFragments) {
      expect(source).not.toContain(fragment)
    }
  })
})
