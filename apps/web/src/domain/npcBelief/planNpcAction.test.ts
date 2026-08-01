import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { throneRoom } from '../examples/throneRoom'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import type { Clock } from '../ports/Clock'
import type { IdGenerator } from '../ports/IdGenerator'
import { projectWorldState } from '../world/applyEvent'
import { WorldEventSchema, type WorldEvent } from '../world/events'
import { InMemoryWorldStore } from '../../world-session/InMemoryWorldStore'
import { WorldSession } from '../../world-session/WorldSession'
import {
  BELIEF_GATED_NPC_ACTION_RULE_ID,
  planBeliefGatedNpcAction,
  type NpcActionRefusalReason,
} from './planNpcAction'

const SESSION_ID = '10000000-0000-4000-8000-000000000000'
const WORLD_ID = '20000000-0000-4000-8000-000000000000'
const room = loadRoomSpec(throneRoom)
const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child() { return this },
}

function realSessionHarness() {
  const store = new InMemoryWorldStore()
  let id = 1
  const ids: IdGenerator = {
    newId: () => `40000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  let tick = 0
  const clock: Clock = {
    now: () => `2026-01-02T00:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  return { store, session: new WorldSession(store, clock, ids, logger) }
}

function event(seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `30000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    seq,
    occurredAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    type,
    payload,
  })
}

function goldenLog(itemId = 'gold-coin'): WorldEvent[] {
  return [
    event(1, 'session-started', {
      seed: {
        schemaVersion: 1,
        worldId: WORLD_ID,
        name: 'Test world',
        startingRoomId: 'throne-room',
        initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
      },
    }),
    event(2, 'item-added', { item: { itemId, name: 'Item', quantity: 1 } }),
    event(3, 'item-discovered', { roomId: 'throne-room', itemId }),
    event(4, 'room-state-changed', {
      roomId: 'throne-room',
      flags: { 'interaction:offering-coffer': true },
    }),
  ]
}

function planned(inputRoom: LoadedRoom = room, log = goldenLog()) {
  return planBeliefGatedNpcAction({ room: inputRoom, state: projectWorldState(log), log })
}

describe('planBeliefGatedNpcAction', () => {
  it('T11 plans the authored command field by field', () => {
    const plan = planned()
    expect(plan.status).toBe('commit')
    if (plan.status !== 'commit') return
    expect(plan.ruleId).toBe(BELIEF_GATED_NPC_ACTION_RULE_ID)
    expect(plan.command).toEqual({
      schemaVersion: 1,
      type: 'npc-action-committed',
      npcId: 'herald-asha',
      roomId: 'throne-room',
      action: 'bar-exit',
      targetObjectId: 'north-door',
    })
  })

  it('T12 refuses a room with no binding', () => {
    expect(planned({ ...room, id: 'ruined-safehouse' })).toEqual({
      status: 'refused', reason: 'no-binding',
    })
  })

  it('T13 refuses when exactly one bound NPC is not present', () => {
    const withoutActor = {
      ...room,
      objects: room.objects.filter((object) => object.id !== 'herald-asha'),
    }
    expect(planned(withoutActor)).toEqual({ status: 'refused', reason: 'actor-not-in-room' })
  })

  it('T14 refuses when the target lacks an exit', () => {
    const withoutExit = loadRoomSpec({
      ...throneRoom,
      objects: throneRoom.objects.map((object) => {
        if (!('id' in object) || object.id !== 'north-door' || !('interaction' in object)) return object
        const interaction = { ...object.interaction, exit: undefined }
        return { ...object, interaction }
      }),
    })
    expect(planned(withoutExit)).toEqual({ status: 'refused', reason: 'target-not-in-room' })
  })

  it('T15 refuses after the same NPC action is already recorded', () => {
    const log = goldenLog()
    log.push(event(5, 'npc-action-committed', {
      npcId: 'herald-asha',
      roomId: 'throne-room',
      action: 'bar-exit',
      targetObjectId: 'north-door',
      ruleId: BELIEF_GATED_NPC_ACTION_RULE_ID,
      belief: {
        predicate: 'player-took-item',
        itemId: 'gold-coin',
        roomId: 'throne-room',
        confidence: 'high',
      },
      supportingEventIds: [log[2]!.eventId],
    }))
    expect(planned(room, log)).toEqual({ status: 'refused', reason: 'already-acted' })
  })

  it('T16 refuses a different item without producing a command', () => {
    const plan = planned(room, goldenLog('royal-writ'))
    expect(plan).toEqual({ status: 'refused', reason: 'no-qualifying-observation' })
    expect('command' in plan).toBe(false)
  })

  it('T17 deterministically re-plans intent from an actual committed seq-5 event', async () => {
    const value = realSessionHarness()
    const started = await value.session.startSession({
      schemaVersion: 1,
      worldId: WORLD_ID,
      name: 'Test world',
      startingRoomId: 'throne-room',
      initialPlayer: { health: { current: 100, max: 100 }, status: [], inventory: [] },
    })
    if (!started.ok) throw new Error(started.error.code)
    const added = await value.session.addItem(
      started.state.sessionId,
      { itemId: 'gold-coin', name: 'Item', quantity: 1 },
      started.state.revision,
    )
    if (!added.ok) throw new Error(added.error.code)
    const discovered = await value.session.appendEvent(
      started.state.sessionId,
      { schemaVersion: 1, type: 'item-discovered', roomId: 'throne-room', itemId: 'gold-coin' },
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
    const committed = await value.session.commitNpcAction(
      started.state.sessionId,
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

    const authoritativeLog = await value.store.listEvents(started.state.sessionId)
    expect(authoritativeLog).toHaveLength(5)
    const recorded = authoritativeLog.find(
      (candidate) => candidate.seq === 5 && candidate.type === 'npc-action-committed',
    )
    expect(recorded).toBeDefined()
    if (recorded?.type !== 'npc-action-committed') return

    const prefix = authoritativeLog.filter((candidate) => candidate.seq <= 4)
    const plan = planBeliefGatedNpcAction({
      room,
      state: projectWorldState(prefix),
      log: prefix,
    })
    expect(plan.status).toBe('commit')
    if (plan.status !== 'commit') return
    const recordedIntent = {
      schemaVersion: recorded.schemaVersion,
      type: recorded.type,
      npcId: recorded.payload.npcId,
      roomId: recorded.payload.roomId,
      action: recorded.payload.action,
      targetObjectId: recorded.payload.targetObjectId,
    }
    expect(plan.command).toEqual(recordedIntent)
  })

  it('keeps the refusal vocabulary at exactly five members', () => {
    const reasons: NpcActionRefusalReason[] = [
      'no-binding',
      'actor-not-in-room',
      'target-not-in-room',
      'already-acted',
      'no-qualifying-observation',
    ]
    expect(reasons).toHaveLength(5)
    const source = readFileSync(new URL('./planNpcAction.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/confidence-below-threshold/)
  })
})
