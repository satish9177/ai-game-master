import { describe, expect, it } from 'vitest'
import { createMemoryDb } from '../../persistence/testing/createTestDb'
import type { ApiRequest } from '../http'
import { createTestApp } from '../testing/createTestApp'

function request(method: string, path: string): ApiRequest {
  const url = new URL(path, 'http://localhost')
  return { method, path: url.pathname, query: url.searchParams, body: undefined }
}

describe('GET /health', () => {
  it('returns ok over a migrated database', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const res = await handle(request('GET', '/health'), deps)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ status: 'ok', persistenceSchemaVersion: 1 })
    } finally {
      close()
    }
  })

  it('404s an unknown route and 405s a wrong method', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)

      const notFound = await handle(request('GET', '/does-not-exist'), deps)
      expect(notFound.status).toBe(404)
      expect(notFound.body).toEqual({
        error: { code: 'not-found', message: 'The requested resource was not found.' },
      })

      const wrongMethod = await handle(request('POST', '/health'), deps)
      expect(wrongMethod.status).toBe(405)
      expect(wrongMethod.body).toMatchObject({ error: { code: 'method-not-allowed' } })
    } finally {
      close()
    }
  })
})
