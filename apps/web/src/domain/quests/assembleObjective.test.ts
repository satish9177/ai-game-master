import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import type { RoomSpec } from '../roomSpec'
import type { WorldState } from '../world/worldState'
import { assembleObjective } from './assembleObjective'
import { evaluateQuest } from './evaluateQuest'
import { QuestSpecSchema } from './questSpec'

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'
const UPDATED_AT = '2026-01-01T00:00:00.000Z'

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
    objects: [
      {
        type: 'scroll',
        id: 'note-1',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
      {
        type: 'npc',
        id: 'guard-1',
        name: 'Guard',
        position: [2, 0, -2],
        interaction: {
          key: 'F',
          prompt: 'Confront',
          encounter: {
            id: 'guard-encounter',
            description: 'A guarded passage.',
            choices: [
              {
                id: 'talk',
                action: 'negotiate',
                label: 'Talk',
                outcome: { effects: [] },
              },
            ],
          },
        },
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

function rawProposal(condition: unknown, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: 'Secure the room',
    description: 'Resolve the immediate task.',
    hint: 'Look for the useful object.',
    completionHint: 'The room feels settled.',
    condition,
    ...overrides,
  })
}

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    schemaVersion: 1,
    worldId: WORLD_ID,
    sessionId: SESSION_ID,
    currentRoomId: 'generated-room',
    player: { health: { current: 75, max: 100 }, status: [] },
    inventory: [],
    roomStates: {},
    revision: 1,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('assembleObjective invalid input', () => {
  it('returns null without throwing on bad JSON', () => {
    expect(() => assembleObjective('{bad', makeRoom())).not.toThrow()
    const result = assembleObjective('{bad', makeRoom())
    expect(result.spec).toBeNull()
    expect(result.diagnostics).toMatchObject({
      objectiveValid: false,
      objectiveDropped: true,
      conditionKind: null,
      dropCode: 'parse-failed',
    })
  })

  it('returns null for schema failures, unknown kinds, extra keys, and over-length text', () => {
    const room = makeRoom()
    expect(assembleObjective(rawProposal({ kind: 'unknown', objectId: 'note-1' }), room).diagnostics.dropCode).toBe(
      'schema-invalid',
    )
    expect(
      assembleObjective(rawProposal({ kind: 'interact-object', objectId: 'note-1' }, { extra: true }), room).spec,
    ).toBeNull()
    expect(
      assembleObjective(rawProposal({ kind: 'interact-object', objectId: 'note-1' }, { title: 'x'.repeat(81) }), room)
        .spec,
    ).toBeNull()
  })
})

describe('assembleObjective satisfiability', () => {
  it('converts valid interact-object proposals to interaction flags', () => {
    const result = assembleObjective(rawProposal({ kind: 'interact-object', objectId: 'note-1' }), makeRoom())
    expect(result.spec?.objectives[0]?.condition).toEqual({
      kind: 'room-flag',
      roomId: 'generated-room',
      flag: 'interaction:note-1',
    })
    expect(result.hint).toBe('Look for the useful object.')
    expect(result.completionHint).toBe('The room feels settled.')
    expect(result.diagnostics.objectiveValid).toBe(true)
    expect(() => QuestSpecSchema.parse(result.spec)).not.toThrow()
  })

  it('converts valid resolve-encounter proposals using the encounter resolution key convention', () => {
    const result = assembleObjective(rawProposal({ kind: 'resolve-encounter', objectId: 'guard-1' }), makeRoom())
    expect(result.spec?.objectives[0]?.condition).toEqual({
      kind: 'room-flag',
      roomId: 'generated-room',
      flag: 'encounter:guard-encounter',
    })
  })

  it('falls back to object id for resolve-encounter when the encounter has no id', () => {
    const room = makeRoom({
      objects: [
        {
          type: 'npc',
          id: 'guard-1',
          name: 'Guard',
          position: [2, 0, -2],
          interaction: {
            key: 'F',
            prompt: 'Confront',
            encounter: {
              description: 'A guarded passage.',
              choices: [{ id: 'talk', action: 'negotiate', label: 'Talk', outcome: { effects: [] } }],
            },
          },
        },
      ],
    })
    const result = assembleObjective(rawProposal({ kind: 'resolve-encounter', objectId: 'guard-1' }), room)
    expect(result.spec?.objectives[0]?.condition).toMatchObject({ flag: 'encounter:guard-1' })
  })

  it('accepts visit-room for the current room or a known adjacent room only', () => {
    const room = makeRoom()
    expect(assembleObjective(rawProposal({ kind: 'visit-room', roomId: 'generated-room' }), room).spec).not.toBeNull()
    expect(assembleObjective(rawProposal({ kind: 'visit-room', roomId: 'north-room' }), room).spec).not.toBeNull()

    const missing = assembleObjective(rawProposal({ kind: 'visit-room', roomId: 'unreachable-room' }), room)
    expect(missing.spec).toBeNull()
    expect(missing.diagnostics).toMatchObject({
      conditionKind: 'visit-room',
      conditionUnsatisfiable: true,
      dropCode: 'condition-unsatisfiable',
    })
  })

  it('returns null for dangling, missing, id-less, wrong-kind, or unsatisfiable object references', () => {
    const room = makeRoom({
      objects: [
        { type: 'scroll', position: [0, 0, -2], interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } } },
        { type: 'crate', id: 'crate-1', position: [2, 0, -2] },
        { type: 'arch', id: 'north-arch', position: [0, 0, -8], interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'north-room' } } },
      ],
    })

    expect(assembleObjective(rawProposal({ kind: 'interact-object', objectId: 'missing' }), room).spec).toBeNull()
    expect(assembleObjective(rawProposal({ kind: 'interact-object', objectId: '' }), room).spec).toBeNull()
    expect(assembleObjective(rawProposal({ kind: 'interact-object', objectId: 'crate-1' }), room).spec).toBeNull()
    expect(assembleObjective(rawProposal({ kind: 'interact-object', objectId: 'north-arch' }), room).spec).toBeNull()
    expect(assembleObjective(rawProposal({ kind: 'resolve-encounter', objectId: 'crate-1' }), room).spec).toBeNull()
  })

  it('does not accept raw flag strings from generated input', () => {
    const result = assembleObjective(
      rawProposal({ kind: 'interact-object', objectId: 'note-1', flag: 'interaction:other' }),
      makeRoom(),
    )
    expect(result.spec).toBeNull()
    expect(result.diagnostics.dropCode).toBe('schema-invalid')

    const flagLikeObjectId = assembleObjective(
      rawProposal({ kind: 'interact-object', objectId: 'interaction:note-1' }),
      makeRoom(),
    )
    expect(flagLikeObjectId.spec).toBeNull()
    expect(flagLikeObjectId.diagnostics.dropCode).toBe('schema-invalid')
  })
})

