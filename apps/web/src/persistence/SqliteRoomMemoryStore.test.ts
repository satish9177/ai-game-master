import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { ROOM_MEMORY_SCHEMA_VERSION } from '../domain/memory/roomContracts'
import type { RoomMemoryInsert } from '../domain/memory/roomContracts'
import { SqliteRoomMemoryStore } from './SqliteRoomMemoryStore'
import { createCapturingLogger, createMemoryDb, silentLogger } from './testing/createTestDb'

/** Seed a minimal world_sessions row so the FK is satisfied. */
function seedSession(db: DatabaseSync, sessionId: string, worldId = 'world-1'): void {
  db.prepare(
    `INSERT INTO world_sessions
       (session_id, world_id, schema_version, revision, snapshot_json, created_at, updated_at)
     VALUES (?, ?, 1, 1, '{}', '2026-06-23T10:00:00.000Z', '2026-06-23T10:00:00.000Z')`,
  ).run(sessionId, worldId)
}

function insert(overrides: Partial<RoomMemoryInsert> = {}): RoomMemoryInsert {
  return {
    schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
    memoryId: 'mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    roomId: 'room-1',
    kind: 'room_observation',
    text: 'aaa',
    provenance: { source: 'npc' },
    confidence: 'low',
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

describe('SqliteRoomMemoryStore — record / list round trip', () => {
  it('records a memory and lists it back, assigning seq 1', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      const written = await store.record(insert({ memoryId: 'm1', text: 'remembered fact' }))
      expect(written.ok).toBe(true)
      if (!written.ok) return
      expect(written.record.seq).toBe(1)

      const got = await store.listForRoom({
        worldId: 'world-1',
        sessionId: 'session-1',
        roomId: 'room-1',
      })
      expect(got).toHaveLength(1)
      expect(got[0]).toEqual(written.record)
    } finally {
      close()
    }
  })

  it('assigns a monotonic seq per (session, room), independent across rooms', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      const a = await store.record(insert({ memoryId: 'a', roomId: 'room-1' }))
      const b = await store.record(insert({ memoryId: 'b', roomId: 'room-1' }))
      const c = await store.record(insert({ memoryId: 'c', roomId: 'room-2' }))
      expect(a.ok && a.record.seq).toBe(1)
      expect(b.ok && b.record.seq).toBe(2)
      expect(c.ok && c.record.seq).toBe(1)
    } finally {
      close()
    }
  })

  it('returns memories seq desc, bounded by limit', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      await store.record(insert({ memoryId: 'a' }))
      await store.record(insert({ memoryId: 'b' }))
      await store.record(insert({ memoryId: 'c' }))
      const got = await store.listForRoom(
        { worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' },
        { limit: 2 },
      )
      expect(got.map((r) => r.seq)).toEqual([3, 2])
    } finally {
      close()
    }
  })
})

describe('SqliteRoomMemoryStore — failures', () => {
  it('rejects a write for an unknown session with session-not-found (FK)', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      const result = await store.record(insert({ sessionId: 'ghost' }))
      expect(result).toEqual({ ok: false, error: { code: 'session-not-found' } })
      // nothing stored
      const count = db.prepare('SELECT COUNT(*) AS n FROM room_memories').get()
      expect(Number(count?.n)).toBe(0)
    } finally {
      close()
    }
  })

  it('maps a UNIQUE constraint violation to conflict and rolls back', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      expect((await store.record(insert({ memoryId: 'dup' }))).ok).toBe(true)
      // A second insert with the same primary key is a UNIQUE violation → conflict.
      const result = await store.record(insert({ memoryId: 'dup', roomId: 'room-2' }))
      expect(result).toEqual({ ok: false, error: { code: 'conflict' } })
    } finally {
      close()
    }
  })
})

