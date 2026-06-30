import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import type { RoomSpec } from '../roomSpec'
import type {
  GeneratedStoryPressure,
  GeneratedStoryRoomContext,
  GeneratedStoryRoomRole,
  GeneratedStoryThreadKind,
} from '../generatedStoryThread'
import type { QuestView } from '../quests/evaluateQuest'
import type { WorldState } from '../world/worldState'
import * as generatedConsequenceJournalModule from './generatedConsequenceJournal'
import { buildGeneratedConsequenceJournal } from './generatedConsequenceJournal'

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'
const UPDATED_AT = '2026-01-01T00:00:00.000Z'

const storyKinds: GeneratedStoryThreadKind[] = [
  'escape',
  'investigate',
  'survive',
  'rescue',
  'recover-item',
]

const storyRoles: GeneratedStoryRoomRole[] = [
  'threshold',
  'developing',
  'deeper',
]

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

function makeRoom(objects: unknown[] = [], name = 'Generated Room'): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'generated-room',
    name,
    shell: {
      dimensions: { width: 12, depth: 12, height: 4 },
      wallThickness: 0.3,
      floorColor: '#4a4036',
      wallColor: '#6b6355',
      exits: [],
    },
    spawn: { position: [0, 0, 0], yaw: 0 },
    lighting: {
      ambient: { color: '#404858', intensity: 0.6 },
    },
    objects,
  } satisfies RoomSpec)
}

function quest(status: QuestView['status'], overrides: Partial<QuestView> = {}): QuestView {
  return {
    questId: 'quest-id-sentinel',
    title: 'Quest Title',
    status,
    activeObjectiveId: status === 'complete' ? null : 'objective-id-sentinel',
    objectives: [
      {
        id: 'objective-id-sentinel',
        text: 'Objective Text',
        done: status === 'complete',
      },
    ],
    ...overrides,
  }
}

function storyContext(
  kind: GeneratedStoryThreadKind = 'escape',
  role: GeneratedStoryRoomRole = 'threshold',
): GeneratedStoryRoomContext {
  const pressures: Record<GeneratedStoryRoomRole, GeneratedStoryPressure> = {
    threshold: 'steady',
    developing: 'rising',
    deeper: 'high',
  }
  return { kind, role, pressure: pressures[role] }
}

function ids(view: ReturnType<typeof buildGeneratedConsequenceJournal>): string[] {
  return view.entries.map((entry) => entry.id)
}

function allText(view: ReturnType<typeof buildGeneratedConsequenceJournal>): string {
  return view.entries.map((entry) => entry.text).join('\n')
}

describe('buildGeneratedConsequenceJournal - empty and defensive inputs', () => {
  it('fresh state with no context returns an empty generated journal view', () => {
    const view = buildGeneratedConsequenceJournal({
      state: makeState(),
      room: makeRoom(),
      quest: null,
    })

    expect(view).toEqual({
      journalId: 'generated-consequence-journal',
      title: 'Consequences',
      entries: [],
    })
  })

  it('missing story context, null quest, and fresh state do not throw', () => {
    expect(() => buildGeneratedConsequenceJournal({
      state: makeState(),
      room: makeRoom(),
      quest: null,
      storyContext: undefined,
    })).not.toThrow()
  })
})

describe('buildGeneratedConsequenceJournal - story context', () => {
  it.each(storyKinds.flatMap((kind) => storyRoles.map((role) => [kind, role] as const)))(
    'adds a closed story entry for %s / %s',
    (kind, role) => {
      const view = buildGeneratedConsequenceJournal({
        state: makeState(),
        room: makeRoom(),
        quest: null,
        storyContext: storyContext(kind, role),
      })

      const entry = view.entries.find((candidate) => candidate.id === 'story-context')
      expect(entry?.text).toBeTruthy()
      expect(entry?.text).not.toContain(kind)
      expect(entry?.text).not.toContain(role)
    },
  )

  it('omits the story entry when storyContext is undefined', () => {
    const view = buildGeneratedConsequenceJournal({
      state: makeState(),
      room: makeRoom(),
      quest: null,
    })

    expect(ids(view)).not.toContain('story-context')
  })
})

