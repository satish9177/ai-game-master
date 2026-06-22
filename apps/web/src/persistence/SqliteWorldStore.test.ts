import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { applyEvent, projectWorldState } from '../domain/world/applyEvent'
import { WorldEventSchema } from '../domain/world/events'
import type { WorldEvent } from '../domain/world/events'
import type { WorldState } from '../domain/world/worldState'
import { open } from './db'
import { SqliteWorldStore } from './SqliteWorldStore'
import {
  createCapturingLogger,
  createMemoryDb,
  createTempFileDb,
  silentLogger,
} from './testing/createTestDb'
import {
  healthChangedEvent,
  runWorldStoreContract,
  seedSession,
  sessionStartedEvent,
} from './testing/worldStoreContract'

// The shared port contract, run against the real SQLite adapter.
runWorldStoreContract(() => {
  const { db, close } = createMemoryDb()
  return { store: new SqliteWorldStore(db, silentLogger()), cleanup: close }
})

function commitEvent(
  store: SqliteWorldStore,
  sessionId: string,
  previous: WorldState,
  raw: Record<string, unknown>,
  seq = previous.revision + 1,
) {
  const event = WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: randomUUID(),
    sessionId,
    seq,
    occurredAt: `2026-06-22T11:00:${String(seq).padStart(2, '0')}.000Z`,
    ...raw,
  })
  const next = applyEvent(previous, event)
  return { event, next, result: store.commit({ sessionId, expectedRevision: previous.revision, event, snapshot: next }) }
}

describe('SqliteWorldStore — append-only enforcement', () => {
  it('rejects UPDATE and DELETE on world_events at the DB level', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteWorldStore(db, silentLogger())
      const snapshot = await seedSession(store)
      expect(() =>
        db.prepare('UPDATE world_events SET seq = 99 WHERE session_id = ?').run(snapshot.sessionId),
      ).toThrow(/append-only/)
      expect(() =>
        db.prepare('DELETE FROM world_events WHERE session_id = ?').run(snapshot.sessionId),
      ).toThrow(/append-only/)
    } finally {
      close()
    }
  })

  it('exposes no event mutation/deletion methods on the adapter', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteWorldStore(db, silentLogger())
      expect('updateEvent' in store).toBe(false)
      expect('deleteEvent' in store).toBe(false)
      expect('replaceEvent' in store).toBe(false)
    } finally {
      close()
    }
  })
})

describe('SqliteWorldStore — optimistic concurrency', () => {
  it('lets exactly one of two same-revision commits win; the other conflicts', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteWorldStore(db, silentLogger())
      const snapshot = await seedSession(store)
      const id = snapshot.sessionId

      const a = healthChangedEvent(id, 2, -1)
      const first = await store.commit({
        sessionId: id,
        expectedRevision: 1,
        event: a,
        snapshot: applyEvent(snapshot, a),
      })
      const b = healthChangedEvent(id, 2, -2)
      const second = await store.commit({
        sessionId: id,
        expectedRevision: 1,
        event: b,
        snapshot: applyEvent(snapshot, b),
      })

      expect(first).toEqual({ ok: true })
      expect(second).toEqual({ ok: false, error: { code: 'conflict' } })
      // Exactly one event appended; UNIQUE(session_id, seq) preserved.
      expect((await store.listEvents(id)).map((e) => e.seq)).toEqual([1, 2])
      expect((await store.getSnapshot(id))?.revision).toBe(2)
    } finally {
      close()
    }
  })
})

describe('SqliteWorldStore — projection consistency', () => {
  it('keeps projectWorldState(listEvents) deep-equal to the stored snapshot', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteWorldStore(db, silentLogger())
      let state = await seedSession(store)
      const id = state.sessionId

      const commands: Record<string, unknown>[] = [
        { type: 'moved-to-room', payload: { fromRoomId: 'start-room', toRoomId: 'hallway' } },
        { type: 'item-added', payload: { item: { itemId: 'key', name: 'Brass Key', quantity: 1 } } },
        { type: 'item-removed', payload: { itemId: 'water', quantity: 1 } },
        { type: 'health-changed', payload: { delta: -2, reason: 'trap' } },
        { type: 'status-changed', payload: { status: 'wounded', op: 'add' } },
        { type: 'room-state-changed', payload: { roomId: 'hallway', flags: { searched: true } } },
      ]
      for (const raw of commands) {
        const { next, result } = commitEvent(store, id, state, raw)
        const committed = await result
        if (!committed.ok) throw new Error(`commit failed: ${committed.error.code}`)
        state = next
      }

      const log = await store.listEvents(id)
      expect(log.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7])
      expect(projectWorldState(log)).toEqual(await store.getSnapshot(id))
      expect(projectWorldState(log)).toEqual(state)
    } finally {
      close()
    }
  })
})

