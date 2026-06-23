import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { RoomStore } from '../domain/ports/RoomStore'
import { createConsoleLogger } from '../platform/logger/consoleLogger'
import type { Logger } from '../platform/logger/Logger'
import { SystemClock } from '../platform/system/clock'
import { UuidGenerator } from '../platform/system/idGenerator'
import { open, runMigrations } from '../persistence/db'
import { SqliteRoomStore } from '../persistence/SqliteRoomStore'
import { SqliteWorldStore } from '../persistence/SqliteWorldStore'
import { WorldSession } from '../world-session/WorldSession'

/**
 * Backend composition root (ADR-0019). Opens SQLite through the existing
 * persistence layer, runs migrations (fail-fast), and constructs the world
 * session + room store the HTTP routes compose over. Node-only; never reachable
 * from the browser bundle.
 */
export type AppDeps = {
  db: DatabaseSync
  session: WorldSession
  roomStore: RoomStore
  logger: Logger
}

const DEFAULT_DEV_DB_PATH = '.data/aigm-dev.sqlite'

/**
 * Resolve the SQLite path: `AIGM_DB_PATH` if set, else a local dev **file** DB so
 * a manual `npm run dev:api` preserves sessions/rooms across restarts. Tests pass
 * `:memory:` / a temp file directly and never reach this default.
 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.AIGM_DB_PATH
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_DEV_DB_PATH
}

/** Construct the dependency graph over an already-open, migrated database. */
export function buildDeps(db: DatabaseSync, logger: Logger): AppDeps {
  const worldStore = new SqliteWorldStore(db, logger)
  const roomStore = new SqliteRoomStore(db, logger)
  const session = new WorldSession(worldStore, new SystemClock(), new UuidGenerator(), logger)
  return { db, session, roomStore, logger }
}

/**
 * Open + migrate the database, then build deps. A migration failure throws and
 * the caller fails fast before listening (FAILURE-MODES case 6). The dev DB
 * directory is created on demand; `:memory:` is left untouched.
 */
export function bootstrap(
  dbPath: string = resolveDbPath(),
  logger: Logger = createConsoleLogger(),
): AppDeps {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
  const db = open(dbPath)
  runMigrations(db)
  return buildDeps(db, logger)
}
