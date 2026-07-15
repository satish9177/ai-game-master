import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import {
  meaningfulClueFlagKey,
  meaningfulObjectiveFlagKey,
} from '../domain/objectPurpose/meaningfulObjectConsequences'
import type { MeaningfulObjectConsequenceCatalog } from '../domain/objectPurpose/meaningfulObjectConsequences'
import { meaningfulObjectStateFlagKey } from '../domain/objectPurpose/meaningfulObjectRuntime'
import type { QuestSpec } from '../domain/quests/questSpec'
import { projectWorldState } from '../domain/world/applyEvent'
import type { Logger } from '../platform/logger/Logger'
import { InteractionService } from '../interactions/InteractionService'
import { InMemoryWorldStore } from './InMemoryWorldStore'
import { WorldSession } from './WorldSession'

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}

const room = loadRoomSpec({
  schemaVersion: 1,
  id: 'generated-room',
  name: 'Generated',
  shell: { dimensions: { width: 10, depth: 10, height: 4 } },
  spawn: { position: [0, 1, 0] },
  objects: [
    { id: 'doc', type: 'book', position: [0, 0, 0], interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } } },
    { id: 'box', type: 'crate', position: [1, 0, 0], interaction: { key: 'E', prompt: 'Search', effect: { kind: 'take-item', item: { itemId: 'coin', name: 'Coin', quantity: 1 } } } },
    { id: 'body', type: 'corpse', position: [2, 0, 0], interaction: { key: 'E', prompt: 'Search', effect: { kind: 'inspect' } } },
  ],
})

const quest: QuestSpec = {
  questId: 'generated-quest',
  title: 'Generated quest',
  anchorRoomId: room.id,
  objectives: [{
    id: 'generated-0',
    text: 'Search the remains.',
    condition: { kind: 'has-status', status: 'already-done' },
  }],
}

const catalog: MeaningfulObjectConsequenceCatalog = {
  clues: [
    { id: 'shared-clue', sourceObjectId: 'doc' },
    { id: 'shared-clue', sourceObjectId: 'box' },
    { id: 'body-clue', sourceObjectId: 'body' },
  ],
  consequences: [
    { objectId: 'doc', action: 'read', clueId: 'shared-clue' },
    { objectId: 'box', action: 'search', clueId: 'shared-clue' },
    {
      objectId: 'body',
      action: 'search',
      clueId: 'body-clue',
      objective: { objectiveId: 'generated-0', toStage: 1 },
    },
  ],
}