describe('SqliteRoomMemoryStore — corrupt stored row', () => {
  it('skips a corrupt memory_json row and returns the valid rest', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      await store.record(insert({ memoryId: 'good', text: 'valid' }))
      // Insert a corrupt row directly (bypassing the adapter), with a higher seq.
      db.prepare(
        `INSERT INTO room_memories
           (memory_id, world_id, session_id, room_id, kind, seq, schema_version, memory_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'broken',
        'world-1',
        'session-1',
        'room-1',
        'room_observation',
        2,
        1,
        '{ not valid json',
        '2026-06-23T10:00:00.000Z',
      )

      const got = await store.listForRoom({
        worldId: 'world-1',
        sessionId: 'session-1',
        roomId: 'room-1',
      })
      expect(got.map((r) => r.memoryId)).toEqual(['good'])
    } finally {
      close()
    }
  })

  it('skips a row whose stored memory_json scope diverges from the query scope', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const { logger, entries } = createCapturingLogger()
      const store = new SqliteRoomMemoryStore(db, logger)
      const secret = 'TAMPERED-ROOM-MEMORY-TEXT-xyz'
      await store.record(insert({ memoryId: 'good', text: 'valid' }))
      // Tamper ONLY the stored JSON scope: the SQL columns still match the query
      // (so the row is returned by the WHERE clause), but the parsed body claims
      // a different worldId/sessionId/roomId. It must be skipped, never leaked.
      const tampered = JSON.stringify({
        ...insert({
          memoryId: 'tampered',
          worldId: 'other-world',
          sessionId: 'other-session',
          roomId: 'other-room',
          text: secret,
        }),
        seq: 2,
      })
      db.prepare(
        `INSERT INTO room_memories
           (memory_id, world_id, session_id, room_id, kind, seq, schema_version, memory_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'tampered',
        'world-1',
        'session-1',
        'room-1',
        'room_observation',
        2,
        1,
        tampered,
        '2026-06-23T10:00:00.000Z',
      )

      const got = await store.listForRoom({
        worldId: 'world-1',
        sessionId: 'session-1',
        roomId: 'room-1',
      })
      expect(got.map((r) => r.memoryId)).toEqual(['good'])

      const serialized = JSON.stringify(entries)
      expect(serialized).not.toContain(secret)
      expect(serialized).toContain('invalid-stored-memory')
      expect(serialized).toContain('tampered')
    } finally {
      close()
    }
  })
})

describe('SqliteRoomMemoryStore — immutability', () => {
  it('the no-update trigger aborts an UPDATE', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      await store.record(insert({ memoryId: 'm1', text: 'immutable' }))
      expect(() =>
        db
          .prepare(`UPDATE room_memories SET kind = 'player_claim' WHERE memory_id = ?`)
          .run('m1'),
      ).toThrow(/immutable/i)
    } finally {
      close()
    }
  })
})

describe('SqliteRoomMemoryStore — scope isolation', () => {
  it('lists only the exact scope triple, no cross-world/session/room leak', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'sessionA', 'worldA')
      seedSession(db, 'sessionB', 'worldB')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      await store.record(
        insert({ memoryId: 'keep', worldId: 'worldA', sessionId: 'sessionA', roomId: 'room1' }),
      )
      await store.record(
        insert({ memoryId: 'world', worldId: 'worldB', sessionId: 'sessionA', roomId: 'room1' }),
      )
      await store.record(
        insert({ memoryId: 'session', worldId: 'worldA', sessionId: 'sessionB', roomId: 'room1' }),
      )
      await store.record(
        insert({ memoryId: 'room', worldId: 'worldA', sessionId: 'sessionA', roomId: 'room2' }),
      )

      const got = await store.listForRoom({
        worldId: 'worldA',
        sessionId: 'sessionA',
        roomId: 'room1',
      })
      expect(got.map((r) => r.memoryId)).toEqual(['keep'])
    } finally {
      close()
    }
  })
})

