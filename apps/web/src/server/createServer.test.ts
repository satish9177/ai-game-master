import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { createMemoryDb, silentLogger } from '../persistence/testing/createTestDb'
import { buildDeps } from './bootstrap'
import { createServer } from './createServer'
import { createRouter } from './router'
import { healthRoutes } from './routes/health'
import { sessionRoutes } from './routes/sessions'

/**
 * Real-socket smoke test (ADR-0019): bind the server to an ephemeral port and
 * hit it with a real `fetch`, proving the `node:http` glue and JSON I/O — not
 * just the handler in isolation.
 */
describe('createServer (real socket)', () => {
  it('serves health and session creation over HTTP', async () => {
    const { db, close } = createMemoryDb()
    const deps = buildDeps(db, silentLogger())
    const server = createServer(deps, createRouter([...healthRoutes, ...sessionRoutes]))
    await new Promise<void>((resolve) => server.listen(0, resolve))
    try {
      const { port } = server.address() as AddressInfo
      const healthResponse = await fetch(`http://127.0.0.1:${port}/health`)
      expect(healthResponse.status).toBe(200)
      expect(healthResponse.headers.get('content-type')).toContain('application/json')
      await expect(healthResponse.json()).resolves.toEqual({
        status: 'ok',
        persistenceSchemaVersion: 1,
      })

      const createResponse = await fetch(`http://127.0.0.1:${port}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Socket World',
          startingRoomId: 'start',
          initialPlayer: { health: { current: 5, max: 5 } },
        }),
      })
      expect(createResponse.status).toBe(201)
      const created = (await createResponse.json()) as {
        sessionId: string
        state: { sessionId: string; revision: number }
      }
      expect(created.state).toMatchObject({ sessionId: created.sessionId, revision: 1 })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      close()
    }
  })
})
