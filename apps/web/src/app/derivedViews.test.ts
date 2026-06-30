import { describe, expect, it } from 'vitest'
import { computeDerivedViews } from './derivedViews'
import { projectPlayerHud } from '../renderer/ui/playerHud'
import { evaluateQuest } from '../domain/quests/evaluateQuest'
import { demoQuestSpec } from '../domain/examples/demoQuest'
import { projectJournal } from '../domain/journal/projectJournal'
import { demoJournalSpec } from '../domain/examples/demoJournal'
import { buildGeneratedConsequenceJournal } from '../domain/journal/generatedConsequenceJournal'
import type { GeneratedConsequenceJournalInput } from '../domain/journal/generatedConsequenceJournal'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import type { WorldState } from '../domain/world/worldState'

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

function makeRoom(objects: unknown[] = [], id = 'generated-room'): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name: 'Generated Room Name Sentinel',
    shell: {
      dimensions: { width: 12, depth: 12, height: 4 },
      exits: [],
    },
    spawn: { position: [0, 0, 0], yaw: 0 },
    objects,
  })
}

function generatedJournalInput(
  state: WorldState,
  overrides: Partial<GeneratedConsequenceJournalInput> = {},
): GeneratedConsequenceJournalInput {
  return {
    state,
    room: makeRoom(),
    quest: null,
    ...overrides,
  }
}

describe('computeDerivedViews — playerHud', () => {
  it('matches projectPlayerHud for the same state', () => {
    const state = makeState({ inventory: [{ itemId: 'coin', name: 'Coin', quantity: 2 }] })
    expect(computeDerivedViews(state, null, null).playerHud).toEqual(projectPlayerHud(state))
  })

  it('is produced regardless of whether the optional specs are attached', () => {
    const state = makeState()
    expect(computeDerivedViews(state, null, null).playerHud).toEqual(projectPlayerHud(state))
    expect(computeDerivedViews(state, demoQuestSpec, demoJournalSpec).playerHud).toEqual(
      projectPlayerHud(state),
    )
  })
})

describe('computeDerivedViews — quest', () => {
  it('is null when no quest spec is attached (prompt-generated session)', () => {
    expect(computeDerivedViews(makeState(), null, null).quest).toBeNull()
  })

  it('matches evaluateQuest when a spec is attached', () => {
    const state = makeState({
      roomStates: {
        'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } },
      },
    })
    expect(computeDerivedViews(state, demoQuestSpec, null).quest).toEqual(
      evaluateQuest(demoQuestSpec, state),
    )
  })

  it('reflects mid-quest progress', () => {
    const state = makeState({
      roomStates: {
        'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } },
      },
    })
    const view = computeDerivedViews(state, demoQuestSpec, null).quest
    expect(view?.status).toBe('active')
    expect(view?.objectives.find((o) => o.id === 'claim-tribute-coin')?.done).toBe(true)
    expect(view?.objectives.find((o) => o.id === 'enter-the-safehouse')?.done).toBe(false)
  })

  it('reflects a completed quest', () => {
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
    expect(computeDerivedViews(state, demoQuestSpec, null).quest?.status).toBe('complete')
  })
})

describe('computeDerivedViews — journal', () => {
  it('is null when no journal spec is attached', () => {
    expect(computeDerivedViews(makeState(), null, null).journal).toBeNull()
  })

  it('matches projectJournal when a spec is attached', () => {
    const state = makeState({
      roomStates: {
        'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } },
      },
    })
    expect(computeDerivedViews(state, null, demoJournalSpec).journal).toEqual(
      projectJournal(demoJournalSpec, state),
    )
  })

  it('records entries as their conditions become true', () => {
    const state = makeState({
      roomStates: {
        'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } },
      },
    })
    const view = computeDerivedViews(state, null, demoJournalSpec).journal
    expect(view?.entries.some((e) => e.id === 'claimed-tribute-coin')).toBe(true)
    expect(view?.entries.some((e) => e.id === 'entered-safehouse')).toBe(false)
  })

  it('uses generated journal input when provided', () => {
    const state = makeState({
      currentRoomId: 'generated-room',
      roomStates: { 'generated-room': { visited: true } },
    })
    const input = generatedJournalInput(state, {
      storyContext: { kind: 'investigate', role: 'threshold', pressure: 'steady' },
    })

    expect(computeDerivedViews(state, null, null, input).journal).toEqual(
      buildGeneratedConsequenceJournal(input),
    )
  })

  it('keeps authored and generated journals mutually exclusive', () => {
    const state = makeState({
      roomStates: {
        'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } },
        'generated-room': { visited: true },
      },
    })
    const input = generatedJournalInput(state)

    const view = computeDerivedViews(state, null, demoJournalSpec, input).journal

    expect(view?.journalId).toBe('generated-consequence-journal')
    expect(view?.journalId).not.toBe(demoJournalSpec.journalId)
    expect(view?.entries.some((entry) => entry.id === 'claimed-tribute-coin')).toBe(false)
    expect(view?.entries.some((entry) => entry.id === 'rooms-explored')).toBe(true)
  })

  it('generated journal degrades safely without story context or quest', () => {
    const state = makeState()
    const view = computeDerivedViews(state, null, null, generatedJournalInput(state)).journal

    expect(view).toEqual({
      journalId: 'generated-consequence-journal',
      title: 'Consequences',
      entries: [],
    })
  })

  it('generated journal updates from refreshed WorldState after interaction and navigation', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'SECRET_OBJECT_ID',
        position: [1, 0, 1],
        interaction: {
          key: 'E',
          prompt: 'SECRET PROMPT',
          effect: { kind: 'inspect' },
        },
      },
    ])
    const beforeState = makeState({
      currentRoomId: room.id,
      roomStates: { [room.id]: { visited: true } },
    })
    const afterState = makeState({
      currentRoomId: room.id,
      roomStates: {
        [room.id]: { visited: true, flags: { 'interaction:SECRET_OBJECT_ID': true } },
        'generated-room:exit:north': { visited: true },
      },
    })

    const before = computeDerivedViews(
      beforeState,
      null,
      null,
      generatedJournalInput(beforeState, { room }),
    ).journal
    const after = computeDerivedViews(
      afterState,
      null,
      null,
      generatedJournalInput(afterState, { room }),
    ).journal

    expect(before?.entries.some((entry) => entry.id === 'objects-disturbed')).toBe(false)
    expect(after?.entries).toContainEqual({
      id: 'objects-disturbed',
      text: 'You disturbed 1 feature(s) here.',
    })
    expect(after?.entries).toContainEqual({
      id: 'rooms-explored',
      text: 'You have explored 2 chamber(s).',
    })
    expect(JSON.stringify(after)).not.toContain('SECRET_OBJECT_ID')
    expect(JSON.stringify(after)).not.toContain('SECRET PROMPT')
  })
})

describe('computeDerivedViews — purity', () => {
  it('is deterministic for identical inputs', () => {
    const state = makeState({ roomStates: { 'throne-room': { visited: true } } })
    expect(JSON.stringify(computeDerivedViews(state, demoQuestSpec, demoJournalSpec))).toBe(
      JSON.stringify(computeDerivedViews(state, demoQuestSpec, demoJournalSpec)),
    )
  })

  it('does not mutate the input WorldState', () => {
    const state = makeState({
      roomStates: {
        'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } },
      },
    })
    const before = JSON.stringify(state)
    computeDerivedViews(state, demoQuestSpec, demoJournalSpec)
    expect(JSON.stringify(state)).toBe(before)
  })
})
