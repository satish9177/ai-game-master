import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import { projectWorldState } from '../domain/world/applyEvent'
import type { EncounterSpec } from '../domain/encounters/encounterSpec'
import type { WorldState } from '../domain/world/worldState'
import type { Logger, LogContext, LogLevel } from '../platform/logger/Logger'
import { InMemoryWorldStore } from '../world-session/InMemoryWorldStore'
import { WorldSession } from '../world-session/WorldSession'
import { EncounterService } from './EncounterService'
import type { EncounterSession } from './EncounterService'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

const canon = {
  schemaVersion: 1,
  worldId: '00000000-0000-4000-8000-000000000001',
  name: 'SECRET WORLD NAME',
  startingRoomId: 'throne',
  initialPlayer: {
    health: { current: 50, max: 100 },
    status: [],
    inventory: [{ itemId: 'coin', name: 'SECRET COIN NAME', quantity: 2 }],
  },
}

// A genre-flavoured encounter whose every authored string is a SECRET marker so
// the log-safety test can assert none of it reaches the logger.
const encounter: EncounterSpec = {
  id: 'guard',
  title: 'SECRET TITLE TEXT',
  description: 'SECRET DESCRIPTION TEXT',
  choices: [
    {
      id: 'fight',
      action: 'fight',
      label: 'SECRET LABEL TEXT',
      outcome: {
        effects: [
          { kind: 'damage', amount: 10 },
          { kind: 'add-status', status: 'SECRET-STATUS' },
          { kind: 'add-item', item: { itemId: 'loot', name: 'SECRET LOOT NAME', quantity: 1 } },
        ],
        resultText: 'SECRET RESULT TEXT',
      },
    },
    {
      id: 'bribe',
      action: 'negotiate',
      label: 'SECRET BRIBE LABEL',
      requires: { itemId: 'silver', quantity: 1 },
      outcome: { effects: [{ kind: 'remove-item', itemId: 'silver', quantity: 1 }] },
    },
  ],
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
  return { store, session, entries, logger, service: new EncounterService(session, logger) }
}

async function start(harness: ReturnType<typeof createHarness>): Promise<WorldState> {
  const result = await harness.session.startSession(canon)
  if (!result.ok) throw new Error(`start failed: ${result.error.code}`)
  return result.state
}

describe('EncounterService', () => {
  it('applies a multi-effect outcome, threading revision and preserving projection integrity', async () => {
    const harness = createHarness()
    const initial = await start(harness)
    const result = await harness.service.resolve({
      sessionId: initial.sessionId,
      encounter,
      choiceId: 'fight',
      ref: undefined,
    })
    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.outcome).toEqual({ kind: 'resolved', action: 'fight', choiceId: 'fight' })

    const log = await harness.store.listEvents(initial.sessionId)
    const snapshot = await harness.store.getSnapshot(initial.sessionId)
    expect(log.map((event) => event.type)).toEqual([
      'session-started',
      'health-changed',
      'status-changed',
      'item-added',
      'room-state-changed',
    ])
    // 4 commands appended on top of session-started.
    expect(result.state.revision).toBe(5)
    expect(result.state.player.health.current).toBe(40)
    expect(result.state.player.status).toContain('SECRET-STATUS')
    expect(result.state.roomStates.throne?.flags?.['encounter:guard']).toBe(true)
    expect(projectWorldState(log)).toEqual(snapshot)
  })

  it('returns already-resolved on re-trigger and appends nothing more', async () => {
    const harness = createHarness()
    const initial = await start(harness)
    const input = { sessionId: initial.sessionId, encounter, choiceId: 'fight', ref: undefined }
    const first = await harness.service.resolve(input)
    expect(first.status).toBe('applied')

    const second = await harness.service.resolve(input)
    expect(second.status).toBe('already-resolved')
    if (second.status === 'already-resolved') {
      expect(second.outcome).toEqual({ kind: 'nothing' })
    }
    // session-started + the 4 commands from the first resolve only.
    expect(await harness.store.listEvents(initial.sessionId)).toHaveLength(5)
  })

  it('rejects a gated choice without the required item and appends nothing', async () => {
    const harness = createHarness()
    const initial = await start(harness)
    const result = await harness.service.resolve({
      sessionId: initial.sessionId,
      encounter,
      choiceId: 'bribe',
      ref: undefined,
    })
    expect(result).toEqual({ status: 'rejected', reason: 'insufficient-item' })
    expect(await harness.store.listEvents(initial.sessionId)).toHaveLength(1)
  })

  it('rejects a missing encounter before reading state', async () => {
    const harness = createHarness()
    const initial = await start(harness)
    const result = await harness.service.resolve({
      sessionId: initial.sessionId,
      encounter: undefined,
      choiceId: 'fight',
      ref: 'guard',
    })
    expect(result).toEqual({ status: 'rejected', reason: 'missing-encounter' })
    expect(await harness.store.listEvents(initial.sessionId)).toHaveLength(1)
  })

  it('returns not-found for a missing session', async () => {
    const harness = createHarness()
    const result = await harness.service.resolve({
      sessionId: '00000000-0000-4000-8000-000000000099',
      encounter,
      choiceId: 'fight',
      ref: undefined,
    })
    expect(result).toEqual({ status: 'failed', reason: 'not-found' })
  })

  it('maps a stale revision (first append conflict) to a typed failure', async () => {
    const harness = createHarness()
    const state = await start(harness)
    const conflictSession: EncounterSession = {
      getWorldState: () => Promise.resolve({ ok: true, state }),
      appendEvent: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'conflict', message: 'stale' },
        }),
    }
    const service = new EncounterService(conflictSession, harness.logger)
    expect(
      await service.resolve({ sessionId: state.sessionId, encounter, choiceId: 'fight', ref: undefined }),
    ).toEqual({ status: 'failed', reason: 'conflict' })
  })

  it('logs only safe ids, counts, actions, statuses, and reason codes', async () => {
    const harness = createHarness()
    const initial = await start(harness)
    await harness.service.resolve({
      sessionId: initial.sessionId,
      encounter,
      choiceId: 'fight',
      ref: undefined,
    })
    const logs = JSON.stringify(harness.entries)
    expect(logs).not.toContain('SECRET DESCRIPTION TEXT')
    expect(logs).not.toContain('SECRET TITLE TEXT')
    expect(logs).not.toContain('SECRET LABEL TEXT')
    expect(logs).not.toContain('SECRET RESULT TEXT')
    expect(logs).not.toContain('SECRET-STATUS')
    expect(logs).not.toContain('SECRET LOOT NAME')
    expect(logs).not.toContain('SECRET WORLD NAME')
    expect(logs).not.toContain('SECRET COIN NAME')
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