describe('buildGeneratedConsequenceJournal - exploration count', () => {
  it('omits the exploration entry when no rooms are visited', () => {
    const view = buildGeneratedConsequenceJournal({
      state: makeState({
        roomStates: {
          'generated-room': { visited: false },
        },
      }),
      room: makeRoom(),
      quest: null,
    })

    expect(ids(view)).not.toContain('rooms-explored')
  })

  it('adds the exploration entry for one visited room', () => {
    const view = buildGeneratedConsequenceJournal({
      state: makeState({
        roomStates: {
          'generated-room': { visited: true },
        },
      }),
      room: makeRoom(),
      quest: null,
    })

    expect(view.entries).toContainEqual({
      id: 'rooms-explored',
      text: 'You have explored 1 chamber(s).',
    })
  })

  it('counts only visited roomStates', () => {
    const view = buildGeneratedConsequenceJournal({
      state: makeState({
        roomStates: {
          'generated-room': { visited: true },
          'generated-room:exit:north': { visited: true },
          'generated-room:exit:east': { visited: true },
          'generated-room:exit:south': { visited: false },
        },
      }),
      room: makeRoom(),
      quest: null,
    })

    expect(view.entries).toContainEqual({
      id: 'rooms-explored',
      text: 'You have explored 3 chamber(s).',
    })
  })
})

describe('buildGeneratedConsequenceJournal - objective status', () => {
  it('omits the objective entry for an active quest', () => {
    const view = buildGeneratedConsequenceJournal({
      state: makeState(),
      room: makeRoom(),
      quest: quest('active'),
    })

    expect(ids(view)).not.toContain('objective-resolved')
  })

  it('adds the objective entry only for a complete quest', () => {
    const view = buildGeneratedConsequenceJournal({
      state: makeState(),
      room: makeRoom(),
      quest: quest('complete'),
    })

    expect(view.entries).toContainEqual({
      id: 'objective-resolved',
      text: "You resolved this chamber's objective.",
    })
  })

  it('omits the objective entry for a null quest', () => {
    const view = buildGeneratedConsequenceJournal({
      state: makeState(),
      room: makeRoom(),
      quest: null,
    })

    expect(ids(view)).not.toContain('objective-resolved')
  })
})

describe('buildGeneratedConsequenceJournal - resolved object count', () => {
  it('omits the object-state entry when no current-room object is resolved', () => {
    const room = makeRoom([{
      type: 'scroll',
      id: 'case-file',
      position: [1, 0, 1],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    }])

    const view = buildGeneratedConsequenceJournal({
      state: makeState({
        roomStates: {
          'generated-room': { visited: true, flags: { 'interaction:other-object': true } },
        },
      }),
      room,
      quest: null,
    })

    expect(ids(view)).not.toContain('objects-disturbed')
  })

  it('uses only the count of resolved current-room objects', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'case-file',
        position: [1, 0, 1],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      {
        type: 'crate',
        id: 'supply-crate',
        position: [-1, 0, 1],
        interaction: {
          key: 'E',
          prompt: 'Take',
          effect: {
            kind: 'take-item',
            item: { itemId: 'battery', name: 'Battery', quantity: 1 },
          },
        },
      },
    ])

    const view = buildGeneratedConsequenceJournal({
      state: makeState({
        roomStates: {
          'generated-room': {
            visited: true,
            flags: {
              'interaction:case-file': true,
              'interaction:supply-crate': true,
            },
          },
        },
      }),
      room,
      quest: null,
    })

    expect(view.entries).toContainEqual({
      id: 'objects-disturbed',
      text: 'You disturbed 2 feature(s) here.',
    })
  })
})

