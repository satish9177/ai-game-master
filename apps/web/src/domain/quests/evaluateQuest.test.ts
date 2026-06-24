import { describe, expect, it } from 'vitest'
import { evaluateQuest } from './evaluateQuest'
import { QuestSpecSchema, type QuestSpec } from './questSpec'
import { demoQuestSpec } from '../examples/demoQuest'
import type { WorldState } from '../world/worldState'

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'
const UPDATED_AT = '2026-01-01T00:00:00.000Z'

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    schemaVersion: 1,
    worldId: WORLD_ID,
    sessionId: SESSION_ID,
    currentRoomId: 'throne-room',
    player: { health: { current: 75, max: 100 }, status: [] },
    inventory: [],
    roomStates: {},
    revision: 1,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

function done(view: ReturnType<typeof evaluateQuest>, id: string): boolean | undefined {
  return view.objectives.find((o) => o.id === id)?.done
}

describe('evaluateQuest — demo quest spine', () => {
  it('shipped demoQuestSpec satisfies the schema', () => {
    expect(() => QuestSpecSchema.parse(demoQuestSpec)).not.toThrow()
  })

  it('all objectives incomplete on empty state', () => {
    const view = evaluateQuest(demoQuestSpec, makeState())
    expect(view.objectives.map((o) => o.done)).toEqual([false, false, false])
    expect(view.status).toBe('active')
  })

  it('objective 1 done when offering-coffer flag is set', () => {
    const state = makeState({
      roomStates: {
        'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } },
      },
    })
    const view = evaluateQuest(demoQuestSpec, state)
    expect(done(view, 'claim-tribute-coin')).toBe(true)
    expect(done(view, 'get-past-steward-malik')).toBe(false)
    expect(done(view, 'enter-the-safehouse')).toBe(false)
    expect(view.status).toBe('active')
  })

  it('objective 2 done when malik-encounter flag is set', () => {
    const state = makeState({
      roomStates: {
        'throne-room': { visited: true, flags: { 'encounter:malik-encounter': true } },
      },
    })
    const view = evaluateQuest(demoQuestSpec, state)
    expect(done(view, 'claim-tribute-coin')).toBe(false)
    expect(done(view, 'get-past-steward-malik')).toBe(true)
    expect(done(view, 'enter-the-safehouse')).toBe(false)
    expect(view.status).toBe('active')
  })

  it('objective 3 done when ruined-safehouse is visited', () => {
    const state = makeState({
      roomStates: {
        'ruined-safehouse': { visited: true },
      },
    })
    const view = evaluateQuest(demoQuestSpec, state)
    expect(done(view, 'claim-tribute-coin')).toBe(false)
    expect(done(view, 'get-past-steward-malik')).toBe(false)
    expect(done(view, 'enter-the-safehouse')).toBe(true)
    expect(view.status).toBe('active')
  })

  it('status is complete when all three objectives are done', () => {
    const state = makeState({
      roomStates: {
        'throne-room': {
          visited: true,
          flags: {
            'interaction:offering-coffer': true,
            'encounter:malik-encounter': true,
          },
        },
        'ruined-safehouse': { visited: true },
      },
    })
    const view = evaluateQuest(demoQuestSpec, state)
    expect(view.objectives.every((o) => o.done)).toBe(true)
    expect(view.status).toBe('complete')
  })

  it('objectives 1+2 done but 3 pending keeps status active', () => {
    const state = makeState({
      roomStates: {
        'throne-room': {
          visited: true,
          flags: {
            'interaction:offering-coffer': true,
            'encounter:malik-encounter': true,
          },
        },
      },
    })
    const view = evaluateQuest(demoQuestSpec, state)
    expect(done(view, 'claim-tribute-coin')).toBe(true)
    expect(done(view, 'get-past-steward-malik')).toBe(true)
    expect(done(view, 'enter-the-safehouse')).toBe(false)
    expect(view.status).toBe('active')
  })
})

