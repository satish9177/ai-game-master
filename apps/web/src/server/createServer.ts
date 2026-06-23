import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AppDeps } from './bootstrap'
import { errorResponse } from './http'
import type { ApiRequest, ApiResponse } from './http'
import type { Handler } from './router'

/**
 * Bind the router to a native Node HTTP server (ADR-0019). Reads and JSON-parses
 * the body, builds a neutral `ApiRequest`, dispatches, and writes the JSON
 * response. A malformed/oversized body is a `400`; any thrown fault maps to a
 * safe `500` — SQL, stack traces, and stored text never reach the client.
 */

const MAX_BODY_BYTES = 1_000_000

export function createServer(deps: AppDeps, handle: Handler): Server {
  return createHttpServer((req, res) => {
    void serve(req, res, deps, handle)
  })
}

async function serve(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AppDeps,
  handle: Handler,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const parsed = await readJsonBody(req)
    if (!parsed.ok) {
      send(res, errorResponse('invalid-request'))
      return
    }
    const apiReq: ApiRequest = {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: parsed.value,
    }
    send(res, await handle(apiReq, deps))
  } catch {
    deps.logger.error('request failed', { code: 'internal' })
    send(res, errorResponse('internal'))
  }
}

function send(res: ServerResponse, response: ApiResponse): void {
  const text = JSON.stringify(response.body)
  res.writeHead(response.status, { 'content-type': 'application/json' })
  res.end(text)
}

type BodyResult = { ok: true; value: unknown } | { ok: false }

function readJsonBody(req: IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const settle = (result: BodyResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        settle({ ok: false })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.length === 0) {
        settle({ ok: true, value: undefined })
        return
      }
      try {
        settle({ ok: true, value: JSON.parse(raw) })
      } catch {
        settle({ ok: false })
      }
    })
    req.on('error', () => settle({ ok: false }))
  })
}
