import type { DatabaseSync } from 'node:sqlite'
import { silentLogger } from '../../persistence/testing/createTestDb'
import type { Logger } from '../../platform/logger/Logger'
import { buildDeps } from '../bootstrap'
import type { AppDeps } from '../bootstrap'
import { createRouter } from '../router'
import type { Handler, Route } from '../router'
import { healthRoutes } from '../routes/health'

/**
 * Test harness (ADR-0019): build the full router + `AppDeps` over an already-open,
 * migrated test database (`:memory:` or a temp file from
 * `persistence/testing/createTestDb`). Node-only; never touches the dev file DB.
 * Subsequent slices add their route arrays to `allRoutes`.
 */

export type TestApp = {
  deps: AppDeps
  handle: Handler
}

export function createTestApp(db: DatabaseSync, logger: Logger = silentLogger()): TestApp {
  const deps = buildDeps(db, logger)
  return { deps, handle: createRouter(allRoutes()) }
}

function allRoutes(): Route[] {
  return [...healthRoutes]
}