describe('SqliteWorldStore — cross-session isolation', () => {
  it('keeps two sessions in one database fully separate', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteWorldStore(db, silentLogger())
      const idA = '00000000-0000-4000-8000-0000000000a0'
      const idB = '00000000-0000-4000-8000-0000000000b0'
      const worldA = '00000000-0000-4000-8000-0000000000aa'
      const worldB = '00000000-0000-4000-8000-0000000000bb'
      const snapA = await seedSession(store, idA, worldA)
      const snapB = await seedSession(store, idB, worldB)

      const a = healthChangedEvent(idA, 2, -4)
      await store.commit({ sessionId: idA, expectedRevision: 1, event: a, snapshot: applyEvent(snapA, a) })

      // B is untouched by A's commit.
      expect((await store.listEvents(idB)).map((e) => e.seq)).toEqual([1])
      expect((await store.getSnapshot(idB))?.worldId).toBe(worldB)
      expect((await store.getSnapshot(idB))?.player.health.current).toBe(snapB.player.health.current)
      expect((await store.getSnapshot(idA))?.player.health.current).toBe(4)
    } finally {
      close()
    }
  })
})

describe('SqliteWorldStore — durability', () => {
  const paths: string[] = []
  afterEach(() => {
    for (const path of paths.splice(0)) {
      rmSync(path, { force: true })
      rmSync(`${path}-wal`, { force: true })
      rmSync(`${path}-shm`, { force: true })
    }
  })

  it('returns persisted sessions and events after reopening the file', async () => {
    const { db, path } = createTempFileDb()
    paths.push(path)
    const store = new SqliteWorldStore(db, silentLogger())
    const snapshot = await seedSession(store)
    const id = snapshot.sessionId
    const event = healthChangedEvent(id, 2, -3)
    await store.commit({ sessionId: id, expectedRevision: 1, event, snapshot: applyEvent(snapshot, event) })
    db.close()

    const reopened = open(path)
    try {
      const store2 = new SqliteWorldStore(reopened, silentLogger())
      expect((await store2.getSnapshot(id))?.revision).toBe(2)
      expect((await store2.listEvents(id)).map((e) => e.seq)).toEqual([1, 2])
    } finally {
      reopened.close()
    }
  })
})

describe('SqliteWorldStore — JSON read boundary', () => {
  it('throws on a corrupt stored snapshot rather than masking it as null', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteWorldStore(db, silentLogger())
      const snapshot = await seedSession(store)
      db.prepare('UPDATE world_sessions SET snapshot_json = ? WHERE session_id = ?').run(
        '{ not valid json',
        snapshot.sessionId,
      )
      await expect(store.getSnapshot(snapshot.sessionId)).rejects.toThrow(/corrupt stored snapshot/)
    } finally {
      close()
    }
  })

  it('throws on a corrupt stored event rather than returning it', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteWorldStore(db, silentLogger())
      const snapshot = await seedSession(store)
      // INSERT (not UPDATE) a corrupt event row — the append-only triggers only
      // block UPDATE/DELETE, so a corrupted INSERT is a faithful corruption probe.
      db.prepare(
        `INSERT INTO world_events
           (event_id, session_id, seq, type, occurred_at, schema_version, event_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), snapshot.sessionId, 2, 'health-changed', '2026-06-22T12:00:00.000Z', 1, '{bad')
      await expect(store.listEvents(snapshot.sessionId)).rejects.toThrow(/corrupt stored event/)
    } finally {
      close()
    }
  })
})

describe('SqliteWorldStore — log safety', () => {
  it('logs only ids/counts/codes, never payload text, item names, or reasons', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { logger, entries } = createCapturingLogger()
      const store = new SqliteWorldStore(db, logger)

      const id = '00000000-0000-4000-8000-0000000000d0'
      const worldId = '00000000-0000-4000-8000-0000000000dd'
      const firstEvent = sessionStartedEvent(id, worldId)
      // Stamp secrets into the seed that the store must never log.
      const secretSeed = {
        ...firstEvent.payload.seed,
        name: 'SECRET-WORLD-NAME',
        initialPlayer: {
          ...firstEvent.payload.seed.initialPlayer,
          inventory: [{ itemId: 'water', name: 'SECRET-ITEM-NAME', quantity: 1 }],
        },
      }
      const seededFirst = WorldEventSchema.parse({ ...firstEvent, payload: { seed: secretSeed } })
      if (seededFirst.type !== 'session-started') throw new Error('narrowing failed')
      const snapshot = applyEvent(null, seededFirst)
      await store.createSession({ sessionId: id, worldId, firstEvent: seededFirst, snapshot })

      const event: WorldEvent = WorldEventSchema.parse({
        schemaVersion: 1,
        eventId: randomUUID(),
        sessionId: id,
        seq: 2,
        occurredAt: '2026-06-22T11:00:02.000Z',
        type: 'health-changed',
        payload: { delta: -1, reason: 'SECRET-REASON' },
      })
      await store.commit({ sessionId: id, expectedRevision: 1, event, snapshot: applyEvent(snapshot, event) })

      const serialized = JSON.stringify(entries)
      expect(serialized).not.toContain('SECRET-WORLD-NAME')
      expect(serialized).not.toContain('SECRET-ITEM-NAME')
      expect(serialized).not.toContain('SECRET-REASON')
      // It does log the safe ids/counts.
      expect(serialized).toContain(id)
    } finally {
      close()
    }
  })
})
