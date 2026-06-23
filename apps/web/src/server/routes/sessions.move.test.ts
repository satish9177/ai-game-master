import { describe, expect, it } from 'vitest'
import type { WorldEvent } from '../../domain/world/events'
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

const createBody = {
  name: 'SECRET-MOVE-WORLD-NAME',
  startingRoomId: 'gatehouse',
  initialPlayer: {
    health: { current: 8, max: 10 },
    status: ['SECRET-MOVE-STATUS'],
    inventory: [{ itemId: 'water', name: 'SECRET-MOVE-ITEM-NAME', quantity: 1 }],
  },
}

function request(method: string, path: string, body?: unknown): ApiRequest {
  const url = new URL(path, 'http://localhost')
  return { method, path: url.pathname, query: url.searchParams, body }
}

async function startSession(
  handle: Handler,
  deps: AppDeps,
): Promise<{ sessionId: string; state: WorldState }> {
  const response = await handle(request('POST', '/sessions', createBody), deps)
  expect(response.status).toBe(201)
  return response.body as { sessionId: string; state: WorldState }
}

function expectApiError(response: ApiResponse, status: number, code: string): void {
  expect(response.status).toBe(status)
  expect(response.body).toMatchObject({ error: { code } })
}

describe('POST /sessions/:sessionId/move', () => {
  it('moves to an unchecked target room and durably returns revision 2 state and event', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const started = await startSession(handle, deps)
      const targetRoomId = 'unpersisted-vault'

      const response = await handle(
        request('POST', `/sessions/${started.sessionId}/move`, {
          toRoomId: targetRoomId,
          expectedRevision: 1,
          fromRoomId: 'gatehouse',
        }),
        deps,
      )

      expect(response.status).toBe(200)
      const body = response.body as { state: WorldState; event: WorldEvent }
      expect(body.state).toMatchObject({
        sessionId: started.sessionId,
        currentRoomId: targetRoomId,
        revision: 2,
        roomStates: {
          gatehouse: { visited: true },
          [targetRoomId]: { visited: true },
        },
      })
      expect(body.event).toMatchObject({
        sessionId: started.sessionId,
        seq: 2,
        type: 'moved-to-room',
        payload: { fromRoomId: 'gatehouse', toRoomId: targetRoomId },
      })

      const stateResponse = await handle(
        request('GET', `/sessions/${started.sessionId}/state`),
        deps,
      )
      expect(stateResponse).toEqual({ status: 200, body: { state: body.state } })

      const eventsResponse = await handle(
        request('GET', `/sessions/${started.sessionId}/events?sinceSeq=1`),
        deps,
      )
      expect(eventsResponse).toEqual({ status: 200, body: { events: [body.event] } })
    } finally {
      close()
    }
  })

  it('returns 409 for a stale expectedRevision and appends nothing', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const started = await startSession(handle, deps)
      await handle(
        request('POST', `/sessions/${started.sessionId}/move`, {
          toRoomId: 'yard',
          expectedRevision: 1,
        }),
        deps,
      )

      const stale = await handle(
        request('POST', `/sessions/${started.sessionId}/move`, {
          toRoomId: 'tower',
          expectedRevision: 1,
        }),
        deps,
      )
      expectApiError(stale, 409, 'conflict')

      const events = await handle(
        request('GET', `/sessions/${started.sessionId}/events`),
        deps,
      )
      expect((events.body as { events: WorldEvent[] }).events).toHaveLength(2)
    } finally {
      close()
    }
  })

  it('returns 404 when the session does not exist', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const response = await handle(
        request('POST', `/sessions/${MISSING_SESSION_ID}/move`, {
          toRoomId: 'yard',
          expectedRevision: 1,
        }),
        deps,
      )
      expectApiError(response, 404, 'not-found')
    } finally {
      close()
    }
  })

  it('returns 400 when fromRoomId does not match the current room', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const started = await startSession(handle, deps)
      const response = await handle(
        request('POST', `/sessions/${started.sessionId}/move`, {
          toRoomId: 'yard',
          expectedRevision: 1,
          fromRoomId: 'wrong-current-room',
        }),
        deps,
      )
      expectApiError(response, 400, 'invalid-request')

      const state = await handle(
        request('GET', `/sessions/${started.sessionId}/state`),
        deps,
      )
      expect((state.body as { state: WorldState }).state).toMatchObject({
        currentRoomId: 'gatehouse',
        revision: 1,
      })
    } finally {
      close()
    }
  })

  it('returns 400 for invalid path parameters and request bodies', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const started = await startSession(handle, deps)
      const invalidBodies: unknown[] = [
        undefined,
        { toRoomId: '', expectedRevision: 1 },
        { toRoomId: 'yard', expectedRevision: 0 },
        { toRoomId: 'yard', expectedRevision: 1.5 },
        { toRoomId: 'yard', expectedRevision: '1' },
        { toRoomId: 'yard', expectedRevision: 1, fromRoomId: '' },
        { toRoomId: 'yard', expectedRevision: 1, extra: true },
      ]

      for (const body of invalidBodies) {
        const response = await handle(
          request('POST', `/sessions/${started.sessionId}/move`, body),
          deps,
        )
        expectApiError(response, 400, 'invalid-request')
      }

      const invalidSessionId = await handle(
        request('POST', '/sessions/not-a-uuid/move', {
          toRoomId: 'yard',
          expectedRevision: 1,
        }),
        deps,
      )
      expectApiError(invalidSessionId, 400, 'invalid-request')
    } finally {
      close()
    }
  })

  it('keeps move logs to safe ids, revisions, event types, routes, and codes', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { logger, entries } = createCapturingLogger()
      const { deps, handle } = createTestApp(db, logger)
      const started = await startSession(handle, deps)
      await handle(
        request('POST', `/sessions/${started.sessionId}/move`, {
          toRoomId: 'SECRET-MOVE-TARGET-ID',
          expectedRevision: 1,
          fromRoomId: 'gatehouse',
        }),
        deps,
      )
      await handle(
        request('POST', `/sessions/${started.sessionId}/move`, {
          toRoomId: 'another-room',
          expectedRevision: 1,
        }),
        deps,
      )

      const logs = JSON.stringify(entries)
      expect(logs).not.toContain('SECRET-MOVE-WORLD-NAME')
      expect(logs).not.toContain('SECRET-MOVE-STATUS')
      expect(logs).not.toContain('SECRET-MOVE-ITEM-NAME')
      expect(logs).not.toContain('SECRET-MOVE-TARGET-ID')

      const allowedContextKeys = new Set([
        'code',
        'eventId',
        'eventType',
        'expectedRevision',
        'revision',
        'route',
        'seq',
        'sessionId',
        'worldId',
      ])
      for (const entry of entries) {
        expect(Object.keys(entry.context).every((key) => allowedContextKeys.has(key))).toBe(true)
      }
    } finally {
      close()
    }
  })
})
