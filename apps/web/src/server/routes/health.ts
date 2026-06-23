import { errorResponse, jsonResponse } from '../http'
import type { Route } from '../router'

/**
 * `GET /health` (ADR-0019) — lightweight liveness. Confirms the SQLite
 * connection answers; a probe failure is the only non-fault `503` in v0. By the
 * time the server listens, migrations have already run (fail-fast at boot).
 */

const PERSISTENCE_SCHEMA_VERSION = 1

export const healthRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/health',
    handler: (_req, _params, deps) => {
      try {
        deps.db.prepare('SELECT 1').get()
      } catch {
        deps.logger.warn('health probe failed', { code: 'unavailable' })
        return errorResponse('unavailable')
      }
      return jsonResponse(200, {
        status: 'ok',
        persistenceSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
      })
    },
  },
]
