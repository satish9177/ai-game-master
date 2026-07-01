import { existsSync, rmSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { NpcMemoryRecordSchema } from '../../domain/memory/contracts'
import { open, runMigrations } from '../db'
import { migrations } from '../migrations'
import type { Migration } from '../migrations'
import { createMemoryDb, createTempFileDb, silentLogger } from '../testing/createTestDb'
import { SqliteNpcMemoryStore } from '../SqliteNpcMemoryStore'

function names(db: DatabaseSync, type: 'table' | 'trigger'): string[] {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type = ? ORDER BY name`)
    .all(type)
    .map((row) => String(row.name))
}

describe('migrations / 0001_init', () => {
  it('creates the durable tables and append-only triggers', () => {
    const { db, close } = createMemoryDb()
    try {
      expect(names(db, 'table')).toEqual([
        'npc_memories',
        'room_memories',
        'rooms',
        'schema_migrations',
        'world_events',
        'world_sessions',
      ])
      expect(names(db, 'trigger')).toEqual([
        'npc_memories_no_update',
        'room_memories_no_update',
        'world_events_no_delete',
        'world_events_no_update',
      ])
    } finally {
      close()
    }
  })

  it('records version, name, and an applied_at timestamp in schema_migrations', () => {
    const { db, close } = createMemoryDb()
    try {
      const rows = db
        .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
        .all()
      expect(rows).toHaveLength(4)
      const row = rows[0]!
      expect(Number(row.version)).toBe(1)
      expect(row.name).toBe('init')
      expect(typeof row.applied_at).toBe('string')
      expect(String(row.applied_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    } finally {
      close()
    }
  })

  it('is a no-op when re-run on an already-migrated database', () => {
    const { db, close } = createMemoryDb()
    try {
      runMigrations(db)
      runMigrations(db)
      const count = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()
      expect(Number(count?.n)).toBe(4)
    } finally {
      close()
    }
  })

  it('rolls a failed migration back entirely and leaves the prior version', () => {
    const db = open(':memory:')
    try {
      const broken: readonly Migration[] = [
        { version: 1, name: 'init', up: (d) => d.exec('CREATE TABLE kept (x)') },
        {
          version: 2,
          name: 'broken',
          up: (d) => {
            d.exec('CREATE TABLE should_not_exist (x)')
            throw new Error('boom')
          },
        },
      ]
      expect(() => runMigrations(db, broken)).toThrow('boom')

      // version 1 committed; version 2 rolled back wholesale.
      const applied = db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((row) => Number(row.version))
      expect(applied).toEqual([1])
      expect(names(db, 'table')).toContain('kept')
      expect(names(db, 'table')).not.toContain('should_not_exist')
    } finally {
      db.close()
    }
  })
})

describe('migrations / 0002_npc_memories', () => {
  function indexes(db: DatabaseSync): string[] {
    return db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`)
      .all()
      .map((row) => String(row.name))
  }

  it('creates the npc_memories table, scope index, and no-update trigger', () => {
    const { db, close } = createMemoryDb()
    try {
      expect(names(db, 'table')).toContain('npc_memories')
      expect(indexes(db)).toContain('idx_npc_memories_scope')
      expect(names(db, 'trigger')).toContain('npc_memories_no_update')
      // delete is intentionally left open — no no-delete trigger
      expect(names(db, 'trigger')).not.toContain('npc_memories_no_delete')
    } finally {
      close()
    }
  })

  it('records migration version 2 as npc_memories', () => {
    const { db, close } = createMemoryDb()
    try {
      const row = db.prepare('SELECT name FROM schema_migrations WHERE version = 2').get()
      expect(row?.name).toBe('npc_memories')
    } finally {
      close()
    }
  })
})

