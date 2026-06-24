import { describe, expect, it } from 'vitest'
import { projectJournal } from './projectJournal'
import { JournalSpecSchema } from './journalSpec'
import { demoJournalSpec } from '../examples/demoJournal'
import { evaluateCondition } from '../quests/evaluateQuest'
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

function ids(view: ReturnType<typeof projectJournal>): string[] {
  return view.entries.map((e) => e.id)
}

describe('projectJournal — empty state', () => {
  it('fresh WorldState produces empty entries', () => {
    const view = projectJournal(demoJournalSpec, makeState())
    expect(view.entries).toEqual([])
  })

  it('journalId and title are passed through from spec', () => {
    const view = projectJournal(demoJournalSpec, makeState())
    expect(view.journalId).toBe(demoJournalSpec.journalId)
    expect(view.title).toBe(demoJournalSpec.title)
  })
})

describe('projectJournal — each entry appears only when its condition is true', () => {
  it('claimed-tribute-coin: appears when offering-coffer flag is set', () => {
    const state = makeState({
      roomStates: { 'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } } },
    })
    expect(ids(projectJournal(demoJournalSpec, state))).toContain('claimed-tribute-coin')
  })

  it('claimed-tribute-coin: absent when flag is not set', () => {
    expect(ids(projectJournal(demoJournalSpec, makeState()))).not.toContain('claimed-tribute-coin')
  })

  it('dealt-with-malik: appears when malik-encounter flag is set', () => {
    const state = makeState({
      roomStates: { 'throne-room': { visited: true, flags: { 'encounter:malik-encounter': true } } },
    })
    expect(ids(projectJournal(demoJournalSpec, state))).toContain('dealt-with-malik')
  })

  it('dealt-with-malik: absent when flag is not set', () => {
    expect(ids(projectJournal(demoJournalSpec, makeState()))).not.toContain('dealt-with-malik')
  })

  it('entered-safehouse: appears when ruined-safehouse is visited', () => {
    const state = makeState({
      roomStates: { 'ruined-safehouse': { visited: true } },
    })
    expect(ids(projectJournal(demoJournalSpec, state))).toContain('entered-safehouse')
  })

  it('entered-safehouse: absent when not visited', () => {
    const state = makeState({
      roomStates: { 'ruined-safehouse': { visited: false } },
    })
    expect(ids(projectJournal(demoJournalSpec, state))).not.toContain('entered-safehouse')
  })

  it('became-infected: appears when player has infected status', () => {
    const state = makeState({
      player: { health: { current: 75, max: 100 }, status: ['infected'] },
    })
    expect(ids(projectJournal(demoJournalSpec, state))).toContain('became-infected')
  })

  it('became-infected: absent when player has no status', () => {
    expect(ids(projectJournal(demoJournalSpec, makeState()))).not.toContain('became-infected')
  })

  it('faced-the-walker: appears when walker-encounter flag is set', () => {
    const state = makeState({
      roomStates: { 'ruined-safehouse': { visited: true, flags: { 'encounter:walker-encounter': true } } },
    })
    expect(ids(projectJournal(demoJournalSpec, state))).toContain('faced-the-walker')
  })

  it('faced-the-walker: absent when flag is not set', () => {
    expect(ids(projectJournal(demoJournalSpec, makeState()))).not.toContain('faced-the-walker')
  })

  it('secured-royal-writ: appears when royal-writ is in inventory', () => {
    const state = makeState({
      inventory: [{ itemId: 'royal-writ', name: 'Royal Writ', quantity: 1 }],
    })
    expect(ids(projectJournal(demoJournalSpec, state))).toContain('secured-royal-writ')
  })

  it('secured-royal-writ: absent when inventory is empty', () => {
    expect(ids(projectJournal(demoJournalSpec, makeState()))).not.toContain('secured-royal-writ')
  })
})

describe('projectJournal — authored order and multiple entries', () => {
  it('multiple true entries appear in authored spec order', () => {
    const state = makeState({
      roomStates: {
        'throne-room': {
          visited: true,
          flags: { 'interaction:offering-coffer': true, 'encounter:malik-encounter': true },
        },
        'ruined-safehouse': { visited: true },
      },
    })
    const result = ids(projectJournal(demoJournalSpec, state))
    expect(result).toEqual(['claimed-tribute-coin', 'dealt-with-malik', 'entered-safehouse'])
  })

  it('all six entries true — appear in authored order', () => {
    const state = makeState({
      roomStates: {
        'throne-room': {
          visited: true,
          flags: {
            'interaction:offering-coffer': true,
            'encounter:malik-encounter': true,
          },
        },
        'ruined-safehouse': {
          visited: true,
          flags: { 'encounter:walker-encounter': true },
        },
      },
      player: { health: { current: 75, max: 100 }, status: ['infected'] },
      inventory: [{ itemId: 'royal-writ', name: 'Royal Writ', quantity: 1 }],
    })
    const result = ids(projectJournal(demoJournalSpec, state))
    expect(result).toEqual([
      'claimed-tribute-coin',
      'dealt-with-malik',
      'entered-safehouse',
      'became-infected',
      'faced-the-walker',
      'secured-royal-writ',
    ])
    expect(result.length).toBe(6)
  })
})

describe('projectJournal — defensive: missing room/flag/item/status', () => {
  it('missing room does not throw and entry is omitted', () => {
    expect(() => projectJournal(demoJournalSpec, makeState())).not.toThrow()
    expect(ids(projectJournal(demoJournalSpec, makeState()))).toEqual([])
  })

  it('room present but flags record absent — room-flag entry omitted, no throw', () => {
    const state = makeState({
      roomStates: { 'throne-room': { visited: true } },
    })
    expect(() => projectJournal(demoJournalSpec, state)).not.toThrow()
    expect(ids(projectJournal(demoJournalSpec, state))).not.toContain('claimed-tribute-coin')
  })

  it('unrelated generated-room state produces empty entries, no throw', () => {
    const state = makeState({
      roomStates: { 'some-generated-room': { visited: true, flags: { 'interaction:x': true } } },
      inventory: [{ itemId: 'random-item', name: 'Random', quantity: 1 }],
    })
    expect(() => projectJournal(demoJournalSpec, state)).not.toThrow()
    expect(ids(projectJournal(demoJournalSpec, state))).toEqual([])
  })
})

describe('projectJournal — purity and no mutation', () => {
  it('does not mutate the input WorldState', () => {
    const state = makeState({
      roomStates: { 'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } } },
    })
    const before = JSON.stringify(state)
    projectJournal(demoJournalSpec, state)
    expect(JSON.stringify(state)).toBe(before)
  })

  it('does not mutate the input JournalSpec', () => {
    const before = JSON.stringify(demoJournalSpec)
    projectJournal(demoJournalSpec, makeState())
    expect(JSON.stringify(demoJournalSpec)).toBe(before)
  })

  it('returns fresh entries array reference each call', () => {
    const view = projectJournal(demoJournalSpec, makeState())
    expect(Array.isArray(view.entries)).toBe(true)
    expect(view.entries).not.toBe(demoJournalSpec.entries)
  })

  it('same input produces identical output (deterministic)', () => {
    const state = makeState({
      roomStates: { 'throne-room': { visited: true, flags: { 'interaction:offering-coffer': true } } },
    })
    const a = projectJournal(demoJournalSpec, state)
    const b = projectJournal(demoJournalSpec, state)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('projectJournal — save/load restore implication', () => {
  it('re-projecting restored state reproduces mid-play journal entries', () => {
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
    const result = ids(projectJournal(demoJournalSpec, restoredState))
    expect(result).toContain('claimed-tribute-coin')
    expect(result).toContain('dealt-with-malik')
    expect(result).toContain('entered-safehouse')
    expect(result).not.toContain('became-infected')
    expect(result).not.toContain('faced-the-walker')
    expect(result).not.toContain('secured-royal-writ')
  })
})

describe('projectJournal — schema and shared evaluator guard', () => {
  it('demoJournalSpec satisfies JournalSpecSchema', () => {
    expect(() => JournalSpecSchema.parse(demoJournalSpec)).not.toThrow()
  })

  it('exported evaluateCondition is the same pure helper (no behavior change to quest path)', () => {
    expect(typeof evaluateCondition).toBe('function')
    const state = makeState({ player: { health: { current: 75, max: 100 }, status: ['infected'] } })
    expect(evaluateCondition({ kind: 'has-status', status: 'infected' }, state)).toBe(true)
    expect(evaluateCondition({ kind: 'has-status', status: 'poisoned' }, state)).toBe(false)
  })
})
