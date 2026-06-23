import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { NPC_MEMORY_SCHEMA_VERSION } from '../domain/memory/contracts'
import type { NpcMemoryInsert } from '../domain/memory/contracts'
import { SqliteNpcMemoryStore } from './SqliteNpcMemoryStore'
import { createCapturingLogger, createMemoryDb, silentLogger } from './testing/createTestDb'

/** Seed a minimal world_sessions row so the FK is satisfied. */
function seedSession(db: DatabaseSync, sessionId: string, worldId = 'world-1'): void {
  db.prepare(
    `INSERT INTO world_sessions
       (session_id, world_id, schema_version, revision, snapshot_json, created_at, updated_at)
     VALUES (?, ?, 1, 1, '{}', '2026-06-23T10:00:00.000Z', '2026-06-23T10:00:00.000Z')`,
  ).run(sessionId, worldId)
}

function insert(overrides: Partial<NpcMemoryInsert> = {}): NpcMemoryInsert {
  return {
    schemaVersion: NPC_MEMORY_SCHEMA_VERSION,
    memoryId: 'mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    npcId: 'npc-1',
    kind: 'npc_belief',
    text: 'aaa',
    provenance: { source: 'npc' },
    confidence: 'low',
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

describe('SqliteNpcMemoryStore — record / list round trip', () => {
  it('records a memory and lists it back, assigning seq 1', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      const written = await store.record(insert({ memoryId: 'm1', text: 'remembered fact' }))
      expect(written.ok).toBe(true)
      if (!written.ok) return
      expect(written.record.seq).toBe(1)

      const got = await store.listForNpc({ worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' })
      expect(got).toHaveLength(1)
      expect(got[0]).toEqual(written.record)
    } finally {
      close()
    }
  })

  it('assigns a monotonic seq per (session, npc), independent across npcs', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      const a = await store.record(insert({ memoryId: 'a', npcId: 'npc-1' }))
      const b = await store.record(insert({ memoryId: 'b', npcId: 'npc-1' }))
      const c = await store.record(insert({ memoryId: 'c', npcId: 'npc-2' }))
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
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      await store.record(insert({ memoryId: 'a' }))
      await store.record(insert({ memoryId: 'b' }))
      await store.record(insert({ memoryId: 'c' }))
      const got = await store.listForNpc(
        { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' },
        { limit: 2 },
      )
      expect(got.map((r) => r.seq)).toEqual([3, 2])
    } finally {
      close()
    }
  })
})

describe('SqliteNpcMemoryStore — failures', () => {
  it('rejects a write for an unknown session with session-not-found (FK)', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      const result = await store.record(insert({ sessionId: 'ghost' }))
      expect(result).toEqual({ ok: false, error: { code: 'session-not-found' } })
      // nothing stored
      const count = db.prepare('SELECT COUNT(*) AS n FROM npc_memories').get()
      expect(Number(count?.n)).toBe(0)
    } finally {
      close()
    }
  })

  it('maps a UNIQUE constraint violation to conflict and rolls back', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      expect((await store.record(insert({ memoryId: 'dup' }))).ok).toBe(true)
      // A second insert with the same primary key is a UNIQUE violation → conflict.
      const result = await store.record(insert({ memoryId: 'dup', npcId: 'npc-2' }))
      expect(result).toEqual({ ok: false, error: { code: 'conflict' } })
    } finally {
      close()
    }
  })
})

describe('SqliteNpcMemoryStore — corrupt stored row', () => {
  it('skips a corrupt memory_json row and returns the valid rest', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      await store.record(insert({ memoryId: 'good', text: 'valid' }))
      // Insert a corrupt row directly (bypassing the adapter), with a higher seq.
      db.prepare(
        `INSERT INTO npc_memories
           (memory_id, world_id, session_id, npc_id, kind, seq, schema_version, memory_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('broken', 'world-1', 'session-1', 'npc-1', 'npc_belief', 2, 1, '{ not valid json', '2026-06-23T10:00:00.000Z')

      const got = await store.listForNpc({ worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' })
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
      const store = new SqliteNpcMemoryStore(db, logger)
      const secret = 'TAMPERED-MEMORY-TEXT-xyz'
      await store.record(insert({ memoryId: 'good', text: 'valid' }))
      // Tamper ONLY the stored JSON scope: the SQL columns still match the query
      // (so the row is returned by the WHERE clause), but the parsed body claims a
      // different worldId/sessionId/npcId. It must be skipped, never leaked.
      const tampered = JSON.stringify({
        ...insert({ memoryId: 'tampered', worldId: 'other-world', sessionId: 'other-session', npcId: 'other-npc', text: secret }),
        seq: 2,
      })
      db.prepare(
        `INSERT INTO npc_memories
           (memory_id, world_id, session_id, npc_id, kind, seq, schema_version, memory_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('tampered', 'world-1', 'session-1', 'npc-1', 'npc_belief', 2, 1, tampered, '2026-06-23T10:00:00.000Z')

      const got = await store.listForNpc({ worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' })
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

describe('SqliteNpcMemoryStore — immutability', () => {
  it('the no-update trigger aborts an UPDATE', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      await store.record(insert({ memoryId: 'm1', text: 'immutable' }))
      expect(() =>
        db.prepare(`UPDATE npc_memories SET kind = 'player_claim' WHERE memory_id = ?`).run('m1'),
      ).toThrow(/immutable/i)
    } finally {
      close()
    }
  })
})

describe('SqliteNpcMemoryStore — scope isolation', () => {
  it('lists only the exact scope triple, no cross-world/session/npc leak', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'sessionA', 'worldA')
      seedSession(db, 'sessionB', 'worldB')
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      await store.record(insert({ memoryId: 'keep', worldId: 'worldA', sessionId: 'sessionA', npcId: 'npc1' }))
      await store.record(insert({ memoryId: 'world', worldId: 'worldB', sessionId: 'sessionA', npcId: 'npc1' }))
      await store.record(insert({ memoryId: 'session', worldId: 'worldA', sessionId: 'sessionB', npcId: 'npc1' }))
      await store.record(insert({ memoryId: 'npc', worldId: 'worldA', sessionId: 'sessionA', npcId: 'npc2' }))

      const got = await store.listForNpc({ worldId: 'worldA', sessionId: 'sessionA', npcId: 'npc1' })
      expect(got.map((r) => r.memoryId)).toEqual(['keep'])
    } finally {
      close()
    }
  })
})

describe('SqliteNpcMemoryStore — log safety', () => {
  it('logs ids/seq/codes only — never memory text', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const { logger, entries } = createCapturingLogger()
      const store = new SqliteNpcMemoryStore(db, logger)
      const secret = 'SECRET-MEMORY-TEXT-xyz'
      await store.record(insert({ memoryId: 'm1', text: secret }))
      await store.listForNpc({ worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' })
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
