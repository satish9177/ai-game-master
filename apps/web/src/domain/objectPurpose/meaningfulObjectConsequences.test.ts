import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../loadRoomSpec'
import type { QuestSpec } from '../quests/questSpec'
import type { WorldState } from '../world/worldState'
import {
  isMeaningfulClueKnown,
  meaningfulClueFlagKey,
  meaningfulObjectiveFlagKey,
  parseMeaningfulObjectConsequenceCatalog,
  validateMeaningfulObjectConsequenceCatalog,
} from './meaningfulObjectConsequences'

const room = loadRoomSpec({
  schemaVersion: 1,
  id: 'room',
  name: 'Room',
  shell: { dimensions: { width: 10, depth: 10, height: 4 } },
  spawn: { position: [0, 1, 0] },
  objects: [
    { id: 'doc', type: 'book', position: [0, 0, 0], interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } } },
    { id: 'box', type: 'crate', position: [1, 0, 0], interaction: { key: 'E', prompt: 'Search', effect: { kind: 'take-item', item: { itemId: 'item', name: 'Item', quantity: 1 } } } },
    { id: 'decor', type: 'table', position: [2, 0, 0] },
  ],
})

const quest: QuestSpec = {
  questId: 'quest',
  title: 'Quest',
  anchorRoomId: room.id,
  objectives: [{
    id: 'objective',
    text: 'Objective',
    condition: { kind: 'has-status', status: 'never' },
  }],
}

const catalog = {
  clues: [{ id: 'clue', sourceObjectId: 'doc' }],
  consequences: [{
    objectId: 'doc',
    action: 'read' as const,
    clueId: 'clue',
    objective: { objectiveId: 'objective', toStage: 1 as const },
  }],
}

describe('meaningful object consequence catalog', () => {
  it('strictly parses and validates a room/quest-bound catalog', () => {
    expect(parseMeaningfulObjectConsequenceCatalog(catalog)).toEqual(catalog)
    expect(validateMeaningfulObjectConsequenceCatalog(catalog, { room, questSpec: quest }))
      .toEqual(catalog)
    expect(parseMeaningfulObjectConsequenceCatalog({ ...catalog, extra: true })).toBeNull()
    expect(parseMeaningfulObjectConsequenceCatalog({
      ...catalog,
      clues: [{ ...catalog.clues[0], extra: true }],
    })).toBeNull()
    expect(parseMeaningfulObjectConsequenceCatalog({
      ...catalog,
      consequences: [{ ...catalog.consequences[0], objective: { objectiveId: 'objective', toStage: 1, extra: true } }],
    })).toBeNull()
  })

  it('rejects empty IDs, empty effects, open, duplicates, and ambiguous source data', () => {
    expect(parseMeaningfulObjectConsequenceCatalog({
      clues: [], consequences: [{ objectId: ' ', action: 'read', clueId: 'clue' }],
    })).toBeNull()
    expect(parseMeaningfulObjectConsequenceCatalog({
      clues: [], consequences: [{ objectId: 'doc', action: 'read' }],
    })).toBeNull()
    expect(parseMeaningfulObjectConsequenceCatalog({
      clues: [], consequences: [{ objectId: 'doc', action: 'open', objective: { objectiveId: 'objective', toStage: 1 } }],
    })).toBeNull()
    expect(parseMeaningfulObjectConsequenceCatalog({
      clues: [],
      consequences: [
        { objectId: 'doc', action: 'read', objective: { objectiveId: 'objective', toStage: 1 } },
        { objectId: 'doc', action: 'read', objective: { objectiveId: 'other', toStage: 1 } },
      ],
    })).toBeNull()
    expect(parseMeaningfulObjectConsequenceCatalog({
      clues: [{ id: 'clue', sourceObjectId: 'doc' }, { id: 'clue', sourceObjectId: 'doc' }],
      consequences: [{ objectId: 'doc', action: 'read', clueId: 'clue' }],
    })).toBeNull()
    expect(parseMeaningfulObjectConsequenceCatalog({
      clues: [{ id: 'clue', sourceObjectId: 'box' }],
      consequences: [{ objectId: 'doc', action: 'read', clueId: 'clue' }],
    })).toBeNull()
  })

  it('allows two sources to reveal one clue but validates object/action and objective authority', () => {
    const shared = {
      clues: [
        { id: 'shared', sourceObjectId: 'doc' },
        { id: 'shared', sourceObjectId: 'box' },
      ],
      consequences: [
        { objectId: 'doc', action: 'read' as const, clueId: 'shared' },
        { objectId: 'box', action: 'search' as const, clueId: 'shared' },
      ],
    }
    expect(validateMeaningfulObjectConsequenceCatalog(shared, { room, questSpec: quest }))
      .toEqual(shared)
    expect(validateMeaningfulObjectConsequenceCatalog({
      clues: [],
      consequences: [{ objectId: 'decor', action: 'search', objective: { objectiveId: 'objective', toStage: 1 } }],
    }, { room, questSpec: quest })).toBeNull()
    expect(validateMeaningfulObjectConsequenceCatalog(catalog, {
      room,
      questSpec: { ...quest, anchorRoomId: 'other' },
    })).toBeNull()
    expect(validateMeaningfulObjectConsequenceCatalog(catalog, {
      room,
      questSpec: { ...quest, objectives: [{ ...quest.objectives[0]!, id: 'other' }] },
    })).toBeNull()
  })
})

describe('meaningful consequence keys and clue projection', () => {
  it.each(['colon:id', 'slash/id', 'percent%id', 'space id', 'Unicode-雪'])('encodes %s centrally', (id) => {
    expect(meaningfulClueFlagKey(id)).toBe(`meaningful-clue:${encodeURIComponent(id)}`)
    expect(meaningfulObjectiveFlagKey(id, id))
      .toBe(`meaningful-objective:${encodeURIComponent(id)}:${encodeURIComponent(id)}:stage-1`)
  })

  it('finds a clue flag in any current world-state room without consulting projections', () => {
    const state = {
      schemaVersion: 1,
      worldId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      currentRoomId: 'room-b',
      player: { health: { current: 1, max: 1 }, status: [] },
      inventory: [],
      roomStates: {
        'room-a': { visited: true, flags: { [meaningfulClueFlagKey('clue')]: true } },
        'room-b': { visited: true },
      },
      revision: 1,
      updatedAt: '2026-07-15T00:00:00.000Z',
    } satisfies WorldState
    expect(isMeaningfulClueKnown(state, 'clue')).toBe(true)
    expect(isMeaningfulClueKnown(state, 'other')).toBe(false)
  })
})
