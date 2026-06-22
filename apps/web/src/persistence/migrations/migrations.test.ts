import { existsSync, rmSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { open, runMigrations } from '../db'
import type { Migration } from '../migrations'
import { createMemoryDb, createTempFileDb } from '../testing/createTestDb'

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
        'rooms',
        'schema_migrations',
        'world_events',
        'world_sessions',
      ])
      expect(names(db, 'trigger')).toEqual([
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
      const rows = db.prepare('SELECT version, name, applied_at FROM schema_migrations').all()
      expect(rows).toHaveLength(1)
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
      expect(Number(count?.n)).toBe(1)
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
      expect(Number(count?.n)).toBe(1)
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
