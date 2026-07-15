import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { meaningfulObjectStateFlagKey } from '../domain/objectPurpose/meaningfulObjectRuntime'
import { projectWorldState } from '../domain/world/applyEvent'
import type { Logger } from '../platform/logger/Logger'
import { InMemoryWorldStore } from './InMemoryWorldStore'
import { WorldSession } from './WorldSession'

const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
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
  return { store, session: new WorldSession(store, clock, ids, noopLogger) }
}

const room = loadRoomSpec({
  schemaVersion: 1,
  id: 'generated-room',
  name: 'Generated',
  shell: { dimensions: { width: 10, depth: 10, height: 4 } },
  spawn: { position: [0, 1, 0] },
  objects: [
    {
      id: 'note',
      type: 'paper',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
    },
    {
      id: 'cache',
      type: 'chest',
      position: [1, 0, 0],
      interaction: {
        key: 'E',
        prompt: 'Take',
        effect: { kind: 'take-item', item: { itemId: 'key', name: 'Key', quantity: 1 } },
      },
    },
    {
      id: 'corpse',
      type: 'corpse',
      position: [2, 0, 0],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    },
  ],
})
async function start(value: ReturnType<typeof harness>) {
  const result = await value.session.startSession({
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000099',
    name: 'World',
    startingRoomId: room.id,
    initialPlayer: { health: { current: 10, max: 10 }, status: [], inventory: [] },
  })
  if (!result.ok) throw new Error(result.error.code)
  return result.state
}

describe('WorldSession meaningful object command', () => {
  it('derives read state and rejects caller state overrides and invalid pairs', async () => {
    const value = harness()
    const initial = await start(value)
    const context = { room, generatedPlay: true }

    const withNextState = await value.session.applyMeaningfulObject(
      initial.sessionId,
      {
        schemaVersion: 1,
        type: 'meaningful-object-applied',
        roomId: room.id,
        objectId: 'note',
        family: 'document',
        action: 'read',
        nextState: 'looted',
      },
      initial.revision,
      context,
    )
    expect(withNextState.ok).toBe(false)

    const invalidPair = await value.session.applyMeaningfulObject(
      initial.sessionId,
      {
        schemaVersion: 1,
        type: 'meaningful-object-applied',
        roomId: room.id,
        objectId: 'note',
        family: 'document',
        action: 'search',
      },
      initial.revision,
      context,
    )
    expect(invalidPair.ok).toBe(false)

    const read = await value.session.applyMeaningfulObject(
      initial.sessionId,
      {
        schemaVersion: 1,
        type: 'meaningful-object-applied',
        roomId: room.id,
        objectId: 'note',
        family: 'document',
        action: 'read',
      },
      initial.revision,
      context,
    )
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.event).toMatchObject({
      type: 'meaningful-object-applied',
      payload: { family: 'document', action: 'read', state: 'read' },
    })
    expect(read.state.roomStates[room.id]?.flags?.[meaningfulObjectStateFlagKey('note', 'read')])
      .toBe(true)

    const repeated = await value.session.applyMeaningfulObject(
      initial.sessionId,
      {
        schemaVersion: 1,
        type: 'meaningful-object-applied',
        roomId: room.id,
        objectId: 'note',
        family: 'document',
        action: 'read',
      },
      read.state.revision,
      context,
    )
    expect(repeated.ok).toBe(false)
    expect(await value.store.listEvents(initial.sessionId)).toHaveLength(2)
  })

  it('atomically opens and searches with exactly the validated item', async () => {
    const value = harness()
    const initial = await start(value)
    const context = { room, generatedPlay: true }
    const openCommand = {
      schemaVersion: 1 as const,
      type: 'meaningful-object-applied' as const,
      roomId: room.id,
      objectId: 'cache',
      family: 'container' as const,
      action: 'open' as const,
    }

    const itemOnOpen = await value.session.applyMeaningfulObject(
      initial.sessionId,
      { ...openCommand, item: { itemId: 'key', name: 'Key', quantity: 1 } },
      initial.revision,
      context,
    )
    expect(itemOnOpen.ok).toBe(false)

    const opened = await value.session.applyMeaningfulObject(
      initial.sessionId,
      openCommand,
      initial.revision,
      context,
    )
    if (!opened.ok) throw new Error(opened.error.code)

    const mismatch = await value.session.applyMeaningfulObject(
      initial.sessionId,
      {
        ...openCommand,
        action: 'search',
        item: { itemId: 'other', name: 'Other', quantity: 1 },
      },
      opened.state.revision,
      context,
    )
    expect(mismatch.ok).toBe(false)

    const searched = await value.session.applyMeaningfulObject(
      initial.sessionId,
      {
        ...openCommand,
        action: 'search',
        item: { itemId: 'key', name: 'Key', quantity: 1 },
      },
      opened.state.revision,
      context,
    )
    if (!searched.ok) throw new Error(searched.error.code)
    expect(searched.state.inventory).toEqual([{ itemId: 'key', name: 'Key', quantity: 1 }])
    expect(searched.state.roomStates[room.id]?.flags?.[meaningfulObjectStateFlagKey('cache', 'looted')])
      .toBe(true)
    const log = await value.store.listEvents(initial.sessionId)
    expect(log).toHaveLength(3)
    expect(projectWorldState(log)).toEqual(searched.state)

    const staleDuplicate = await value.session.applyMeaningfulObject(
      initial.sessionId,
      {
        ...openCommand,
        action: 'search',
        item: { itemId: 'key', name: 'Key', quantity: 1 },
      },
      opened.state.revision,
      context,
    )
    expect(staleDuplicate.ok).toBe(false)
    if (!staleDuplicate.ok) expect(staleDuplicate.error.code).toBe('conflict')
    expect((await value.store.getSnapshot(initial.sessionId))?.inventory).toHaveLength(1)
  })

  it('fails closed for wrong room, missing object, authored mode, and unvalidated item', async () => {
    const value = harness()
    const initial = await start(value)
    const command = {
      schemaVersion: 1,
      type: 'meaningful-object-applied',
      roomId: room.id,
      objectId: 'corpse',
      family: 'remains',
      action: 'search',
    }
    expect((await value.session.applyMeaningfulObject(
      initial.sessionId,
      { ...command, roomId: 'elsewhere' },
      initial.revision,
      { room, generatedPlay: true },
    )).ok).toBe(false)
    expect((await value.session.applyMeaningfulObject(
      initial.sessionId,
      { ...command, objectId: 'missing' },
      initial.revision,
      { room, generatedPlay: true },
    )).ok).toBe(false)
    expect((await value.session.applyMeaningfulObject(
      initial.sessionId,
      command,
      initial.revision,
      { room, generatedPlay: false },
    )).ok).toBe(false)
    expect((await value.session.applyMeaningfulObject(
      initial.sessionId,
      { ...command, item: { itemId: 'invented', name: 'Invented', quantity: 1 } },
      initial.revision,
      { room, generatedPlay: true },
    )).ok).toBe(false)
    expect(await value.store.listEvents(initial.sessionId)).toHaveLength(1)
  })
})
