import { UuidSchema, WORLD_SCHEMA_VERSION } from '../../domain/world/worldState'
import { CreateSessionRequestSchema, parseSinceSeqQuery } from '../contracts'
import { errorResponse, jsonResponse } from '../http'
import type { ApiResponse } from '../http'
import type { Route, RouteParams } from '../router'

/** Session-only HTTP edge for commit 2 of ADR-0019. */
export const sessionRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/sessions',
    handler: async (req, _params, deps) => {
      const body = CreateSessionRequestSchema.safeParse(req.body)
      if (!body.success) {
        deps.logger.warn('session request rejected', {
          route: '/sessions',
          code: 'invalid-request',
        })
        return errorResponse('invalid-request')
      }

      const started = await deps.session.startSession({
        schemaVersion: WORLD_SCHEMA_VERSION,
        worldId: deps.idGenerator.newId(),
        ...body.data,
      })
      if (!started.ok) return mapCreateError(started.error.code)

      deps.logger.info('session created through api', {
        sessionId: started.state.sessionId,
        revision: started.state.revision,
      })
      return jsonResponse(201, { sessionId: started.state.sessionId, state: started.state })
    },
  },
  {
    method: 'GET',
    pattern: '/sessions/:sessionId/state',
    handler: async (_req, params, deps) => {
      const sessionId = parseSessionId(params)
      if (!sessionId) return errorResponse('invalid-request')

      const result = await deps.session.getWorldState(sessionId)
      if (!result.ok) return errorResponse('not-found')

      deps.logger.info('session state read through api', {
        sessionId,
        revision: result.state.revision,
      })
      return jsonResponse(200, { state: result.state })
    },
  },
  {
    method: 'GET',
    pattern: '/sessions/:sessionId/events',
    handler: async (req, params, deps) => {
      const sessionId = parseSessionId(params)
      const query = parseSinceSeqQuery(req.query)
      if (!sessionId || !query.success) return errorResponse('invalid-request')

      const result = await deps.session.getEventLog(sessionId, query.data)
      if (!result.ok) return errorResponse('not-found')

      deps.logger.info('session events read through api', {
        sessionId,
        eventCount: result.events.length,
      })
      return jsonResponse(200, { events: result.events })
    },
  },
]

function parseSessionId(params: RouteParams): string | null {
  const parsed = UuidSchema.safeParse(params.sessionId)
  return parsed.success ? parsed.data : null
}

function mapCreateError(code: string): ApiResponse {
  if (code === 'invalid-canon') return errorResponse('invalid-request')
  if (code === 'already-exists' || code === 'conflict') return errorResponse('conflict')
  return errorResponse('internal')
}
