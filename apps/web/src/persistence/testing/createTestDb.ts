import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Logger, LogContext, LogLevel } from '../../platform/logger/Logger'
import { open, runMigrations } from '../db'

/**
 * Temp-DB test harness (ADR-0018). Node-only; imports `node:sqlite` directly and
 * runs under Vitest's default Node environment (no jsdom). Adapters are
 * constructed by the individual test files over the returned `db`, so this
 * helper stays free of any store dependency.
 */

export type MemoryDb = {
  db: DatabaseSync
  /** Discard the in-memory database. */
  close: () => void
}

export type TempFileDb = {
  db: DatabaseSync
  path: string
  /** Close the connection and remove the file (and any WAL/SHM sidecars). */
  cleanup: () => void
}

/**
 * A migrated `:memory:` database, auto-isolated per test. The default for
 * contract/behavioral tests.
 */
export function createMemoryDb(): MemoryDb {
  const db = open(':memory:')
  runMigrations(db)
  return { db, close: () => db.close() }
}

/**
 * A migrated temp-file database for durability/reopen and migration tests.
 * Call `cleanup()` in `afterEach`.
 */
export function createTempFileDb(): TempFileDb {
  const path = join(tmpdir(), `aigm-test-${randomUUID()}.sqlite`)
  const db = open(path)
  runMigrations(db)
  return {
    db,
    path,
    cleanup: () => {
      db.close()
      rmSync(path, { force: true })
      rmSync(`${path}-wal`, { force: true })
      rmSync(`${path}-shm`, { force: true })
    },
  }
}

export type CapturedLog = { level: LogLevel; message: string; context: LogContext }

/**
 * A `Logger` that records every entry so tests can assert log-safety (ids /
 * counts / codes only — never payloads, room text, or story content).
 */
export function createCapturingLogger(): { logger: Logger; entries: CapturedLog[] } {
  const entries: CapturedLog[] = []
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
  return { logger: build({}), entries }
}

/** A no-op `Logger` for tests that do not assert on logging. */
export function silentLogger(): Logger {
  const noop = () => {}
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
  }
  return logger
}
