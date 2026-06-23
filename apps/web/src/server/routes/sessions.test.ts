import { describe, expect, it } from 'vitest'
import type { WorldEvent } from '../../domain/world/events'
import { UuidSchema } from '../../domain/world/worldState'
import type { WorldState } from '../../domain/world/worldState'
import {
  createCapturingLogger,
  createMemoryDb,
} from '../../persistence/testing/createTestDb'
import type { AppDeps } from '../bootstrap'
import type { ApiRequest, ApiResponse } from '../http'
import type { Handler } from '../router'
import { createTestApp } from '../testing/createTestApp'

const MISSING_SESSION_ID = '00000000-0000-4000-8000-000000000099'

const validBody = {
  name: 'SECRET-WORLD-NAME',
  startingRoomId: 'gatehouse',
  initialPlayer: {
    health: { current: 8, max: 10 },
    status: ['SECRET-STATUS'],
    inventory: [{ itemId: 'water', name: 'SECRET-ITEM-NAME', quantity: 2 }],
  },
}

function request(method: string, path: string, body?: unknown): ApiRequest {
  const url = new URL(path, 'http://localhost')
  return { method, path: url.pathname, query: url.searchParams, body }
}

async function createSession(handle: Handler, deps: AppDeps): Promise<{
  response: ApiResponse
  sessionId: string
  state: WorldState
}> {
  const response = await handle(request('POST', '/sessions', validBody), deps)
  const body = response.body as { sessionId: string; state: WorldState }
  return { response, sessionId: body.sessionId, state: body.state }
}

describe('session routes', () => {
  it('creates a durable session and returns its state and event log with sinceSeq filtering', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const created = await createSession(handle, deps)

      expect(created.response.status).toBe(201)
      expect(UuidSchema.safeParse(created.sessionId).success).toBe(true)
      expect(UuidSchema.safeParse(created.state.worldId).success).toBe(true)
      expect(created.state).toMatchObject({
        schemaVersion: 1,
        sessionId: created.sessionId,
        currentRoomId: 'gatehouse',
        revision: 1,
        player: {
          health: { current: 8, max: 10 },
          status: ['SECRET-STATUS'],
        },
        inventory: [{ itemId: 'water', name: 'SECRET-ITEM-NAME', quantity: 2 }],
      })

      const stateResponse = await handle(
        request('GET', `/sessions/${created.sessionId}/state`),
        deps,
      )
      expect(stateResponse).toEqual({ status: 200, body: { state: created.state } })

      const eventsResponse = await handle(
        request('GET', `/sessions/${created.sessionId}/events`),
        deps,
      )
      expect(eventsResponse.status).toBe(200)
      const events = (eventsResponse.body as { events: WorldEvent[] }).events
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        schemaVersion: 1,
        sessionId: created.sessionId,
        seq: 1,
        type: 'session-started',
        payload: {
          seed: {
            schemaVersion: 1,
            worldId: created.state.worldId,
            name: validBody.name,
          },
        },
      })

      const afterZero = await handle(
        request('GET', `/sessions/${created.sessionId}/events?sinceSeq=0`),
        deps,
      )
      expect((afterZero.body as { events: WorldEvent[] }).events).toHaveLength(1)

      const afterOne = await handle(
        request('GET', `/sessions/${created.sessionId}/events?sinceSeq=1`),
        deps,
      )
      expect(afterOne).toEqual({ status: 200, body: { events: [] } })
    } finally {
      close()
    }
  })

  it('defaults optional player arrays and rejects invalid or server-owned body fields', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const minimal = await handle(
        request('POST', '/sessions', {
          name: 'Minimal',
          startingRoomId: 'start',
          initialPlayer: { health: { current: 1, max: 1 } },
        }),
        deps,
      )
      expect(minimal.status).toBe(201)
      expect((minimal.body as { state: WorldState }).state).toMatchObject({
        player: { status: [] },
        inventory: [],
      })

      const invalidBodies: unknown[] = [
        undefined,
        { ...validBody, name: '' },
        {
          ...validBody,
          initialPlayer: { ...validBody.initialPlayer, health: { current: 11, max: 10 } },
        },
        {
          ...validBody,
          worldId: '00000000-0000-4000-8000-000000000001',
        },
        {
          ...validBody,
          initialPlayer: {
            ...validBody.initialPlayer,
            inventory: [
              { itemId: 'same', name: 'One', quantity: 1 },
              { itemId: 'same', name: 'Two', quantity: 1 },
            ],
          },
        },
      ]

      for (const body of invalidBodies) {
        const response = await handle(request('POST', '/sessions', body), deps)
        expect(response.status).toBe(400)
        expect(response.body).toEqual({
          error: { code: 'invalid-request', message: 'The request was invalid.' },
        })
      }
    } finally {
      close()
    }
  })

  it('validates session ids and sinceSeq before touching the application layer', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const invalidIdState = await handle(request('GET', '/sessions/not-a-uuid/state'), deps)
      expect(invalidIdState.status).toBe(400)
      expect(invalidIdState.body).toMatchObject({ error: { code: 'invalid-request' } })

      const invalidQueries = [
        'sinceSeq=',
        'sinceSeq=-1',
        'sinceSeq=1.5',
        'sinceSeq=abc',
        'sinceSeq=9007199254740992',
        'sinceSeq=0&sinceSeq=1',
        'other=1',
      ]
      for (const query of invalidQueries) {
        const response = await handle(
          request('GET', `/sessions/${MISSING_SESSION_ID}/events?${query}`),
          deps,
        )
        expect(response.status).toBe(400)
        expect(response.body).toMatchObject({ error: { code: 'invalid-request' } })
      }
    } finally {
      close()
    }
  })

  it('returns typed 404 errors for missing session state and events', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      for (const suffix of ['state', 'events']) {
        const response = await handle(
          request('GET', `/sessions/${MISSING_SESSION_ID}/${suffix}`),
          deps,
        )
        expect(response.status).toBe(404)
        expect(response.body).toMatchObject({ error: { code: 'not-found' } })
      }
    } finally {
      close()
    }
  })

  it('maps corrupt stored session data to a safe internal error', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const created = await createSession(handle, deps)
      const corruptText = 'SECRET-CORRUPT-ROW-TEXT'
      db.prepare('UPDATE world_sessions SET snapshot_json = ? WHERE session_id = ?').run(
        corruptText,
        created.sessionId,
      )

      const response = await handle(
        request('GET', `/sessions/${created.sessionId}/state`),
        deps,
      )
      expect(response.status).toBe(500)
      expect(response.body).toEqual({
        error: { code: 'internal', message: 'An unexpected error occurred.' },
      })
      expect(JSON.stringify(response.body)).not.toContain(corruptText)
    } finally {
      close()
    }
  })

  it('never logs request body story content', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { logger, entries } = createCapturingLogger()
      const { deps, handle } = createTestApp(db, logger)
      const created = await createSession(handle, deps)
      await handle(request('GET', `/sessions/${created.sessionId}/state`), deps)
      await handle(request('GET', `/sessions/${created.sessionId}/events`), deps)

      const logs = JSON.stringify(entries)
      expect(logs).not.toContain('SECRET-WORLD-NAME')
      expect(logs).not.toContain('SECRET-STATUS')
      expect(logs).not.toContain('SECRET-ITEM-NAME')
      expect(logs).toContain(created.sessionId)
    } finally {
      close()
    }
  })
})