describe('assembleObjective text and diagnostics safety', () => {
  it('sanitizes generated structural ids from output text and reports safe diagnostics only', () => {
    const result = assembleObjective(
      rawProposal(
        { kind: 'interact-object', objectId: 'note-1' },
        {
          title: 'Check gen-1234abcd',
          description: 'Inspect gen-1234abcd:generated-exit:north.',
          hint: 'Try adjacent:gen-1234abcd:0.',
          completionHint: 'Done with gen-1234abcd.',
        },
      ),
      makeRoom(),
    )

    expect(JSON.stringify(result.spec)).not.toContain('gen-1234abcd')
    expect(result.hint).toBe('Try a nearby room.')
    expect(result.completionHint).toBe('Done with a nearby room.')
    expect(result.diagnostics).toEqual({
      objectiveValid: true,
      objectiveDropped: false,
      conditionKind: 'interact-object',
      conditionUnsatisfiable: false,
      textSanitized: true,
      textSanitizationCount: 4,
      dropCode: null,
    })
    expect(Object.values(result.diagnostics).join(' ')).not.toContain('nearby')
    expect(Object.values(result.diagnostics).join(' ')).not.toContain('note-1')
  })

  it('never invents objectives or ids', () => {
    const result = assembleObjective(rawProposal({ kind: 'interact-object', objectId: 'note-1' }), makeRoom())
    expect(result.spec?.objectives).toHaveLength(1)
    expect(result.spec?.objectives[0]?.id).toBe('generated-0')
    expect(result.spec?.questId).toBe('generated-room-objective')
  })

  it('does not mutate the input room and is deterministic', () => {
    const room = makeRoom()
    const before = JSON.stringify(room)
    const raw = rawProposal({ kind: 'interact-object', objectId: 'note-1' })

    const first = assembleObjective(raw, room)
    const second = assembleObjective(raw, room)

    expect(JSON.stringify(room)).toBe(before)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})

describe('assembleObjective with evaluateQuest', () => {
  it('produces an interact-object QuestSpec that evaluateQuest can complete from authoritative flags', () => {
    const result = assembleObjective(rawProposal({ kind: 'interact-object', objectId: 'note-1' }), makeRoom())
    expect(result.spec).not.toBeNull()
    const spec = result.spec!

    expect(evaluateQuest(spec, makeState()).objectives[0]?.done).toBe(false)
    expect(
      evaluateQuest(
        spec,
        makeState({
          roomStates: { 'generated-room': { visited: true, flags: { 'interaction:note-1': true } } },
        }),
      ).objectives[0]?.done,
    ).toBe(true)
  })

  it('produces a resolve-encounter QuestSpec that evaluateQuest can complete from authoritative flags', () => {
    const result = assembleObjective(rawProposal({ kind: 'resolve-encounter', objectId: 'guard-1' }), makeRoom())
    const spec = result.spec!

    expect(evaluateQuest(spec, makeState()).objectives[0]?.done).toBe(false)
    expect(
      evaluateQuest(
        spec,
        makeState({
          roomStates: { 'generated-room': { visited: true, flags: { 'encounter:guard-encounter': true } } },
        }),
      ).objectives[0]?.done,
    ).toBe(true)
  })

  it('produces a visit-room QuestSpec that evaluateQuest can complete from visited room state', () => {
    const result = assembleObjective(rawProposal({ kind: 'visit-room', roomId: 'north-room' }), makeRoom())
    const spec = result.spec!

    expect(evaluateQuest(spec, makeState()).objectives[0]?.done).toBe(false)
    expect(
      evaluateQuest(
        spec,
        makeState({
          roomStates: { 'north-room': { visited: true } },
        }),
      ).objectives[0]?.done,
    ).toBe(true)
  })
})
