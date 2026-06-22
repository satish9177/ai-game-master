import { DatabaseSync } from 'node:sqlite'
import { migrations } from './migrations'
import type { Migration } from './migrations'

/**
 * Node-only SQLite connection helpers (ADR-0018, ADR-0004).
 *
 * This module is part of the headless, browser-excluded persistence build unit.
 * It must never be reachable from the browser bundle: `tsconfig.app.json`
 * excludes `src/persistence`, Vite never bundles it (unreachable from
 * `main.tsx`), and ESLint forbids any non-persistence source file from
 * importing `node:sqlite` or the persistence modules.
 *
 * `node:sqlite` is fully synchronous; callers that implement async domain ports
 * wrap the synchronous work in `async` methods.
 */

const DEFAULT_BUSY_TIMEOUT_MS = 5_000

/**
 * Open a SQLite database. `path` is a file path or the special name
 * `':memory:'`. Per-connection PRAGMAs are set immediately, outside any
 * transaction: foreign keys on, a busy timeout, and WAL journaling (meaningful
 * for file databases, a no-op for `:memory:`).
 */
export function open(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`)
  db.exec('PRAGMA journal_mode = WAL')
  return db
}

/**
 * Run `fn` inside a single `BEGIN IMMEDIATE` … `COMMIT` transaction. On any
 * throw the transaction is rolled back and the error is rethrown, so a failed
 * unit of work commits nothing. Contained to the persistence layer.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Apply every not-yet-applied migration in order. Forward-only: each migration's
 * `up(db)` and its `schema_migrations` insert run inside one transaction, so a
 * migration that fails midway rolls back entirely, records nothing, and leaves
 * the database at the prior version (the error is rethrown — fail fast on a
 * half-migrated DB, FAILURE-MODES case 6). Re-running on an up-to-date DB is a
 * no-op.
 */
export function runMigrations(
  db: DatabaseSync,
  list: readonly Migration[] = migrations,
): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  )

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all()
  const applied = new Set(appliedRows.map((row) => Number(row.version)))

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  )

  for (const migration of [...list].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue
    withTransaction(db, () => {
      migration.up(db)
      insert.run(migration.version, migration.name, new Date().toISOString())
    })
  }
}
