import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { createMemoryDb, silentLogger } from '../persistence/testing/createTestDb'
import { buildDeps } from './bootstrap'
import { createServer } from './createServer'
import { createRouter } from './router'
import { healthRoutes } from './routes/health'

/**
 * Real-socket smoke test (ADR-0019): bind the server to an ephemeral port and
 * hit it with a real `fetch`, proving the `node:http` glue and JSON I/O — not
 * just the handler in isolation.
 */
describe('createServer (real socket)', () => {
  it('serves GET /health over HTTP', async () => {
    const { db, close } = createMemoryDb()
    const deps = buildDeps(db, silentLogger())
    const server = createServer(deps, createRouter(healthRoutes))
    await new Promise<void>((resolve) => server.listen(0, resolve))
    try {
      const { port } = server.address() as AddressInfo
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      await expect(res.json()).resolves.toEqual({ status: 'ok', persistenceSchemaVersion: 1 })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      close()
    }
  })
})
