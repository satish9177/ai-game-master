import { describe, expect, it } from 'vitest'
import { restoreGeneratedRoomCache } from '../../app/restoreGeneratedRoomCache'
import { loadRoomSpec } from '../loadRoomSpec'
import type { MeaningfulObjectConsequenceCatalog } from '../objectPurpose/meaningfulObjectConsequences'
import type { QuestSpec } from './questSpec'
import {
  buildGeneratedRoomCacheSaveState,
  loadGeneratedRoomCacheSaveState,
} from './generatedRoomCacheSaveState'
import { buildGeneratedQuestSaveState } from './generatedQuestSaveState'

const room = loadRoomSpec({
  schemaVersion: 1,
  id: 'generated-room',
  name: 'Generated',
  shell: { dimensions: { width: 10, depth: 10, height: 4 } },
  spawn: { position: [0, 1, 0] },
  objects: [
    { id: 'doc', type: 'book', position: [0, 0, 0], interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } } },
  ],
})
const quest: QuestSpec = {
  questId: 'quest',
  title: 'Quest',
  anchorRoomId: room.id,
  objectives: [{ id: 'generated-0', text: 'Read.', condition: { kind: 'has-status', status: 'never' } }],
}
const catalog: MeaningfulObjectConsequenceCatalog = {
  clues: [{ id: 'clue', sourceObjectId: 'doc' }],
  consequences: [{
    objectId: 'doc',
    action: 'read',
    clueId: 'clue',
    objective: { objectiveId: 'generated-0', toStage: 1 },
  }],
}

describe('generated room cache meaningful consequence catalog', () => {
  it('persists the validated catalog in the room sidecar only', () => {
    const state = buildGeneratedRoomCacheSaveState({
      rooms: [{ room, provenance: 'generated', consequenceCatalog: catalog, questSpec: quest }],
    })
    expect(state?.rooms[0]?.consequenceCatalog).toEqual(catalog)

    const questState = buildGeneratedQuestSaveState({
      room,
      objectivesPerRoom: true,
      questSpec: quest,
    })
    expect(JSON.stringify(questState)).not.toContain('consequenceCatalog')
    expect(JSON.stringify(questState)).not.toContain('clueId')
  })

  it('old sidecars without a catalog retain an absent catalog', () => {
    const state = buildGeneratedRoomCacheSaveState({
      rooms: [{ room, provenance: 'generated' }],
    })
    const loaded = loadGeneratedRoomCacheSaveState(JSON.stringify(state))
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.state.rooms[0]?.consequenceCatalog).toBeUndefined()
  })

  it('drops invalid catalog data while preserving the valid room sidecar', () => {
    const base = buildGeneratedRoomCacheSaveState({
      rooms: [{ room, provenance: 'generated' }],
    })
    const loaded = loadGeneratedRoomCacheSaveState(JSON.stringify({
      ...base,
      rooms: [{
        ...base!.rooms[0],
        consequenceCatalog: {
          clues: [{ id: 'clue', sourceObjectId: 'doc', unknown: true }],
          consequences: [{ objectId: 'doc', action: 'read', clueId: 'clue' }],
        },
      }],
    }))
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.state.rooms[0]?.consequenceCatalog).toBeUndefined()
    expect(loaded.state.rooms[0]?.room.id).toBe(room.id)
  })

  it('revalidates restored object and current-quest references', () => {
    const state = buildGeneratedRoomCacheSaveState({
      rooms: [{ room, provenance: 'generated', consequenceCatalog: catalog, questSpec: quest }],
    })!
    expect(restoreGeneratedRoomCache(state, room, quest).consequenceCatalogs.get(room.id))
      .toEqual(catalog)
    expect(restoreGeneratedRoomCache(state, room, { ...quest, anchorRoomId: 'other' })
      .consequenceCatalogs.has(room.id)).toBe(false)
    expect(restoreGeneratedRoomCache(state, room, {
      ...quest,
      objectives: [{ ...quest.objectives[0]!, id: 'other' }],
    }).consequenceCatalogs.has(room.id)).toBe(false)
  })
})
