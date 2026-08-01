import { describe, expect, it } from 'vitest'
import { throneRoom } from '../domain/examples/throneRoom'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { Logger } from '../platform/logger/Logger'
import { InMemoryWorldStore } from './InMemoryWorldStore'
import { WorldSession } from './WorldSession'
import { loadSaveGame, SaveGameService } from './saveGame'

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}
const room = loadRoomSpec(throneRoom)

function harness() {
  const store = new InMemoryWorldStore()
  let id = 1
  const ids: IdGenerator = {
    newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  let tick = 0
  const clock: Clock = {
    now: () => `2026-07-21T00:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  return {
    store,
    session: new WorldSession(store, clock, ids, logger),
    saves: new SaveGameService(store, logger),
  }
}

async function start(value: ReturnType<typeof harness>) {
  const result = await value.session.startSession({
    schemaVersion: 1,
    worldId: '10000000-0000-4000-8000-000000000000',
    name: 'Old world',
    startingRoomId: 'throne-room',
    initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
  })
  if (!result.ok) throw new Error(result.error.code)
  return result.state
}

async function committedSave() {
  const value = harness()
  const initial = await start(value)
  const added = await value.session.addItem(
    initial.sessionId,
    { itemId: 'gold-coin', name: 'Gold Coin', quantity: 1 },
    initial.revision,
  )
  if (!added.ok) throw new Error(added.error.code)
  const discovered = await value.session.appendEvent(
    initial.sessionId,
    { schemaVersion: 1, type: 'item-discovered', roomId: 'throne-room', itemId: 'gold-coin' },
    added.state.revision,
  )
  if (!discovered.ok) throw new Error(discovered.error.code)
  const flagged = await value.session.setRoomState(
    initial.sessionId,
    'throne-room',
    { flags: { 'interaction:offering-coffer': true } },
    discovered.state.revision,
  )
  if (!flagged.ok) throw new Error(flagged.error.code)
  const committed = await value.session.commitNpcAction(
    initial.sessionId,
    {
      schemaVersion: 1,
      type: 'npc-action-committed',
      npcId: 'herald-asha',
      roomId: 'throne-room',
      action: 'bar-exit',
      targetObjectId: 'north-door',
    },
    flagged.state.revision,
    { room },
  )
  if (!committed.ok) throw new Error(committed.error.code)
  const saved = await value.saves.saveSession(initial.sessionId)
  if (!saved.ok) throw new Error(saved.error.code)
  return { value, state: committed.state, json: saved.json }
}

function handwrittenOldSave(): string {
  return JSON.stringify({
    schemaVersion: 1,
    seed: {
      schemaVersion: 1,
      worldId: '10000000-0000-4000-8000-000000000000',
      name: 'Old world',
      startingRoomId: 'throne-room',
      initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
    },
    log: [{
      schemaVersion: 1,
      eventId: '00000000-0000-4000-8000-000000000002',
      sessionId: '00000000-0000-4000-8000-000000000001',
      seq: 1,
      occurredAt: '2026-07-21T00:00:00.000Z',
      type: 'session-started',
      payload: {
        seed: {
          schemaVersion: 1,
          worldId: '10000000-0000-4000-8000-000000000000',
          name: 'Old world',
          startingRoomId: 'throne-room',
          initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
        },
      },
    }],
    snapshot: {
      schemaVersion: 1,
      worldId: '10000000-0000-4000-8000-000000000000',
      sessionId: '00000000-0000-4000-8000-000000000001',
      currentRoomId: 'throne-room',
      player: { health: { current: 100, max: 100 }, status: [] },
      inventory: [],
      roomStates: { 'throne-room': { visited: true } },
      revision: 1,
      updatedAt: '2026-07-21T00:00:00.000Z',
    },
  })
}

describe('NPC action save/load', () => {
  it('T30 round-trips the seq-5 action and projected flag', async () => {
    const saved = await committedSave()
    const loaded = loadSaveGame(saved.json)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.saveGame.log).toHaveLength(5)
    expect(loaded.saveGame.log[4]?.type).toBe('npc-action-committed')
    expect(loaded.saveGame.snapshot).toEqual(saved.state)

    const restored = harness()
    expect(await restored.saves.loadSession(saved.json)).toEqual({
      ok: true,
      sessionId: saved.state.sessionId,
    })
    expect(await restored.store.getSnapshot(saved.state.sessionId)).toEqual(saved.state)
  })

  it('refuses a repeated NPC action after restoring through the supported save path', async () => {
    const saved = await committedSave()
    const restored = harness()
    const loaded = await restored.saves.loadSession(saved.json)
    expect(loaded).toEqual({ ok: true, sessionId: saved.state.sessionId })

    const repeated = await restored.session.commitNpcAction(
      saved.state.sessionId,
      {
        schemaVersion: 1,
        type: 'npc-action-committed',
        npcId: 'herald-asha',
        roomId: 'throne-room',
        action: 'bar-exit',
        targetObjectId: 'north-door',
      },
      saved.state.revision,
      { room },
    )
    expect(repeated.ok).toBe(false)
    if (!repeated.ok) expect(repeated.error.code).toBe('invalid-command')
    const log = await restored.store.listEvents(saved.state.sessionId)
    expect(log.filter((event) => event.type === 'npc-action-committed')).toHaveLength(1)
    expect(log).toHaveLength(5)
  })

  it('T31 loads a hand-written old-format save with the unchanged snapshot key set', () => {
    const loaded = loadSaveGame(handwrittenOldSave())
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(Object.keys(loaded.saveGame.snapshot).sort()).toEqual([
      'currentRoomId',
      'inventory',
      'player',
      'revision',
      'roomStates',
      'schemaVersion',
      'sessionId',
      'updatedAt',
      'worldId',
    ])
  })

  it('T32 saves an old session without changing the top-level snapshot shape', async () => {
    const value = harness()
    const state = await start(value)
    const saved = await value.saves.saveSession(state.sessionId)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const document = JSON.parse(saved.json) as { snapshot: Record<string, unknown> }
    expect(Object.keys(document.snapshot).sort()).toEqual([
      'currentRoomId',
      'inventory',
      'player',
      'revision',
      'roomStates',
      'schemaVersion',
      'sessionId',
      'updatedAt',
      'worldId',
    ])
  })

  it('T33 rejects an NPC action flag with no matching event', () => {
    const document = JSON.parse(handwrittenOldSave()) as {
      snapshot: { roomStates: Record<string, { visited: boolean; flags?: Record<string, boolean> }> }
    }
    document.snapshot.roomStates['throne-room']!.flags = {
      'npc-action:herald-asha:bar-exit:north-door': true,
    }
    const loaded = loadSaveGame(JSON.stringify(document))
    expect(loaded.ok).toBe(false)
    if (!loaded.ok) expect(loaded.error.code).toBe('integrity-mismatch')
  })
})