describe('evaluateQuest — condition kind coverage', () => {
  const roomFlagSpec: QuestSpec = {
    questId: 'q',
    title: 'T',
    anchorRoomId: 'r',
    objectives: [{ id: 'o1', text: 'T1', condition: { kind: 'room-flag', roomId: 'r', flag: 'f' } }],
  }

  it('room-flag: true when flag is set', () => {
    const state = makeState({ roomStates: { r: { visited: false, flags: { f: true } } } })
    expect(done(evaluateQuest(roomFlagSpec, state), 'o1')).toBe(true)
  })

  it('room-flag: false when flag is absent', () => {
    const state = makeState({ roomStates: { r: { visited: false } } })
    expect(done(evaluateQuest(roomFlagSpec, state), 'o1')).toBe(false)
  })

  it('room-flag: false when flag is explicitly false', () => {
    const state = makeState({ roomStates: { r: { visited: false, flags: { f: false } } } })
    expect(done(evaluateQuest(roomFlagSpec, state), 'o1')).toBe(false)
  })

  const roomVisitedSpec: QuestSpec = {
    questId: 'q',
    title: 'T',
    anchorRoomId: 'r',
    objectives: [{ id: 'o1', text: 'T1', condition: { kind: 'room-visited', roomId: 'r' } }],
  }

  it('room-visited: true when visited is true', () => {
    const state = makeState({ roomStates: { r: { visited: true } } })
    expect(done(evaluateQuest(roomVisitedSpec, state), 'o1')).toBe(true)
  })

  it('room-visited: false when visited is false', () => {
    const state = makeState({ roomStates: { r: { visited: false } } })
    expect(done(evaluateQuest(roomVisitedSpec, state), 'o1')).toBe(false)
  })

  const hasItemSpec: QuestSpec = {
    questId: 'q',
    title: 'T',
    anchorRoomId: 'r',
    objectives: [{ id: 'o1', text: 'T1', condition: { kind: 'has-item', itemId: 'gold-coin' } }],
  }

  it('has-item: true when item is in inventory', () => {
    const state = makeState({
      inventory: [{ itemId: 'gold-coin', name: 'Gold Coin', quantity: 1 }],
    })
    expect(done(evaluateQuest(hasItemSpec, state), 'o1')).toBe(true)
  })

  it('has-item: false when item is absent', () => {
    expect(done(evaluateQuest(hasItemSpec, makeState()), 'o1')).toBe(false)
  })

  it('has-item: respects min quantity — true when quantity meets min', () => {
    const spec: QuestSpec = {
      questId: 'q',
      title: 'T',
      anchorRoomId: 'r',
      objectives: [{ id: 'o1', text: 'T1', condition: { kind: 'has-item', itemId: 'coin', min: 3 } }],
    }
    const state = makeState({
      inventory: [{ itemId: 'coin', name: 'Coin', quantity: 3 }],
    })
    expect(done(evaluateQuest(spec, state), 'o1')).toBe(true)
  })

  it('has-item: false when quantity is below min', () => {
    const spec: QuestSpec = {
      questId: 'q',
      title: 'T',
      anchorRoomId: 'r',
      objectives: [{ id: 'o1', text: 'T1', condition: { kind: 'has-item', itemId: 'coin', min: 3 } }],
    }
    const state = makeState({
      inventory: [{ itemId: 'coin', name: 'Coin', quantity: 2 }],
    })
    expect(done(evaluateQuest(spec, state), 'o1')).toBe(false)
  })

  const hasStatusSpec: QuestSpec = {
    questId: 'q',
    title: 'T',
    anchorRoomId: 'r',
    objectives: [{ id: 'o1', text: 'T1', condition: { kind: 'has-status', status: 'infected' } }],
  }

  it('has-status: true when player has status', () => {
    const state = makeState({ player: { health: { current: 75, max: 100 }, status: ['infected'] } })
    expect(done(evaluateQuest(hasStatusSpec, state), 'o1')).toBe(true)
  })

  it('has-status: false when player does not have status', () => {
    expect(done(evaluateQuest(hasStatusSpec, makeState()), 'o1')).toBe(false)
  })
})

