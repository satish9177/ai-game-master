import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { meaningfulObjectStateFlagKey } from '../domain/objectPurpose/meaningfulObjectRuntime'
import type { Logger } from '../platform/logger/Logger'
import { InMemoryWorldStore } from '../world-session/InMemoryWorldStore'
import { WorldSession } from '../world-session/WorldSession'
import { InteractionService } from './InteractionService'

const logger: Logger = {
  debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined,
  child: () => logger,
}

function create() {
  const room = loadRoomSpec({
    schemaVersion: 1,
    id: 'generated-room',
    name: 'Generated',
    shell: { dimensions: { width: 10, depth: 10, height: 4 } },
    spawn: { position: [0, 1, 0] },
    objects: [
      { id: 'doc', type: 'book', position: [0, 0, 0], interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } } },
      { id: 'box', type: 'crate', position: [1, 0, 0], interaction: { key: 'E', prompt: 'Take', effect: { kind: 'take-item', item: { itemId: 'coin', name: 'Coin', quantity: 1 } } } },
      { id: 'body', type: 'corpse', position: [2, 0, 0], interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } } },
      { id: 'table', type: 'table', position: [3, 0, 0], interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } } },
    ],
  })
  const store = new InMemoryWorldStore()
  let id = 1
  const ids: IdGenerator = { newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}` }
  let tick = 0
  const clock: Clock = { now: () => `2026-07-15T00:00:${String(tick++).padStart(2, '0')}.000Z` }
  const session = new WorldSession(store, clock, ids, logger)
  return { room, store, session, service: new InteractionService(session, logger) }
}

async function start(value: ReturnType<typeof create>) {
  const result = await value.session.startSession({
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000099',
    name: 'World',
    startingRoomId: value.room.id,
    initialPlayer: { health: { current: 10, max: 10 }, status: [], inventory: [] },
  })
  if (!result.ok) throw new Error(result.error.code)
  return result.state
}

describe('InteractionService meaningful objects', () => {
  it('keeps inspect repeatable and event-free, then reads once', async () => {
    const value = create()
    const initial = await start(value)
    const input = {
      sessionId: initial.sessionId,
      room: value.room,
      generatedPlay: true,
      objectId: 'doc',
    }
    expect((await value.service.resolveMeaningfulObject({ ...input, action: 'inspect' })).status)
      .toBe('observed')
    expect((await value.service.resolveMeaningfulObject({ ...input, action: 'inspect' })).status)
      .toBe('observed')
    expect(await value.store.listEvents(initial.sessionId)).toHaveLength(1)

    const read = await value.service.resolveMeaningfulObject({ ...input, action: 'read' })
    expect(read.status).toBe('applied')
    const repeated = await value.service.resolveMeaningfulObject({ ...input, action: 'read' })
    expect(repeated).toMatchObject({ status: 'already-resolved', action: 'read' })
    expect(await value.store.listEvents(initial.sessionId)).toHaveLength(2)
  })

  it('derives container choices and grants its validated reward at most once', async () => {
    const value = create()
    const initial = await start(value)
    const input = { sessionId: initial.sessionId, room: value.room, generatedPlay: true, objectId: 'box' }
    expect((await value.service.getMeaningfulObjectView(input)).status).toBe('available')
    expect((await value.service.resolveMeaningfulObject({ ...input, action: 'open' })).status).toBe('applied')
    expect((await value.service.resolveMeaningfulObject({ ...input, action: 'search' })).status).toBe('applied')
    expect((await value.service.resolveMeaningfulObject({ ...input, action: 'search' })))
      .toMatchObject({ status: 'already-resolved', action: 'search' })
    const state = await value.store.getSnapshot(initial.sessionId)
    expect(state?.inventory).toEqual([{ itemId: 'coin', name: 'Coin', quantity: 1 }])
    expect(state?.roomStates[value.room.id]?.flags?.[meaningfulObjectStateFlagKey('box', 'looted')])
      .toBe(true)
  })

  it('searches remains with no item and preserves unsupported/authored behavior', async () => {
    const value = create()
    const initial = await start(value)
    const remains = { sessionId: initial.sessionId, room: value.room, generatedPlay: true, objectId: 'body' }
    expect((await value.service.resolveMeaningfulObject({ ...remains, action: 'search' })).status)
      .toBe('applied')
    expect((await value.service.resolveMeaningfulObject({ ...remains, action: 'search' })))
      .toMatchObject({ status: 'already-resolved', action: 'search' })

    expect((await value.service.getMeaningfulObjectView({
      sessionId: initial.sessionId,
      room: value.room,
      generatedPlay: true,
      objectId: 'table',
    })).status).toBe('unavailable')
    expect((await value.service.getMeaningfulObjectView({
      sessionId: initial.sessionId,
      room: value.room,
      generatedPlay: false,
      objectId: 'doc',
    })).status).toBe('unavailable')
  })
})
