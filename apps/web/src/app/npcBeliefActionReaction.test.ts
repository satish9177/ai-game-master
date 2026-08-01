import { describe, expect, it, vi } from 'vitest'
import { throneRoom } from '../domain/examples/throneRoom'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { projectWorldState } from '../domain/world/applyEvent'
import { WorldEventSchema, type WorldEvent } from '../domain/world/events'
import type { Logger, LogContext } from '../platform/logger/Logger'
import type { AppendEventResult, EventLogResult } from '../world-session/WorldSession'
import {
  readBeliefGatedNpcActionEnabled,
  runBeliefGatedNpcActionReaction,
} from './npcBeliefActionReaction'

const SESSION_ID = '10000000-0000-4000-8000-000000000000'
const WORLD_ID = '20000000-0000-4000-8000-000000000000'
const room = loadRoomSpec(throneRoom)

function event(seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `30000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    seq,
    occurredAt: `2026-07-22T00:00:${String(seq).padStart(2, '0')}.000Z`,
    type,
    payload,
  })
}

function fourEventLog(itemId = 'gold-coin'): WorldEvent[] {
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
      roomId: 'throne-room', flags: { 'interaction:offering-coffer': true },
    }),
  ]
}

function committedEvent(log: readonly WorldEvent[]): WorldEvent {
  return event(5, 'npc-action-committed', {
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
    supportingEventIds: [log[2]!.eventId],
  })
}

function loggerHarness() {
  const errors: [string, LogContext | undefined][] = []
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message, context) => { errors.push([message, context]) },
    child: () => logger,
  }
  return { logger, errors }
}

function fakeSession(log = fourEventLog()) {
  const getEventLog = vi.fn<(sessionId: string) => Promise<EventLogResult>>()
    .mockImplementation(async () => ({ ok: true, events: [...log] }))
  const commitNpcAction = vi.fn<(...args: Parameters<never>) => Promise<AppendEventResult>>()
  return { getEventLog, commitNpcAction }
}

describe('belief-gated NPC action reaction', () => {
  it('reads the feature flag only for the exact true string', () => {
    expect(readBeliefGatedNpcActionEnabled({ VITE_BELIEF_GATED_NPC_ACTION: 'true' })).toBe(true)
    for (const value of [undefined, 'false', '1', ' TRUE ']) {
      expect(readBeliefGatedNpcActionEnabled({ VITE_BELIEF_GATED_NPC_ACTION: value })).toBe(false)
    }
  })

  it('T34 does nothing when disabled', async () => {
    const session = fakeSession()
    const { logger } = loggerHarness()
    expect(await runBeliefGatedNpcActionReaction({
      enabled: false,
      sessionId: SESSION_ID,
      room,
      state: projectWorldState(fourEventLog()),
      session: session as never,
      logger,
    })).toBeNull()
    expect(session.getEventLog).not.toHaveBeenCalled()
    expect(session.commitNpcAction).not.toHaveBeenCalled()
  })

  it('refuses an unbound room without reading the event log or committing', async () => {
    const session = fakeSession()
    const { logger } = loggerHarness()
    expect(await runBeliefGatedNpcActionReaction({
      enabled: true,
      sessionId: SESSION_ID,
      room: { ...room, id: 'generated-room' },
      state: projectWorldState(fourEventLog()),
      session: session as never,
      logger,
    })).toEqual({ status: 'refused', reason: 'no-binding' })
    expect(session.getEventLog).not.toHaveBeenCalled()
    expect(session.commitNpcAction).not.toHaveBeenCalled()
  })

  it('T35 commits one action event when enabled and qualified', async () => {
    const log = fourEventLog()
    const action = committedEvent(log)
    const state = projectWorldState(log)
    const next = projectWorldState([...log, action])
    const session = fakeSession(log)
    session.commitNpcAction.mockResolvedValue({ ok: true, state: next, event: action })
    const { logger } = loggerHarness()
    const result = await runBeliefGatedNpcActionReaction({
      enabled: true, sessionId: SESSION_ID, room, state, session: session as never, logger,
    })
    expect(result).toEqual({ status: 'committed', state: next, event: action })
    expect(session.commitNpcAction).toHaveBeenCalledTimes(1)
  })

  it('T36 refuses a second pass and creates no seq 6', async () => {
    const log = fourEventLog()
    log.push(committedEvent(log))
    const session = fakeSession(log)
    const { logger } = loggerHarness()
    const result = await runBeliefGatedNpcActionReaction({
      enabled: true,
      sessionId: SESSION_ID,
      room,
      state: projectWorldState(log),
      session: session as never,
      logger,
    })
    expect(result).toEqual({ status: 'refused', reason: 'already-acted' })
    expect(session.commitNpcAction).not.toHaveBeenCalled()
    expect(log).toHaveLength(5)
  })

  it('T37 does not touch dialogue, memory, or fetch', async () => {
    const log = fourEventLog('royal-writ')
    const session = fakeSession(log)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not call'))
    const forbidden = { dialogue: vi.fn(() => { throw new Error('dialogue') }), memory: vi.fn(() => { throw new Error('memory') }) }
    const { logger } = loggerHarness()
    await runBeliefGatedNpcActionReaction({
      enabled: true,
      sessionId: SESSION_ID,
      room,
      state: projectWorldState(log),
      session: session as never,
      logger,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(forbidden.dialogue).not.toHaveBeenCalled()
    expect(forbidden.memory).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('T38 maps a typed conflict without throwing', async () => {
    const log = fourEventLog()
    const session = fakeSession(log)
    session.commitNpcAction.mockResolvedValue({
      ok: false,
      error: { code: 'conflict', message: 'conflict' },
    })
    const { logger } = loggerHarness()
    await expect(runBeliefGatedNpcActionReaction({
      enabled: true,
      sessionId: SESSION_ID,
      room,
      state: projectWorldState(log),
      session: session as never,
      logger,
    })).resolves.toEqual({ status: 'failed', reason: 'conflict' })
  })

  it('T38a maps a thrown event-log read to unexpected without committing', async () => {
    const session = fakeSession()
    session.getEventLog.mockRejectedValue(new Error('read marker'))
    const { logger } = loggerHarness()
    await expect(runBeliefGatedNpcActionReaction({
      enabled: true,
      sessionId: SESSION_ID,
      room,
      state: projectWorldState(fourEventLog()),
      session: session as never,
      logger,
    })).resolves.toEqual({ status: 'failed', reason: 'unexpected' })
    expect(session.commitNpcAction).not.toHaveBeenCalled()
  })

  it('T38b maps a rejected commit to unexpected, distinct from validation refusal', async () => {
    const log = fourEventLog()
    const session = fakeSession(log)
    session.commitNpcAction.mockRejectedValue(new Error('commit marker'))
    const { logger } = loggerHarness()
    await expect(runBeliefGatedNpcActionReaction({
      enabled: true,
      sessionId: SESSION_ID,
      room,
      state: projectWorldState(log),
      session: session as never,
      logger,
    })).resolves.toEqual({ status: 'failed', reason: 'unexpected' })
  })

  it('T38c logs only sanitized fixed context on an exception', async () => {
    const marker = 'NPC_ROOM_ITEM_EXCEPTION_MARKER'
    const session = fakeSession()
    session.getEventLog.mockRejectedValue(new Error(marker))
    const { logger, errors } = loggerHarness()
    await runBeliefGatedNpcActionReaction({
      enabled: true,
      sessionId: SESSION_ID,
      room,
      state: projectWorldState(fourEventLog()),
      session: session as never,
      logger,
    })
    expect(errors).toEqual([[
      'npc action reaction failed',
      { sessionId: SESSION_ID, reason: 'unexpected' },
    ]])
    expect(JSON.stringify(errors)).not.toContain(marker)
  })

  it('T39 commits nothing on a planner refusal', async () => {
    const log = fourEventLog('royal-writ')
    const session = fakeSession(log)
    const { logger } = loggerHarness()
    expect(await runBeliefGatedNpcActionReaction({
      enabled: true,
      sessionId: SESSION_ID,
      room,
      state: projectWorldState(log),
      session: session as never,
      logger,
    })).toEqual({ status: 'refused', reason: 'no-qualifying-observation' })
    expect(session.commitNpcAction).not.toHaveBeenCalled()
  })
})
