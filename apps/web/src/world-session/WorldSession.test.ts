import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { Logger, LogContext, LogLevel } from '../platform/logger/Logger'
import { projectWorldState } from '../domain/world/applyEvent'
import { InMemoryWorldStore } from './InMemoryWorldStore'
import { WorldSession } from './WorldSession'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const MISSING_ID = '00000000-0000-4000-8000-000000000099'
const canon = {
  schemaVersion: 1,
  worldId: WORLD_ID,
  name: 'SECRET CANON NAME',
  startingRoomId: 'gatehouse',
  initialPlayer: {
    health: { current: 8, max: 10 },
    status: [],
    inventory: [{ itemId: 'water', name: 'SECRET ITEM NAME', quantity: 2 }],
  },
}

function createHarness(ids?: string[]) {
  const store = new InMemoryWorldStore()
  let counter = 2
  const idGenerator: IdGenerator = {
    newId: () => ids?.shift() ?? `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`,
  }
  let tick = 0
  const clock: Clock = {
    now: () => `2026-06-22T10:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  const entries: LogEntry[] = []
  const buildLogger = (bindings: LogContext): Logger => {
    const record = (level: LogLevel) => (message: string, context: LogContext = {}) => {
      entries.push({ level, message, context: { ...bindings, ...context } })
    }
    return {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      child: (childBindings) => buildLogger({ ...bindings, ...childBindings }),
    }
  }
  const logger = buildLogger({})
  return {
    store,
    entries,
    logger,
    session: new WorldSession(store, clock, idGenerator, logger),
  }
}

async function start(harness: ReturnType<typeof createHarness>) {
  const result = await harness.session.startSession(canon)
  if (!result.ok) throw new Error(`start failed: ${result.error.code}`)
  return result.state
}

describe('WorldSession', () => {
  it('starts a session with a projected session-started event', async () => {
    const harness = createHarness()
    const state = await start(harness)
    const log = await harness.store.listEvents(state.sessionId)

    expect(log).toHaveLength(1)
    expect(log[0]?.type).toBe('session-started')
    expect(state).toEqual(projectWorldState(log))
    expect(state.currentRoomId).toBe('gatehouse')
    expect(state.roomStates).toEqual({ gatehouse: { visited: true } })
  })

  it('maps invalid canon and a duplicate session id to typed failures', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000010'
    const harness = createHarness([
      sessionId,
      '00000000-0000-4000-8000-000000000011',
      sessionId,
      '00000000-0000-4000-8000-000000000012',
    ])
    expect((await harness.session.startSession({ ...canon, worldId: 'bad' })).ok).toBe(false)
    expect((await harness.session.startSession(canon)).ok).toBe(true)
    const duplicate = await harness.session.startSession(canon)
    expect(duplicate).toEqual({
      ok: false,
      error: { code: 'already-exists', message: 'World session already exists.' },
    })
  })

  it('funnels command builders through append/project and keeps projection consistent', async () => {
    const harness = createHarness()
    let state = await start(harness)
    const operations = [
      () => harness.session.move(state.sessionId, 'yard', state.revision, 'gatehouse'),
      () => harness.session.addItem(
        state.sessionId,
        { itemId: 'key', name: 'Iron Key', quantity: 1 },
        state.revision,
      ),
      () => harness.session.removeItem(state.sessionId, 'water', 1, state.revision),
      () => harness.session.changeHealth(state.sessionId, -3, state.revision, 'SECRET REASON'),
      () => harness.session.setStatus(state.sessionId, 'wounded', state.revision),
      () => harness.session.clearStatus(state.sessionId, 'wounded', state.revision),
      () => harness.session.setRoomState(
        state.sessionId,
        'yard',
        { flags: { gateOpen: true } },
        state.revision,
      ),
    ]
    for (const operation of operations) {
      const result = await operation()
      if (!result.ok) throw new Error(`append failed: ${result.error.code}`)
      state = result.state
      expect(result.event.seq).toBe(state.revision)
    }

    const log = await harness.store.listEvents(state.sessionId)
    expect(log.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(projectWorldState(log)).toEqual(state)
    expect(state.inventory).toEqual([
      { itemId: 'water', name: 'SECRET ITEM NAME', quantity: 1 },
      { itemId: 'key', name: 'Iron Key', quantity: 1 },
    ])
  })

  it('rejects stale revisions and invalid removals before appending', async () => {
    const harness = createHarness()
    const state = await start(harness)
    const conflict = await harness.session.changeHealth(state.sessionId, -1, 0)
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.error.code).toBe('conflict')

    const invalid = await harness.session.removeItem(state.sessionId, 'water', 3, state.revision)
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.code).toBe('invalid-command')
    expect(await harness.store.listEvents(state.sessionId)).toHaveLength(1)
  })

  it('returns typed reads, not-found results, and sinceSeq slices', async () => {
    const harness = createHarness()
    const state = await start(harness)
    await harness.session.changeHealth(state.sessionId, -1, state.revision)

    const read = await harness.session.getWorldState(state.sessionId)
    expect(read.ok && read.state.revision).toBe(2)
    const events = await harness.session.getEventLog(state.sessionId, { sinceSeq: 1 })
    expect(events.ok && events.events.map((entry) => entry.seq)).toEqual([2])
    const missingState = await harness.session.getWorldState(MISSING_ID)
    const missingLog = await harness.session.getEventLog(MISSING_ID)
    expect(!missingState.ok && missingState.error.code).toBe('not-found')
    expect(!missingLog.ok && missingLog.error.code).toBe('not-found')
  })

  it('exposes no event mutation methods and protects stored values with copies', async () => {
    const harness = createHarness()
    const state = await start(harness)
    expect('updateEvent' in harness.store).toBe(false)
    expect('deleteEvent' in harness.store).toBe(false)
    expect('replaceEvent' in harness.store).toBe(false)

    const firstRead = await harness.store.listEvents(state.sessionId)
    if (firstRead[0]?.type === 'session-started') firstRead[0].payload.seed.name = 'tampered'
    const secondRead = await harness.store.listEvents(state.sessionId)
    expect(secondRead[0]?.type === 'session-started' && secondRead[0].payload.seed.name)
      .toBe('SECRET CANON NAME')
  })

  it('logs only safe ids, counts, revisions, and codes—not narrative payload text', async () => {
    const harness = createHarness()
    const state = await start(harness)
    await harness.session.changeHealth(state.sessionId, -1, state.revision, 'SECRET REASON')
    const serializedLogs = JSON.stringify(harness.entries)
    expect(serializedLogs).not.toContain('SECRET CANON NAME')
    expect(serializedLogs).not.toContain('SECRET ITEM NAME')
    expect(serializedLogs).not.toContain('SECRET REASON')
  })
})
