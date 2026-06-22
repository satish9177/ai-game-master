import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { Logger, LogContext, LogLevel } from '../platform/logger/Logger'
import { InMemoryWorldStore } from './InMemoryWorldStore'
import { WorldSession } from './WorldSession'
import { loadSaveGame, SaveGameService } from './saveGame'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const MISSING_ID = '00000000-0000-4000-8000-000000000099'
const canon = {
  schemaVersion: 1,
  worldId: WORLD_ID,
  name: 'SECRET WORLD BIBLE',
  startingRoomId: 'gatehouse',
  initialPlayer: {
    health: { current: 8, max: 10 },
    status: [],
    inventory: [{ itemId: 'water', name: 'SECRET WATER NAME', quantity: 2 }],
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
    session: new WorldSession(store, clock, idGenerator, logger),
    saves: new SaveGameService(store, logger),
  }
}

async function makeSave() {
  const harness = createHarness()
  const started = await harness.session.startSession(canon)
  if (!started.ok) throw new Error('session start failed')
  const changed = await harness.session.changeHealth(
    started.state.sessionId,
    -2,
    started.state.revision,
    'SECRET SAVE REASON',
  )
  if (!changed.ok) throw new Error('event append failed')
  const saved = await harness.saves.saveSession(started.state.sessionId)
  if (!saved.ok) throw new Error('save failed')
  return { harness, state: changed.state, json: saved.json }
}

describe('SaveGame boundary', () => {
  it('round-trips seed, authoritative log, and reconstructable snapshot', async () => {
    const saved = await makeSave()
    const loadedDocument = loadSaveGame(saved.json)
    expect(loadedDocument.ok).toBe(true)
    if (loadedDocument.ok) {
      expect(loadedDocument.saveGame.snapshot).toEqual(saved.state)
      expect(loadedDocument.saveGame.log).toHaveLength(2)
      expect(loadedDocument.saveGame.seed).toEqual(
        loadedDocument.saveGame.log[0]?.type === 'session-started'
          ? loadedDocument.saveGame.log[0].payload.seed
          : undefined,
      )
    }

    const restoredHarness = createHarness()
    const restored = await restoredHarness.saves.loadSession(saved.json)
    expect(restored).toEqual({ ok: true, sessionId: saved.state.sessionId })
    const restoredSnapshot = await restoredHarness.store.getSnapshot(saved.state.sessionId)
    const restoredLog = await restoredHarness.store.listEvents(saved.state.sessionId)
    expect(restoredSnapshot).toEqual(saved.state)
    expect(restoredLog).toHaveLength(2)
  })

  it('maps invalid JSON, invalid schema, and unsupported versions distinctly', () => {
    expect(loadSaveGame('{broken')).toEqual({
      ok: false,
      error: { code: 'invalid-json', message: 'Save game is not valid JSON.' },
    })
    expect(loadSaveGame(JSON.stringify({ schemaVersion: 1 }))).toEqual({
      ok: false,
      error: {
        code: 'invalid-schema',
        message: 'Save game does not match the current schema.',
      },
    })
    expect(loadSaveGame(JSON.stringify({ schemaVersion: 2 }))).toEqual({
      ok: false,
      error: {
        code: 'unsupported-version',
        message: 'Save game schema version is not supported.',
      },
    })
  })

  it('rejects a tampered snapshot and a top-level seed/log mismatch', async () => {
    const saved = await makeSave()
    const snapshotTamper = JSON.parse(saved.json) as {
      snapshot: { player: { health: { current: number } } }
    }
    snapshotTamper.snapshot.player.health.current += 1
    const snapshotResult = loadSaveGame(JSON.stringify(snapshotTamper))
    expect(!snapshotResult.ok && snapshotResult.error.code).toBe('integrity-mismatch')

    const seedTamper = JSON.parse(saved.json) as { seed: { name: string } }
    seedTamper.seed.name = 'A different valid seed'
    const seedResult = loadSaveGame(JSON.stringify(seedTamper))
    expect(!seedResult.ok && seedResult.error.code).toBe('integrity-mismatch')
  })

  it('rejects malformed log shape before projection', async () => {
    const saved = await makeSave()
    const tampered = JSON.parse(saved.json) as { log: { seq: number }[] }
    tampered.log[1]!.seq = 3
    const result = loadSaveGame(JSON.stringify(tampered))
    expect(!result.ok && result.error.code).toBe('integrity-mismatch')
  })

  it('returns typed not-found and duplicate-restore failures', async () => {
    const harness = createHarness()
    const missing = await harness.saves.saveSession(MISSING_ID)
    expect(!missing.ok && missing.error.code).toBe('not-found')

    const saved = await makeSave()
    expect((await harness.saves.loadSession(saved.json)).ok).toBe(true)
    const duplicate = await harness.saves.loadSession(saved.json)
    expect(!duplicate.ok && duplicate.error.code).toBe('already-exists')
  })

  it('never logs save JSON, canon names, item names, or reason text', async () => {
    const saved = await makeSave()
    const logs = JSON.stringify(saved.harness.entries)
    expect(logs).not.toContain(saved.json)
    expect(logs).not.toContain('SECRET WORLD BIBLE')
    expect(logs).not.toContain('SECRET WATER NAME')
    expect(logs).not.toContain('SECRET SAVE REASON')
  })
})
