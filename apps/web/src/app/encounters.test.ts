import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { EncounterResult } from '../encounters/EncounterService'
import { buildEncounterLookup, encounterResultMessage } from './encounters'

const fightEncounter = {
  id: 'guard-encounter',
  description: 'A guard bars the way.',
  choices: [{ id: 'fight', action: 'fight', label: 'Fight', outcome: { effects: [] } }],
}

describe('buildEncounterLookup', () => {
  it('maps interactable ids to validated encounters, including objects that also carry an effect', () => {
    const room = loadRoomSpec({
      schemaVersion: 1,
      id: 'lookup-room',
      name: 'Lookup Room',
      shell: { dimensions: { width: 10, depth: 10, height: 4 } },
      spawn: { position: [0, 1.7, 3] },
      objects: [
        {
          type: 'npc',
          id: 'malik',
          name: 'Malik',
          position: [-1, 0, 0],
          // Both an effect AND an encounter: the encounter wins at routing time,
          // and it still appears in the encounter lookup here.
          interaction: { key: 'F', prompt: 'Speak', effect: { kind: 'inspect' }, encounter: fightEncounter },
        },
        {
          type: 'zombie',
          id: 'walker',
          position: [1, 0, 0],
          interaction: { key: 'F', prompt: 'Confront', encounter: fightEncounter },
        },
        {
          type: 'scroll',
          id: 'note',
          position: [0, 0, 0],
          // Effect-only object: never enters the encounter lookup.
          interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
        },
      ],
    })

    const lookup = buildEncounterLookup(room)
    expect([...lookup.keys()]).toEqual(['malik', 'walker'])
    expect(lookup.get('malik')).toEqual({ encounter: fightEncounter, ref: 'malik' })
    expect(lookup.has('note')).toBe(false)
  })

  it('skips encounter-bearing objects without a stable id instead of using an undefined key', () => {
    const room = loadRoomSpec({
      schemaVersion: 1,
      id: 'missing-ref-room',
      name: 'Missing Ref Room',
      shell: { dimensions: { width: 10, depth: 10, height: 4 } },
      spawn: { position: [0, 1.7, 3] },
      objects: [
        {
          type: 'zombie',
          position: [1, 0, 0],
          interaction: { key: 'F', prompt: 'Confront', encounter: fightEncounter },
        },
      ],
    })
    const lookup = buildEncounterLookup(room)
    expect(lookup.has(undefined)).toBe(false)
    expect(lookup.size).toBe(0)
  })
})

describe('encounterResultMessage', () => {
  it('maps each applied action to a genre-neutral line', () => {
    const message = (action: string) =>
      encounterResultMessage({
        status: 'applied',
        outcome: { kind: 'resolved', action: action as never, choiceId: 'c' },
        state: {} as never,
      })
    expect(message('fight')).toBe('You stand and fight.')
    expect(message('hide')).toBe('You stay hidden.')
    expect(message('run')).toBe('You break away and run.')
    expect(message('distract')).toBe('You create a distraction.')
    expect(message('negotiate')).toBe('You talk your way through.')
  })

  it('maps non-apply outcomes to safe lines (missing-encounter shows nothing)', () => {
    const cases: [EncounterResult, string | undefined][] = [
      [{ status: 'already-resolved', outcome: { kind: 'nothing' }, state: {} as never }, 'You have already faced this.'],
      [{ status: 'rejected', reason: 'missing-encounter' }, undefined],
      [{ status: 'rejected', reason: 'insufficient-item' }, "You don't have what you need."],
      [{ status: 'rejected', reason: 'unknown-choice' }, 'Nothing happens.'],
      [{ status: 'failed', reason: 'partial' }, 'The moment passes only halfway.'],
      [{ status: 'failed', reason: 'conflict' }, 'The world shifts. Try again.'],
      [{ status: 'failed', reason: 'not-found' }, 'This encounter is unavailable.'],
    ]
    for (const [result, expected] of cases) {
      expect(encounterResultMessage(result)).toBe(expected)
    }
  })
})