describe('buildGeneratedConsequenceJournal - order and purity', () => {
  it('uses a stable entry order', () => {
    const room = makeRoom([{
      type: 'scroll',
      id: 'case-file',
      position: [1, 0, 1],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    }])

    const view = buildGeneratedConsequenceJournal({
      state: makeState({
        roomStates: {
          'generated-room': { visited: true, flags: { 'interaction:case-file': true } },
        },
      }),
      room,
      quest: quest('complete'),
      storyContext: storyContext('investigate', 'developing'),
    })

    expect(ids(view)).toEqual([
      'story-context',
      'rooms-explored',
      'objective-resolved',
      'objects-disturbed',
    ])
  })

  it('does not mutate WorldState or LoadedRoom inputs', () => {
    const room = makeRoom([{
      type: 'scroll',
      id: 'case-file',
      position: [1, 0, 1],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    }])
    const state = makeState({
      roomStates: {
        'generated-room': { visited: true, flags: { 'interaction:case-file': true } },
      },
    })
    const roomBefore = structuredClone(room)
    const stateBefore = structuredClone(state)

    buildGeneratedConsequenceJournal({ state, room, quest: quest('complete') })

    expect(room).toEqual(roomBefore)
    expect(state).toEqual(stateBefore)
  })

  it('returns fresh arrays and deterministic output for identical input', () => {
    const input = {
      state: makeState({ roomStates: { 'generated-room': { visited: true } } }),
      room: makeRoom(),
      quest: null,
      storyContext: storyContext('rescue', 'deeper'),
    }

    const first = buildGeneratedConsequenceJournal(input)
    const second = buildGeneratedConsequenceJournal(input)

    expect(first.entries).not.toBe(second.entries)
    expect(first).toEqual(second)
  })
})

describe('buildGeneratedConsequenceJournal - leak guards', () => {
  it('does not output room names, object ids, object names, flags, quest text, or generated-looking text', () => {
    const room = makeRoom([
      {
        type: 'zombie',
        id: 'OBJECT_ID_SENTINEL_XYZ',
        name: 'OBJECT_NAME_SENTINEL_XYZ',
        position: [1, 0, 1],
        interaction: {
          key: 'E',
          prompt: 'PROMPT_SENTINEL_XYZ',
          title: 'INTERACTION_TITLE_SENTINEL_XYZ',
          body: 'GENERATED_DESCRIPTION_SENTINEL_XYZ',
          effect: { kind: 'inspect', flag: 'FLAG_KEY_SENTINEL_XYZ' },
        },
      },
    ], 'ROOM_NAME_SENTINEL_XYZ')

    const view = buildGeneratedConsequenceJournal({
      state: makeState({
        roomStates: {
          'generated-room': {
            visited: true,
            flags: {
              FLAG_KEY_SENTINEL_XYZ: true,
              'RAW_OBJECTIVE_JSON_SENTINEL_XYZ': true,
            },
          },
        },
      }),
      room,
      quest: quest('complete', {
        questId: 'QUEST_ID_SENTINEL_XYZ',
        title: 'QUEST_TITLE_SENTINEL_XYZ',
        activeObjectiveId: null,
        objectives: [{
          id: 'OBJECTIVE_ID_SENTINEL_XYZ',
          text: 'OBJECTIVE_TEXT_SENTINEL_XYZ',
          done: true,
        }],
      }),
      storyContext: storyContext('recover-item', 'deeper'),
    })

    const text = allText(view)
    for (const sentinel of [
      'ROOM_NAME_SENTINEL_XYZ',
      'OBJECT_ID_SENTINEL_XYZ',
      'OBJECT_NAME_SENTINEL_XYZ',
      'FLAG_KEY_SENTINEL_XYZ',
      'RAW_OBJECTIVE_JSON_SENTINEL_XYZ',
      'QUEST_ID_SENTINEL_XYZ',
      'QUEST_TITLE_SENTINEL_XYZ',
      'OBJECTIVE_ID_SENTINEL_XYZ',
      'OBJECTIVE_TEXT_SENTINEL_XYZ',
      'PROMPT_SENTINEL_XYZ',
      'INTERACTION_TITLE_SENTINEL_XYZ',
      'GENERATED_DESCRIPTION_SENTINEL_XYZ',
      'interaction:',
      'recover-item',
    ]) {
      expect(text).not.toContain(sentinel)
    }
  })
})

describe('buildGeneratedConsequenceJournal - structural safety', () => {
  it('has only the runtime projector export', () => {
    expect(Object.keys(generatedConsequenceJournalModule)).toEqual([
      'buildGeneratedConsequenceJournal',
    ])
  })
})