describe('SqliteRoomMemoryStore — dedupe (Slice C3)', () => {
  it('a repeated dedupeKey returns the original record with deduplicated:true, no second row', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      const first = await store.record(insert({ memoryId: 'm1', text: 'first', dedupeKey: 'evt-1' }))
      expect(first.ok).toBe(true)
      if (!first.ok) return

      const second = await store.record(
        insert({ memoryId: 'm2', text: 'second, should be dropped', dedupeKey: 'evt-1' }),
      )
      expect(second).toEqual({ ok: true, record: first.record, deduplicated: true })

      const count = db.prepare('SELECT COUNT(*) AS n FROM room_memories').get()
      expect(Number(count?.n)).toBe(1)
    } finally {
      close()
    }
  })

  it('different dedupeKeys each insert their own row', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      const a = await store.record(insert({ memoryId: 'm1', dedupeKey: 'evt-1' }))
      const b = await store.record(insert({ memoryId: 'm2', dedupeKey: 'evt-2' }))
      expect(a.ok && a.record.seq).toBe(1)
      expect(b.ok && 'deduplicated' in b).toBe(false)
      expect(b.ok && b.record.seq).toBe(2)
    } finally {
      close()
    }
  })

  it('an absent dedupeKey preserves today’s behavior (no pre-check, two rows)', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      const a = await store.record(insert({ memoryId: 'm1' }))
      const b = await store.record(insert({ memoryId: 'm2' }))
      expect(a.ok && 'deduplicated' in a).toBe(false)
      expect(b.ok && 'deduplicated' in b).toBe(false)
      const count = db.prepare('SELECT COUNT(*) AS n FROM room_memories').get()
      expect(Number(count?.n)).toBe(2)
    } finally {
      close()
    }
  })

  it('persists dedupe_key in its own column', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      await store.record(insert({ memoryId: 'm1', dedupeKey: 'evt-1' }))
      const row = db.prepare('SELECT dedupe_key FROM room_memories WHERE memory_id = ?').get('m1')
      expect(row?.dedupe_key).toBe('evt-1')
    } finally {
      close()
    }
  })

  it('importance and entitySnapshots survive a write -> read round trip', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      await store.record(
        insert({
          memoryId: 'm1',
          importance: 3,
          entitySnapshots: { room: { id: 'room-1', displayName: 'Old Library' } },
        }),
      )
      const got = await store.listForRoom({ worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' })
      expect(got[0]?.importance).toBe(3)
      expect(got[0]?.entitySnapshots).toEqual({ room: { id: 'room-1', displayName: 'Old Library' } })
    } finally {
      close()
    }
  })

  it('a corrupt prior dedupeKey row is treated as a miss (inserts normally)', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      // Insert a corrupt row directly with the dedupe key already set.
      db.prepare(
        `INSERT INTO room_memories
           (memory_id, world_id, session_id, room_id, kind, seq, schema_version, memory_json, created_at, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('broken', 'world-1', 'session-1', 'room-1', 'room_observation', 1, 1, '{ not valid json', '2026-06-23T10:00:00.000Z', 'evt-1')

      const store = new SqliteRoomMemoryStore(db, silentLogger())
      const result = await store.record(insert({ memoryId: 'm1', text: 'valid', dedupeKey: 'evt-1' }))
      expect(result.ok).toBe(true)
      expect(result.ok && 'deduplicated' in result).toBe(false)
    } finally {
      close()
    }
  })
})

describe('SqliteRoomMemoryStore — log safety', () => {
  it('logs ids/seq/codes only — never memory text', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const { logger, entries } = createCapturingLogger()
      const store = new SqliteRoomMemoryStore(db, logger)
      const secret = 'SECRET-ROOM-MEMORY-TEXT-xyz'
      await store.record(insert({ memoryId: 'm1', text: secret }))
      await store.listForRoom({ worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' })
      await store.record(insert({ memoryId: 'm2', sessionId: 'ghost', text: secret }))

      const serialized = JSON.stringify(entries)
      expect(serialized).not.toContain(secret)
      expect(serialized).toContain('m1')
      expect(serialized).toContain('session-not-found')
    } finally {
      close()
    }
  })
})