describe('evaluateQuest — defensive: missing room/flag/item/status', () => {
  it('room-flag: false and no throw when room is absent', () => {
    const spec: QuestSpec = {
      questId: 'q',
      title: 'T',
      anchorRoomId: 'r',
      objectives: [
        { id: 'o1', text: 'T1', condition: { kind: 'room-flag', roomId: 'missing', flag: 'f' } },
      ],
    }
    expect(() => evaluateQuest(spec, makeState())).not.toThrow()
    expect(done(evaluateQuest(spec, makeState()), 'o1')).toBe(false)
  })

  it('room-flag: false and no throw when flags record is absent', () => {
    const spec: QuestSpec = {
      questId: 'q',
      title: 'T',
      anchorRoomId: 'r',
      objectives: [
        { id: 'o1', text: 'T1', condition: { kind: 'room-flag', roomId: 'r', flag: 'f' } },
      ],
    }
    const state = makeState({ roomStates: { r: { visited: true } } })
    expect(() => evaluateQuest(spec, state)).not.toThrow()
    expect(done(evaluateQuest(spec, state), 'o1')).toBe(false)
  })

  it('room-visited: false and no throw when room is absent', () => {
    const spec: QuestSpec = {
      questId: 'q',
      title: 'T',
      anchorRoomId: 'r',
      objectives: [{ id: 'o1', text: 'T1', condition: { kind: 'room-visited', roomId: 'missing' } }],
    }
    expect(() => evaluateQuest(spec, makeState())).not.toThrow()
    expect(done(evaluateQuest(spec, makeState()), 'o1')).toBe(false)
  })

  it('unrelated/generated state returns all incomplete', () => {
    const state = makeState({
      roomStates: { 'some-generated-room': { visited: true, flags: { 'interaction:x': true } } },
      inventory: [{ itemId: 'random-item', name: 'Random', quantity: 1 }],
    })
    const view = evaluateQuest(demoQuestSpec, state)
    expect(view.objectives.every((o) => !o.done)).toBe(true)
    expect(view.status).toBe('active')
  })
})

describe('evaluateQuest — purity and no mutation', () => {
  it('does not mutate the input WorldState', () => {
    const state = makeState({
      roomStates: {
        'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } },
      },
    })
    const before = JSON.stringify(state)
    evaluateQuest(demoQuestSpec, state)
    expect(JSON.stringify(state)).toBe(before)
  })

  it('does not mutate the input QuestSpec', () => {
    const before = JSON.stringify(demoQuestSpec)
    evaluateQuest(demoQuestSpec, makeState())
    expect(JSON.stringify(demoQuestSpec)).toBe(before)
  })

  it('returns fresh objectives array reference', () => {
    const view = evaluateQuest(demoQuestSpec, makeState())
    expect(Array.isArray(view.objectives)).toBe(true)
    expect(view.objectives).not.toBe(demoQuestSpec.objectives)
  })

  it('same input produces identical output (deterministic)', () => {
    const state = makeState({
      roomStates: { 'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } } },
    })
    const a = evaluateQuest(demoQuestSpec, state)
    const b = evaluateQuest(demoQuestSpec, state)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('produces questId and title from spec unchanged', () => {
    const view = evaluateQuest(demoQuestSpec, makeState())
    expect(view.questId).toBe(demoQuestSpec.questId)
    expect(view.title).toBe(demoQuestSpec.title)
  })
})

describe('evaluateQuest — save/load restore implication', () => {
  it('re-projecting restored state with flags set reproduces mid-quest progress', () => {
    const restoredState = makeState({
      roomStates: {
        'throne-room': {
          visited: true,
          flags: {
            'interaction:offering-coffer': true,
            'encounter:malik-encounter': true,
          },
        },
      },
    })
    const view = evaluateQuest(demoQuestSpec, restoredState)
    expect(done(view, 'claim-tribute-coin')).toBe(true)
    expect(done(view, 'get-past-steward-malik')).toBe(true)
    expect(done(view, 'enter-the-safehouse')).toBe(false)
    expect(view.status).toBe('active')
  })

  it('re-projecting fully completed restored state reproduces complete quest', () => {
    const restoredState = makeState({
      roomStates: {
        'throne-room': {
          visited: true,
          flags: {
            'interaction:offering-coffer': true,
            'encounter:malik-encounter': true,
          },
        },
        'ruined-safehouse': { visited: true },
      },
    })
    const view = evaluateQuest(demoQuestSpec, restoredState)
    expect(view.status).toBe('complete')
    expect(view.objectives.every((o) => o.done)).toBe(true)
  })
})
