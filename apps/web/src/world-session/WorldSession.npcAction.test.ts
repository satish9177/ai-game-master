import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import { throneRoom } from '../domain/examples/throneRoom'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { projectWorldState } from '../domain/world/applyEvent'
import type { Logger } from '../platform/logger/Logger'
import { runBeliefGatedNpcActionReaction } from '../app/npcBeliefActionReaction'
import { InMemoryWorldStore } from './InMemoryWorldStore'
import { WorldSession } from './WorldSession'
import { loadSaveGame, SaveGameService } from './saveGame'

const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
}

const room = loadRoomSpec(throneRoom)
const command = {
  schemaVersion: 1 as const,
  type: 'npc-action-committed' as const,
  npcId: 'herald-asha',
  roomId: 'throne-room',
  action: 'bar-exit' as const,
  targetObjectId: 'north-door',
}

function harness() {
  const store = new InMemoryWorldStore()
  let id = 1
  const ids: IdGenerator = {
    newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  let tick = 0
  const clock: Clock = {
    now: () => `2026-07-20T00:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  return { store, session: new WorldSession(store, clock, ids, noopLogger) }
}

async function prepare(value: ReturnType<typeof harness>, itemId = 'gold-coin') {
  const started = await value.session.startSession({
    schemaVersion: 1,
    worldId: '10000000-0000-4000-8000-000000000000',
    name: 'Test world',
    startingRoomId: 'throne-room',
    initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
  })
  if (!started.ok) throw new Error(started.error.code)
  const added = await value.session.addItem(
    started.state.sessionId,
    { itemId, name: 'Item', quantity: 1 },
    started.state.revision,
  )
  if (!added.ok) throw new Error(added.error.code)
  const discovered = await value.session.appendEvent(
    started.state.sessionId,
    { schemaVersion: 1, type: 'item-discovered', roomId: 'throne-room', itemId },
    added.state.revision,
  )
  if (!discovered.ok) throw new Error(discovered.error.code)
  const flagged = await value.session.setRoomState(
    started.state.sessionId,
    'throne-room',
    { flags: { 'interaction:offering-coffer': true } },
    discovered.state.revision,
  )
  if (!flagged.ok) throw new Error(flagged.error.code)
  return { state: flagged.state, discoveryEventId: discovered.event.eventId }
}

describe('WorldSession NPC action command', () => {
  it('returns not-found for an unknown session without appending an event', async () => {
    const value = harness()
    const sessionId = '90000000-0000-4000-8000-000000000000'
    const result = await value.session.commitNpcAction(
      sessionId,
      command,
      1,
      { room },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not-found')
    expect(await value.store.listEvents(sessionId)).toEqual([])
  })

  it('T22 rejects the command through the generic appendEvent path', async () => {
    const value = harness()
    const prepared = await prepare(value)
    const result = await value.session.appendEvent(
      prepared.state.sessionId,
      command,
      prepared.state.revision,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-command')
    expect(await value.store.listEvents(prepared.state.sessionId)).toHaveLength(4)
  })

  it('T23 commits the exact golden seq-5 event', async () => {
    const value = harness()
    const prepared = await prepare(value)
    const result = await value.session.commitNpcAction(
      prepared.state.sessionId,
      command,
      prepared.state.revision,
      { room },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.event).toEqual({
      schemaVersion: 1,
      eventId: '00000000-0000-4000-8000-000000000006',
      sessionId: '00000000-0000-4000-8000-000000000001',
      seq: 5,
      occurredAt: '2026-07-20T00:00:04.000Z',
      type: 'npc-action-committed',
      payload: {
        npcId: 'herald-asha',
        roomId: 'throne-room',
        action: 'bar-exit',
        targetObjectId: 'north-door',
        ruleId: 'belief-gated-npc-action/bar-exit-on-witnessed-take@1',
        belief: {
          predicate: 'player-took-item',
          itemId: 'gold-coin',
          roomId: 'throne-room',
          confidence: 'high',
        },
        supportingEventIds: [prepared.discoveryEventId],
      },
    })
    expect(result.state.roomStates['throne-room']?.flags).toEqual({
      'interaction:offering-coffer': true,
      'npc-action:herald-asha:bar-exit:north-door': true,
    })
  })

  it('T24 rejects when the trusted room context lacks the NPC', async () => {
    const value = harness()
    const prepared = await prepare(value)
    const withoutNpc = {
      ...room,
      objects: room.objects.filter((object) => object.id !== 'herald-asha'),
    }
    const result = await value.session.commitNpcAction(
      prepared.state.sessionId,
      command,
      prepared.state.revision,
      { room: withoutNpc },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-command')
  })

  it('T25 rejects a trusted target without interaction.exit', async () => {
    const value = harness()
    const prepared = await prepare(value)
    const withoutExit = loadRoomSpec({
      ...throneRoom,
      objects: throneRoom.objects.map((object) => {
        if (!('id' in object) || object.id !== 'north-door' || !('interaction' in object)) return object
        const interaction = { ...object.interaction, exit: undefined }
        return { ...object, interaction }
      }),
    })
    const result = await value.session.commitNpcAction(
      prepared.state.sessionId,
      command,
      prepared.state.revision,
      { room: withoutExit },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-command')
  })

  it('T26a rejects command room mismatch when context matches the command', async () => {
    const value = harness()
    const prepared = await prepare(value)
    const result = await value.session.commitNpcAction(
      prepared.state.sessionId,
      { ...command, roomId: 'ruined-safehouse' },
      prepared.state.revision,
      { room: { ...room, id: 'ruined-safehouse' } },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-command')
  })

  it('T26b rejects trusted context room mismatch when the command matches current state', async () => {
    const value = harness()
    const prepared = await prepare(value)
    const result = await value.session.commitNpcAction(
      prepared.state.sessionId,
      command,
      prepared.state.revision,
      { room: { ...room, id: 'ruined-safehouse' } },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-command')
  })

  it('T27 rejects a stale expected revision as conflict', async () => {
    const value = harness()
    const prepared = await prepare(value)
    const result = await value.session.commitNpcAction(
      prepared.state.sessionId,
      command,
      prepared.state.revision - 1,
      { room },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('conflict')
  })

  it('T28 rejects caller-supplied belief and rule provenance', async () => {
    const value = harness()
    const prepared = await prepare(value)
    const result = await value.session.commitNpcAction(
      prepared.state.sessionId,
      { ...command, belief: { confidence: 'high' }, ruleId: 'caller-rule' },
      prepared.state.revision,
      { room },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-command')
  })

  it('T29 rejects when the store log has no scoped observation', async () => {
    const value = harness()
    const prepared = await prepare(value, 'royal-writ')
    const result = await value.session.commitNpcAction(
      prepared.state.sessionId,
      command,
      prepared.state.revision,
      { room },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-command')
    expect(await value.store.listEvents(prepared.state.sessionId)).toHaveLength(4)
  })

  it('refuses a repeated NPC action at the session boundary with the current revision', async () => {
    const value = harness()
    const prepared = await prepare(value)
    const first = await value.session.commitNpcAction(
      prepared.state.sessionId,
      command,
      prepared.state.revision,
      { room },
    )
    if (!first.ok) throw new Error(first.error.code)

    const repeated = await value.session.commitNpcAction(
      prepared.state.sessionId,
      command,
      first.state.revision,
      { room },
    )
    expect(repeated.ok).toBe(false)
    if (!repeated.ok) expect(repeated.error.code).toBe('invalid-command')
    expect(await value.store.listEvents(prepared.state.sessionId)).toHaveLength(5)
  })

  it('feature flag off leaves NPC action projection and save integrity unchanged', async () => {
    const value = harness()
    const prepared = await prepare(value)
    const committed = await value.session.commitNpcAction(
      prepared.state.sessionId,
      command,
      prepared.state.revision,
      { room },
    )
    if (!committed.ok) throw new Error(committed.error.code)
    const before = await value.store.listEvents(prepared.state.sessionId)

    expect(await runBeliefGatedNpcActionReaction({
      enabled: false,
      sessionId: prepared.state.sessionId,
      room,
      state: committed.state,
      session: value.session,
      logger: noopLogger,
    })).toBeNull()

    const after = await value.store.listEvents(prepared.state.sessionId)
    expect(after).toEqual(before)
    expect(projectWorldState(after)).toEqual(committed.state)
    const saved = await new SaveGameService(value.store, noopLogger)
      .saveSession(prepared.state.sessionId)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const loaded = loadSaveGame(saved.json)
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.saveGame.snapshot).toEqual(committed.state)
  })
})
