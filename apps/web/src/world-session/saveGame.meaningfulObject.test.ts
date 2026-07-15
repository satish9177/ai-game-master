import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { deriveMeaningfulObjectView } from '../domain/objectPurpose/meaningfulObjectRuntime'
import {
  meaningfulClueFlagKey,
  meaningfulObjectiveFlagKey,
} from '../domain/objectPurpose/meaningfulObjectConsequences'
import type { MeaningfulObjectConsequenceCatalog } from '../domain/objectPurpose/meaningfulObjectConsequences'
import type { QuestSpec } from '../domain/quests/questSpec'
import type { Logger } from '../platform/logger/Logger'
import { InMemoryWorldStore } from './InMemoryWorldStore'
import { SaveGameService } from './saveGame'
import { WorldSession } from './WorldSession'

const logger: Logger = {
  debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined,
  child: () => logger,
}

function dependencies() {
  let id = 1
  const ids: IdGenerator = { newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}` }
  let tick = 0
  const clock: Clock = { now: () => `2026-07-15T00:00:${String(tick++).padStart(2, '0')}.000Z` }
  return { ids, clock }
}

const room = loadRoomSpec({
  schemaVersion: 1,
  id: 'generated-room',
  name: 'Generated',
  shell: { dimensions: { width: 10, depth: 10, height: 4 } },
  spawn: { position: [0, 1, 0] },
  objects: [{
    id: 'cache',
    type: 'chest',
    position: [0, 0, 0],
    interaction: {
      key: 'E',
      prompt: 'Take',
      effect: { kind: 'take-item', item: { itemId: 'key', name: 'Key', quantity: 1 } },
    },
  }],
})
const quest: QuestSpec = {
  questId: 'generated-quest',
  title: 'Quest',
  anchorRoomId: room.id,
  objectives: [{ id: 'generated-0', text: 'Search.', condition: { kind: 'has-status', status: 'never' } }],
}
const consequenceCatalog: MeaningfulObjectConsequenceCatalog = {
  clues: [{ id: 'cache-clue', sourceObjectId: 'cache' }],
  consequences: [{
    objectId: 'cache',
    action: 'search',
    clueId: 'cache-clue',
    objective: { objectiveId: 'generated-0', toStage: 1 },
  }],
}
describe('saveGame meaningful object persistence', () => {
  it('preserves atomic object, item, clue, and objective state through room return and save/load', async () => {
    const sourceStore = new InMemoryWorldStore()
    const sourceDeps = dependencies()
    const session = new WorldSession(sourceStore, sourceDeps.clock, sourceDeps.ids, logger)
    const started = await session.startSession({
      schemaVersion: 1,
      worldId: '00000000-0000-4000-8000-000000000099',
      name: 'World',
      startingRoomId: room.id,
      initialPlayer: { health: { current: 10, max: 10 }, status: [], inventory: [] },
    })
    if (!started.ok) throw new Error(started.error.code)
    const context = { room, generatedPlay: true, consequenceCatalog, questSpec: quest }
    const command = {
      schemaVersion: 1 as const,
      type: 'meaningful-object-applied' as const,
      roomId: room.id,
      objectId: 'cache',
      family: 'container' as const,
    }
    const opened = await session.applyMeaningfulObject(
      started.state.sessionId,
      { ...command, action: 'open' },
      started.state.revision,
      context,
    )
    if (!opened.ok) throw new Error(opened.error.code)
    const searched = await session.applyMeaningfulObject(
      started.state.sessionId,
      {
        ...command,
        action: 'search',
        item: { itemId: 'key', name: 'Key', quantity: 1 },
        clueId: 'cache-clue',
        objective: { objectiveId: 'generated-0', toStage: 1 },
      },
      opened.state.revision,
      context,
    )
    if (!searched.ok) throw new Error(searched.error.code)
    const away = await session.move(searched.state.sessionId, 'next', searched.state.revision, room.id)
    if (!away.ok) throw new Error(away.error.code)
    const returned = await session.move(away.state.sessionId, room.id, away.state.revision, 'next')
    if (!returned.ok) throw new Error(returned.error.code)

    expect(deriveMeaningfulObjectView({
      object: room.objects[0]!,
      roomState: returned.state.roomStates[room.id],
      generatedPlay: true,
    })?.state).toBe('looted')
    expect(returned.state.roomStates[room.id]?.flags?.[meaningfulClueFlagKey('cache-clue')])
      .toBe(true)
    expect(returned.state.roomStates[room.id]?.flags?.[
      meaningfulObjectiveFlagKey(quest.questId, 'generated-0')
    ]).toBe(true)

    const saved = await new SaveGameService(sourceStore, logger).saveSession(returned.state.sessionId)
    if (!saved.ok) throw new Error(saved.error.code)
    const restoredStore = new InMemoryWorldStore()
    const restored = await new SaveGameService(restoredStore, logger).loadSession(saved.json)
    if (!restored.ok) throw new Error(restored.error.code)
    expect(await restoredStore.getSnapshot(restored.sessionId)).toEqual(returned.state)
  })
})