function harness() {
  const store = new InMemoryWorldStore()
  let id = 1
  const ids: IdGenerator = {
    newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  let tick = 0
  const clock: Clock = {
    now: () => `2026-07-15T00:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  const session = new WorldSession(store, clock, ids, logger)
  const service = new InteractionService(session, logger, () => ({
    consequenceCatalog: catalog,
    questSpec: quest,
  }))
  return { store, session, service }
}

async function start(value: ReturnType<typeof harness>, status: string[] = []) {
  const result = await value.session.startSession({
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000099',
    name: 'World',
    startingRoomId: room.id,
    initialPlayer: { health: { current: 10, max: 10 }, status, inventory: [] },
  })
  if (!result.ok) throw new Error(result.error.code)
  return result.state
}

const input = (sessionId: string, objectId: string, action: 'read' | 'open' | 'search') => ({
  sessionId,
  room,
  generatedPlay: true,
  objectId,
  action,
})

describe('ADR-0094 meaningful object consequences', () => {
  it('derives requested fields and atomically applies object, item, clue, and objective', async () => {
    const value = harness()
    const initial = await start(value)

    const read = await value.service.resolveMeaningfulObject(input(initial.sessionId, 'doc', 'read'))
    expect(read).toMatchObject({ status: 'applied', message: 'You read it. You discovered a clue.' })
    if (read.status !== 'applied') return
    expect(read.event).toMatchObject({ payload: { clueId: 'shared-clue' } })

    const open = await value.service.resolveMeaningfulObject(input(initial.sessionId, 'box', 'open'))
    expect(open.status).toBe('applied')
    const search = await value.service.resolveMeaningfulObject(input(initial.sessionId, 'box', 'search'))
    expect(search).toMatchObject({
      status: 'applied',
      message: 'You search it. You already knew this clue.',
    })
    if (search.status !== 'applied') return
    expect(search.event).not.toHaveProperty('payload.clueId')
    expect(search.state.inventory).toEqual([{ itemId: 'coin', name: 'Coin', quantity: 1 }])

    const remains = await value.service.resolveMeaningfulObject(input(initial.sessionId, 'body', 'search'))
    expect(remains).toMatchObject({
      status: 'applied',
      message: 'You search it. You discovered a clue. You advanced an objective.',
    })
    if (remains.status !== 'applied') return
    expect(remains.event).toMatchObject({
      payload: {
        state: 'looted',
        clueId: 'body-clue',
        objective: { questId: quest.questId, objectiveId: 'generated-0', toStage: 1 },
      },
    })
    const flags = remains.state.roomStates[room.id]?.flags
    expect(flags?.[meaningfulObjectStateFlagKey('body', 'looted')]).toBe(true)
    expect(flags?.[meaningfulClueFlagKey('body-clue')]).toBe(true)
    expect(flags?.[meaningfulObjectiveFlagKey(quest.questId, 'generated-0')]).toBe(true)
    expect(projectWorldState(await value.store.listEvents(initial.sessionId))).toEqual(remains.state)
  })

  it('omits an already-satisfied objective while applying the clue and object state', async () => {
    const value = harness()
    const initial = await start(value, ['already-done'])
    const result = await value.service.resolveMeaningfulObject(input(initial.sessionId, 'body', 'search'))
    expect(result).toMatchObject({
      status: 'applied',
      message: 'You search it. You discovered a clue. That objective was already satisfied.',
    })
    if (result.status !== 'applied') return
    expect(result.event).not.toHaveProperty('payload.objective')
    expect(result.event).toHaveProperty('payload.clueId', 'body-clue')
    expect(result.state.roomStates[room.id]?.flags?.[meaningfulObjectStateFlagKey('body', 'looted')])
      .toBe(true)
  })

  it('rejects omitted, added, changed, unknown, and invalid-stage consequence fields atomically', async () => {
    const value = harness()
    const initial = await start(value)
    const context = { room, generatedPlay: true, consequenceCatalog: catalog, questSpec: quest }
    const base = {
      schemaVersion: 1,
      type: 'meaningful-object-applied',
      roomId: room.id,
      objectId: 'doc',
      family: 'document',
      action: 'read',
    }
    const invalid = [
      base,
      { ...base, clueId: 'added' },
      { ...base, clueId: 'shared-clue', objective: { objectiveId: 'generated-0', toStage: 1 } },
      { ...base, clueId: 'shared-clue', extra: true },
      { ...base, clueId: 'shared-clue', objective: { objectiveId: 'generated-0', toStage: 2 } },
    ]
    for (const command of invalid) {
      const result = await value.session.applyMeaningfulObject(
        initial.sessionId,
        command,
        initial.revision,
        context,
      )
      expect(result.ok).toBe(false)
      expect((await value.store.getSnapshot(initial.sessionId))?.revision).toBe(initial.revision)
      expect(await value.store.listEvents(initial.sessionId)).toHaveLength(1)
    }
  })

  it('rejects missing, unrelated, cross-room, and authored objective authority', async () => {
    const variants: Array<{ questSpec?: QuestSpec; generatedPlay: boolean }> = [
      { generatedPlay: true },
      { generatedPlay: true, questSpec: { ...quest, objectives: [{ ...quest.objectives[0]!, id: 'other' }] } },
      { generatedPlay: true, questSpec: { ...quest, anchorRoomId: 'other-room' } },
      { generatedPlay: false, questSpec: quest },
    ]
    for (const variant of variants) {
      const value = harness()
      const initial = await start(value)
      const result = await value.session.applyMeaningfulObject(
        initial.sessionId,
        {
          schemaVersion: 1,
          type: 'meaningful-object-applied',
          roomId: room.id,
          objectId: 'body',
          family: 'remains',
          action: 'search',
          clueId: 'body-clue',
          objective: { objectiveId: 'generated-0', toStage: 1 },
        },
        initial.revision,
        { room, consequenceCatalog: catalog, ...variant },
      )
      expect(result.ok).toBe(false)
      expect(await value.store.listEvents(initial.sessionId)).toHaveLength(1)
    }
  })

  it('keeps attachment-free Slice B commands valid and stale CAS prevents duplication', async () => {
    const value = harness()
    const initial = await start(value)
    const opened = await value.service.resolveMeaningfulObject(input(initial.sessionId, 'box', 'open'))
    expect(opened.status).toBe('applied')
    if (opened.status !== 'applied') return
    expect(opened.event).not.toHaveProperty('payload.clueId')
    const searched = await value.service.resolveMeaningfulObject(input(initial.sessionId, 'box', 'search'))
    expect(searched.status).toBe('applied')
    const stale = await value.session.applyMeaningfulObject(
      initial.sessionId,
      {
        schemaVersion: 1,
        type: 'meaningful-object-applied',
        roomId: room.id,
        objectId: 'box',
        family: 'container',
        action: 'search',
        item: { itemId: 'coin', name: 'Coin', quantity: 1 },
        clueId: 'shared-clue',
      },
      opened.state.revision,
      { room, generatedPlay: true, consequenceCatalog: catalog, questSpec: quest },
    )
    expect(stale).toMatchObject({ ok: false, error: { code: 'conflict' } })
    expect((await value.store.getSnapshot(initial.sessionId))?.inventory).toHaveLength(1)
  })
})
