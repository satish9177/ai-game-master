import { describe, expect, it } from 'vitest'
import { RoomSpecSchema } from '../../domain/roomSpec'
import type { RoomSpec } from '../../domain/roomSpec'
import {
  createCapturingLogger,
  createMemoryDb,
} from '../../persistence/testing/createTestDb'
import type { ApiRequest, ApiResponse } from '../http'
import { createTestApp } from '../testing/createTestApp'

const validRoom = RoomSpecSchema.parse({
  schemaVersion: 1,
  id: 'api-room',
  name: 'SECRET-VALID-ROOM-NAME',
  shell: {
    dimensions: { width: 10, depth: 8, height: 4 },
  },
  spawn: { position: [0, 0, 0] },
  objects: [],
})

function request(method: string, path: string, body?: unknown): ApiRequest {
  const url = new URL(path, 'http://localhost')
  return { method, path: url.pathname, query: url.searchParams, body }
}

function expectApiError(response: ApiResponse, status: number, code: string): void {
  expect(response.status).toBe(status)
  expect(response.body).toMatchObject({ error: { code } })
}

describe('room routes', () => {
  it('saves and loads validated RoomSpec data through SQLite', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const saved = await handle(request('PUT', `/rooms/${validRoom.id}`, validRoom), deps)
      expect(saved).toEqual({
        status: 200,
        body: { ok: true, roomId: validRoom.id },
      })

      const loaded = await handle(request('GET', `/rooms/${validRoom.id}`), deps)
      expect(loaded).toEqual({
        status: 200,
        body: { room: validRoom, warnings: 0 },
      })
      expect(
        RoomSpecSchema.safeParse((loaded.body as { room: unknown }).room).success,
      ).toBe(true)
    } finally {
      close()
    }
  })

  it('returns 400 when the body id does not match the path id', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const response = await handle(request('PUT', '/rooms/different-id', validRoom), deps)
      expectApiError(response, 400, 'room-id-mismatch')
    } finally {
      close()
    }
  })

  it('returns 400 for an invalid RoomSpec without echoing its values', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const secretInvalidValue = 'SECRET-INVALID-ROOM-VALUE'
      const response = await handle(
        request('PUT', '/rooms/invalid-room', {
          schemaVersion: 1,
          id: 'invalid-room',
          name: secretInvalidValue,
          shell: { dimensions: { width: -1, depth: 8, height: 4 } },
          spawn: { position: [0, 0, 0] },
          objects: [],
        }),
        deps,
      )
      expectApiError(response, 400, 'invalid-room')
      expect(JSON.stringify(response.body)).not.toContain(secretInvalidValue)
    } finally {
      close()
    }
  })

  it('returns 404 for a missing room', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { deps, handle } = createTestApp(db)
      const response = await handle(request('GET', '/rooms/missing-room'), deps)
      expectApiError(response, 404, 'not-found')
    } finally {
      close()
    }
  })

  it('maps corrupt stored room data to a safe 500 without leaking internals', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { logger, entries } = createCapturingLogger()
      const { deps, handle } = createTestApp(db, logger)
      const corruptText = 'SECRET-CORRUPT-STORED-ROOM'
      db.prepare(
        `INSERT INTO rooms
           (room_id, schema_version, name, spec_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        'corrupt-room',
        1,
        'Corrupt',
        corruptText,
        '2026-06-23T00:00:00.000Z',
        '2026-06-23T00:00:00.000Z',
      )

      const response = await handle(request('GET', '/rooms/corrupt-room'), deps)
      expect(response).toEqual({
        status: 500,
        body: { error: { code: 'internal', message: 'An unexpected error occurred.' } },
      })

      const responseText = JSON.stringify(response.body)
      const logs = JSON.stringify(entries)
      for (const unsafe of [corruptText, 'spec_json', 'SELECT ', 'stack']) {
        expect(responseText).not.toContain(unsafe)
        expect(logs).not.toContain(unsafe)
      }
    } finally {
      close()
    }
  })

  it('returns only valid objects and a warning count, never skipped raw content', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { logger, entries } = createCapturingLogger()
      const { deps, handle } = createTestApp(db, logger)
      const rawType = 'SECRET-UNSAFE-OBJECT-TYPE'
      const rawContent = 'SECRET-RAW-SKIPPED-CONTENT'
      const room: RoomSpec = {
        ...validRoom,
        id: 'room-with-skipped-object',
        name: 'SECRET-SKIPPED-ROOM-NAME',
        objects: [
          { type: 'prop', position: [0, 0, 0] },
          { type: rawType, narrative: rawContent },
        ],
      }

      const saved = await handle(request('PUT', `/rooms/${room.id}`, room), deps)
      expect(saved.status).toBe(200)
      const loaded = await handle(request('GET', `/rooms/${room.id}`), deps)

      expect(loaded.status).toBe(200)
      const body = loaded.body as { room: RoomSpec; warnings: number }
      expect(body.warnings).toBe(1)
      expect(body.room.objects).toHaveLength(1)
      expect(body.room.objects[0]).toMatchObject({ type: 'prop' })
      expect('skipped' in body.room).toBe(false)

      const responseText = JSON.stringify(loaded.body)
      const logs = JSON.stringify(entries)
      expect(responseText).not.toContain(rawType)
      expect(responseText).not.toContain(rawContent)
      expect(logs).not.toContain(rawType)
      expect(logs).not.toContain(rawContent)
      expect(logs).not.toContain(room.name)

      const allowedContextKeys = new Set(['code', 'roomId', 'route', 'warningCount'])
      for (const entry of entries) {
        expect(Object.keys(entry.context).every((key) => allowedContextKeys.has(key))).toBe(true)
      }
    } finally {
      close()
    }
  })
})
