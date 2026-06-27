import { describe, expect, it } from 'vitest'
import { computeDerivedViews } from './derivedViews'
import { projectPlayerHud } from '../renderer/ui/playerHud'
import { evaluateQuest } from '../domain/quests/evaluateQuest'
import { demoQuestSpec } from '../domain/examples/demoQuest'
import { projectJournal } from '../domain/journal/projectJournal'
import { demoJournalSpec } from '../domain/examples/demoJournal'
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