describe('migrations / 0003_room_memories', () => {
  function indexes(db: DatabaseSync): string[] {
    return db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`)
      .all()
      .map((row) => String(row.name))
  }

  it('creates the room_memories table, scope index, and no-update trigger', () => {
    const { db, close } = createMemoryDb()
    try {
      expect(names(db, 'table')).toContain('room_memories')
      expect(indexes(db)).toContain('idx_room_memories_scope')
      expect(names(db, 'trigger')).toContain('room_memories_no_update')
      // delete is intentionally left open — no no-delete trigger
      expect(names(db, 'trigger')).not.toContain('room_memories_no_delete')
    } finally {
      close()
    }
  })

  it('records migration version 3 as room_memories', () => {
    const { db, close } = createMemoryDb()
    try {
      const row = db.prepare('SELECT name FROM schema_migrations WHERE version = 3').get()
      expect(row?.name).toBe('room_memories')
    } finally {
      close()
    }
  })

  it('0002 (npc_memories) remains intact and unaltered after 0003 runs', () => {
    const { db, close } = createMemoryDb()
    try {
      expect(names(db, 'table')).toContain('npc_memories')
      expect(indexes(db)).toContain('idx_npc_memories_scope')
      expect(names(db, 'trigger')).toContain('npc_memories_no_update')
    } finally {
      close()
    }
  })
})

describe('migrations / 0004_memory_dedupe_key', () => {
  function indexes(db: DatabaseSync): string[] {
    return db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`)
      .all()
      .map((row) => String(row.name))
  }

  function columns(db: DatabaseSync, table: string): string[] {
    return db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String(row.name))
  }

  it('adds a nullable dedupe_key column and a dedupe index to both memory tables', () => {
    const { db, close } = createMemoryDb()
    try {
      expect(columns(db, 'npc_memories')).toContain('dedupe_key')
      expect(columns(db, 'room_memories')).toContain('dedupe_key')
      expect(indexes(db)).toContain('idx_npc_memories_dedupe')
      expect(indexes(db)).toContain('idx_room_memories_dedupe')
    } finally {
      close()
    }
  })

  it('records migration version 4 as memory_dedupe_key', () => {
    const { db, close } = createMemoryDb()
    try {
      const row = db.prepare('SELECT name FROM schema_migrations WHERE version = 4').get()
      expect(row?.name).toBe('memory_dedupe_key')
    } finally {
      close()
    }
  })

  it('is a no-op when re-run on an already-migrated database', () => {
    const { db, close } = createMemoryDb()
    try {
      runMigrations(db)
      runMigrations(db)
      expect(columns(db, 'npc_memories').filter((c) => c === 'dedupe_key')).toHaveLength(1)
      const count = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()
      expect(Number(count?.n)).toBe(4)
    } finally {
      close()
    }
  })

  it('no data loss: a pre-0004 row (NULL dedupe_key, fieldless JSON) still parses and recalls', async () => {
    const db = open(':memory:')
    try {
      // Migrate only through v3 — the schema as it existed before this slice.
      runMigrations(db, migrations.filter((m) => m.version <= 3))

      db.prepare(
        `INSERT INTO world_sessions
           (session_id, world_id, schema_version, revision, snapshot_json, created_at, updated_at)
         VALUES (?, ?, 1, 1, '{}', '2026-06-23T10:00:00.000Z', '2026-06-23T10:00:00.000Z')`,
      ).run('session-1', 'world-1')

      const fieldlessRecord = {
        schemaVersion: 1,
        memoryId: 'old-mem-1',
        worldId: 'world-1',
        sessionId: 'session-1',
        npcId: 'npc-1',
        kind: 'npc_belief',
        text: 'a pre-dedupe-key memory',
        provenance: { source: 'npc' },
        confidence: 'medium',
        seq: 1,
        createdAt: '2026-06-23T10:00:00.000Z',
      }
      // The pre-0004 9-column INSERT — no dedupe_key column exists yet.
      db.prepare(
        `INSERT INTO npc_memories
           (memory_id, world_id, session_id, npc_id, kind, seq, schema_version, memory_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'old-mem-1',
        'world-1',
        'session-1',
        'npc-1',
        'npc_belief',
        1,
        1,
        JSON.stringify(fieldlessRecord),
        '2026-06-23T10:00:00.000Z',
      )

      // Now bring the database up to v4.
      runMigrations(db)
      expect(columns(db, 'npc_memories')).toContain('dedupe_key')

      const row = db.prepare('SELECT dedupe_key FROM npc_memories WHERE memory_id = ?').get('old-mem-1')
      expect(row?.dedupe_key).toBeNull()

      const store = new SqliteNpcMemoryStore(db, silentLogger())
      const got = await store.listForNpc({ worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' })
      expect(got).toHaveLength(1)
      expect(got[0]?.memoryId).toBe('old-mem-1')
      expect(NpcMemoryRecordSchema.safeParse(got[0]).success).toBe(true)
    } finally {
      db.close()
    }
  })
})

describe('migrations / durability', () => {
  const reopened: string[] = []

  afterEach(() => {
    for (const path of reopened.splice(0)) {
      rmSync(path, { force: true })
      rmSync(`${path}-wal`, { force: true })
      rmSync(`${path}-shm`, { force: true })
    }
  })

  it('a reopened temp-file database still sees the migrated schema', () => {
    const { db, path } = createTempFileDb()
    reopened.push(path)
    db.close()

    const reopenedDb = open(path)
    try {
      expect(names(reopenedDb, 'table')).toContain('world_sessions')
      // re-running migrations against the persisted file is a no-op.
      runMigrations(reopenedDb)
      const count = reopenedDb.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()
      expect(Number(count?.n)).toBe(4)
    } finally {
      reopenedDb.close()
    }
  })

  it('createTempFileDb cleanup removes the database file', () => {
    const { path, cleanup } = createTempFileDb()
    expect(existsSync(path)).toBe(true)
    cleanup()
    expect(existsSync(path)).toBe(false)
  })
})
