import type { AppDeps } from './bootstrap'
import { errorResponse } from './http'
import type { ApiRequest, ApiResponse } from './http'

/**
 * A tiny dependency-free router (ADR-0019): native `node:http`, no framework.
 * Routes use `:name` path params (e.g. `/sessions/:id/state`). A handler throw
 * is caught and mapped to a safe `internal` 500 so SQL/stack/stored text never
 * leak; an unmatched path is `404`, a matched path with the wrong verb is `405`.
 */

export type RouteParams = Record<string, string>

export type RouteHandler = (
  req: ApiRequest,
  params: RouteParams,
  deps: AppDeps,
) => ApiResponse | Promise<ApiResponse>

export type Route = {
  method: string
  /** Pattern with `:name` params, e.g. `/sessions/:id/state`. */
  pattern: string
  handler: RouteHandler
}

/** The dispatch function the socket layer calls per request. */
export type Handler = (req: ApiRequest, deps: AppDeps) => Promise<ApiResponse>

type CompiledRoute = Route & { segments: string[] }

export function createRouter(routes: readonly Route[]): Handler {
  const compiled: CompiledRoute[] = routes.map((route) => ({
    ...route,
    segments: splitPath(route.pattern),
  }))

  return async function handle(req: ApiRequest, deps: AppDeps): Promise<ApiResponse> {
    const reqSegments = splitPath(req.path)
    let pathMatched = false
    for (const route of compiled) {
      const params = matchSegments(route.segments, reqSegments)
      if (!params) continue
      pathMatched = true
      if (route.method !== req.method) continue
      try {
        return await route.handler(req, params, deps)
      } catch {
        // Never leak the underlying fault (SQL, stack, a corrupt-row throw).
        deps.logger.error('request failed', { route: route.pattern, code: 'internal' })
        return errorResponse('internal')
      }
    }
    return errorResponse(pathMatched ? 'method-not-allowed' : 'not-found')
  }
}

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0)
}

function matchSegments(routeSegments: string[], reqSegments: string[]): RouteParams | null {
  if (routeSegments.length !== reqSegments.length) return null
  const params: RouteParams = {}
  for (let i = 0; i < routeSegments.length; i++) {
    const routeSeg = routeSegments[i]
    const reqSeg = reqSegments[i]
    if (routeSeg === undefined || reqSeg === undefined) return null
    if (routeSeg.startsWith(':')) {
      params[routeSeg.slice(1)] = decodeURIComponent(reqSeg)
      continue
    }
    if (routeSeg !== reqSeg) return null
  }
  return params
}
