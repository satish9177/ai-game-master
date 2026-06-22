import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { throneRoom } from '../domain/examples/throneRoom'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { RoomSpecSchema } from '../domain/roomSpec'
import type { RoomSpec } from '../domain/roomSpec'
import { open } from './db'
import { SqliteRoomStore } from './SqliteRoomStore'
import { createCapturingLogger, createMemoryDb, createTempFileDb, silentLogger } from './testing/createTestDb'

const baseSpec = RoomSpecSchema.parse(throneRoom)

function specWith(overrides: Partial<RoomSpec>): RoomSpec {
  return { ...baseSpec, ...overrides }
}

describe('SqliteRoomStore — save / load', () => {
  it('saves a validated RoomSpec and loads a loadRoomSpec-equal room', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteRoomStore(db, silentLogger())
      expect(await store.saveRoom(baseSpec)).toEqual({ ok: true })

      const got = await store.getRoom(baseSpec.id)
      expect(got.ok).toBe(true)
      if (got.ok) expect(got.room).toEqual(loadRoomSpec(baseSpec))
    } finally {
      close()
    }
  })

  it('returns a typed not-found for an unknown room id', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteRoomStore(db, silentLogger())
      expect(await store.getRoom('no-such-room')).toEqual({ ok: false, reason: 'not-found' })
    } finally {
      close()
    }
  })
})

describe('SqliteRoomStore — corrupt stored room', () => {
  it('maps invalid stored JSON to invalid-stored-room', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteRoomStore(db, silentLogger())
      db.prepare(
        `INSERT INTO rooms (room_id, schema_version, name, spec_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('broken', 1, 'Broken', '{ not valid json', '2026-06-22T10:00:00.000Z', '2026-06-22T10:00:00.000Z')
      expect(await store.getRoom('broken')).toEqual({ ok: false, reason: 'invalid-stored-room' })
    } finally {
      close()
    }
  })

  it('maps a JSON-valid but schema-invalid stored spec to invalid-stored-room', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteRoomStore(db, silentLogger())
      db.prepare(
        `INSERT INTO rooms (room_id, schema_version, name, spec_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('shape', 1, 'Shape', '{"not":"a room"}', '2026-06-22T10:00:00.000Z', '2026-06-22T10:00:00.000Z')
      expect(await store.getRoom('shape')).toEqual({ ok: false, reason: 'invalid-stored-room' })
    } finally {
      close()
    }
  })
})

describe('SqliteRoomStore — upsert (last-writer-wins)', () => {
  it('re-saving the same id replaces the document and keeps a single row', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteRoomStore(db, silentLogger())
      await store.saveRoom(specWith({ id: 'dup', name: 'First Name' }))
      await store.saveRoom(specWith({ id: 'dup', name: 'Second Name' }))

      const got = await store.getRoom('dup')
      expect(got.ok && got.room.name).toBe('Second Name')
      const count = db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE room_id = ?').get('dup')
      expect(Number(count?.n)).toBe(1)
    } finally {
      close()
    }
  })
})

describe('SqliteRoomStore — isolation', () => {
  it('keeps distinct rooms separate and unknown ids not-found', async () => {
    const { db, close } = createMemoryDb()
    try {
      const store = new SqliteRoomStore(db, silentLogger())
      await store.saveRoom(specWith({ id: 'room-a', name: 'Alpha' }))
      await store.saveRoom(specWith({ id: 'room-b', name: 'Beta' }))

      const a = await store.getRoom('room-a')
      const b = await store.getRoom('room-b')
      expect(a.ok && a.room.id).toBe('room-a')
      expect(b.ok && b.room.id).toBe('room-b')
      expect(await store.getRoom('room-c')).toEqual({ ok: false, reason: 'not-found' })
    } finally {
      close()
    }
  })
})

describe('SqliteRoomStore — durability', () => {
  const paths: string[] = []
  afterEach(() => {
    for (const path of paths.splice(0)) {
      rmSync(path, { force: true })
      rmSync(`${path}-wal`, { force: true })
      rmSync(`${path}-shm`, { force: true })
    }
  })

  it('returns the persisted room after reopening the file', async () => {
    const { db, path } = createTempFileDb()
    paths.push(path)
    const store = new SqliteRoomStore(db, silentLogger())
    await store.saveRoom(specWith({ id: 'persisted', name: 'Persisted Room' }))
    db.close()

    const reopened = open(path)
    try {
      const store2 = new SqliteRoomStore(reopened, silentLogger())
      const got = await store2.getRoom('persisted')
      expect(got.ok && got.room.id).toBe('persisted')
      expect(got.ok && got.room.name).toBe('Persisted Room')
    } finally {
      reopened.close()
    }
  })
})

describe('SqliteRoomStore — log safety', () => {
  it('logs only roomId/code, never the room name or spec content', async () => {
    const { db, close } = createMemoryDb()
    try {
      const { logger, entries } = createCapturingLogger()
      const store = new SqliteRoomStore(db, logger)
      await store.saveRoom(specWith({ id: 'secret-room', name: 'SECRET-ROOM-NAME' }))
      await store.getRoom('secret-room')
      await store.getRoom('missing')

      const serialized = JSON.stringify(entries)
      expect(serialized).not.toContain('SECRET-ROOM-NAME')
      expect(serialized).toContain('secret-room')
    } finally {
      close()
    }
  })
})
