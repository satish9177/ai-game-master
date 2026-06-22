import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import { projectWorldState } from '../domain/world/applyEvent'
import { WorldEventSchema } from '../domain/world/events'
import type { WorldState } from '../domain/world/worldState'
import type { Logger, LogContext, LogLevel } from '../platform/logger/Logger'
import { InMemoryWorldStore } from '../world-session/InMemoryWorldStore'
import { WorldSession } from '../world-session/WorldSession'
import { InteractionService } from './InteractionService'
import type { InteractionSession } from './InteractionService'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

const canon = {
  schemaVersion: 1,
  worldId: '00000000-0000-4000-8000-000000000001',
  name: 'SECRET WORLD NAME',
  startingRoomId: 'safehouse',
  initialPlayer: {
    health: { current: 50, max: 100 },
    status: [],
    inventory: [{ itemId: 'medkit', name: 'SECRET MEDKIT NAME', quantity: 2 }],
  },
}

function createHarness() {
  const store = new InMemoryWorldStore()
  let id = 2
  const idGenerator: IdGenerator = {
    newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  let tick = 0
  const clock: Clock = {
    now: () => `2026-06-22T10:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  const entries: LogEntry[] = []
  const logger = createSpyLogger(entries)
  const session = new WorldSession(store, clock, idGenerator, logger)
  return {
    store,
    session,
    entries,
    logger,
    service: new InteractionService(session, logger),
  }
}

async function start(harness: ReturnType<typeof createHarness>): Promise<WorldState> {
  const result = await harness.session.startSession(canon)
  if (!result.ok) throw new Error(`start failed: ${result.error.code}`)
  return result.state
}

describe('InteractionService', () => {
  it('applies inspect once and returns already-resolved without a second append', async () => {
    const harness = createHarness()
    const initial = await start(harness)
    const input = {
      sessionId: initial.sessionId,
      effect: { kind: 'inspect' } as const,
      ref: 'field-note',
    }

    const first = await harness.service.resolve(input)
    expect(first.status).toBe('applied')
    if (first.status === 'applied') {
      expect(first.state.revision).toBe(2)
      expect(first.state.roomStates.safehouse?.flags?.['interaction:field-note']).toBe(true)
    }
    const second = await harness.service.resolve(input)
    expect(second.status).toBe('already-resolved')
    expect(await harness.store.listEvents(initial.sessionId)).toHaveLength(2)
  })

  it('threads take-item through two existing events and preserves projection integrity', async () => {
    const harness = createHarness()
    const initial = await start(harness)
    const result = await harness.service.resolve({
      sessionId: initial.sessionId,
      effect: {
        kind: 'take-item',
        item: { itemId: 'bandage', name: 'SECRET BANDAGE NAME', quantity: 2 },
      },
      ref: 'medical-crate',
    })
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return

    const log = await harness.store.listEvents(initial.sessionId)
    const snapshot = await harness.store.getSnapshot(initial.sessionId)
    expect(log.map((event) => event.type)).toEqual([
      'session-started',
      'item-added',
      'room-state-changed',
    ])
    expect(result.state.revision).toBe(3)
    expect(result.state.inventory).toContainEqual({
      itemId: 'bandage',
      name: 'SECRET BANDAGE NAME',
      quantity: 2,
    })
    expect(projectWorldState(log)).toEqual(snapshot)

    const repeated = await harness.service.resolve({
      sessionId: initial.sessionId,
      effect: {
        kind: 'take-item',
        item: { itemId: 'bandage', name: 'SECRET BANDAGE NAME', quantity: 2 },
      },
      ref: 'medical-crate',
    })
    expect(repeated.status).toBe('already-resolved')
    expect(await harness.store.listEvents(initial.sessionId).then((events) => events.length)).toBe(3)
  })

  it('composes use-item from item removal followed by an optional health change', async () => {
    const harness = createHarness()
    const initial = await start(harness)
    const result = await harness.service.resolve({
      sessionId: initial.sessionId,
      effect: {
        kind: 'use-item',
        itemId: 'medkit',
        quantity: 1,
        health: { delta: 25 },
      },
      ref: undefined,
    })
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.state.inventory[0]?.quantity).toBe(1)
    expect(result.state.player.health.current).toBe(75)
    expect((await harness.store.listEvents(initial.sessionId)).map((event) => event.type))
      .toEqual(['session-started', 'item-removed', 'health-changed'])
  })

  it('rejects insufficient inventory and missing effects without appending', async () => {
    const harness = createHarness()
    const initial = await start(harness)
    const insufficient = await harness.service.resolve({
      sessionId: initial.sessionId,
      effect: { kind: 'use-item', itemId: 'medkit', quantity: 3 },
      ref: undefined,
    })
    expect(insufficient).toEqual({ status: 'rejected', reason: 'insufficient-item' })
    const missing = await harness.service.resolve({
      sessionId: initial.sessionId,
      effect: undefined,
      ref: 'presentation-only',
    })
    expect(missing).toEqual({ status: 'rejected', reason: 'missing-effect' })
    expect(await harness.store.listEvents(initial.sessionId)).toHaveLength(1)
  })

  it('returns not-found for a missing session', async () => {
    const harness = createHarness()
    const result = await harness.service.resolve({
      sessionId: '00000000-0000-4000-8000-000000000099',
      effect: { kind: 'inspect' },
      ref: 'note',
    })
    expect(result).toEqual({ status: 'failed', reason: 'not-found' })
  })

  it('maps a first append conflict and a later failure to typed failure reasons', async () => {
    const harness = createHarness()
    const state = await start(harness)
    const conflictSession: InteractionSession = {
      getWorldState: () => Promise.resolve({ ok: true, state }),
      appendEvent: () => Promise.resolve({
        ok: false,
        error: {
          code: 'conflict',
          message: 'World session changed before the operation could be committed.',
        },
      }),
    }
    const conflictService = new InteractionService(conflictSession, harness.logger)
    expect(await conflictService.resolve({
      sessionId: state.sessionId,
      effect: { kind: 'inspect' },
      ref: 'note',
    })).toEqual({ status: 'failed', reason: 'conflict' })

    let appendCount = 0
    const partialSession: InteractionSession = {
      getWorldState: () => Promise.resolve({ ok: true, state }),
      appendEvent: (_sessionId, _command, expectedRevision) => {
        appendCount += 1
        if (appendCount > 1) {
          return Promise.resolve({
            ok: false,
            error: {
              code: 'conflict',
              message: 'World session changed before the operation could be committed.',
            },
          })
        }
        const nextState = { ...state, revision: expectedRevision + 1 }
        return Promise.resolve({
          ok: true,
          state: nextState,
          event: WorldEventSchema.parse({
            schemaVersion: 1,
            eventId: '00000000-0000-4000-8000-000000000090',
            sessionId: state.sessionId,
            seq: expectedRevision + 1,
            occurredAt: '2026-06-22T10:00:01.000Z',
            type: 'item-added',
            payload: { item: { itemId: 'key', name: 'Key', quantity: 1 } },
          }),
        })
      },
    }
    const partialService = new InteractionService(partialSession, harness.logger)
    expect(await partialService.resolve({
      sessionId: state.sessionId,
      effect: {
        kind: 'take-item',
        item: { itemId: 'key', name: 'Key', quantity: 1 },
      },
      ref: 'locker',
    })).toEqual({ status: 'failed', reason: 'partial' })
  })

  it('logs only safe ids, counts, kinds, statuses, and reason codes', async () => {
    const harness = createHarness()
    const initial = await start(harness)
    await harness.service.resolve({
      sessionId: initial.sessionId,
      effect: {
        kind: 'take-item',
        item: { itemId: 'secret-item', name: 'SECRET ITEM NAME', quantity: 1 },
      },
      ref: 'secret-crate',
    })
    const logs = JSON.stringify(harness.entries)
    expect(logs).not.toContain('SECRET ITEM NAME')
    expect(logs).not.toContain('SECRET WORLD NAME')
    expect(logs).not.toContain('SECRET MEDKIT NAME')
    expect(logs).not.toContain('SECRET BODY TEXT')
    expect(logs).not.toContain('SECRET TITLE TEXT')
    expect(logs).not.toContain('SECRET REASON TEXT')
  })
})

function createSpyLogger(entries: LogEntry[]): Logger {
  const build = (bindings: LogContext): Logger => {
    const record = (level: LogLevel) => (message: string, context: LogContext = {}) => {
      entries.push({ level, message, context: { ...bindings, ...context } })
    }
    return {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      child: (childBindings) => build({ ...bindings, ...childBindings }),
    }
  }
  return build({})
}
