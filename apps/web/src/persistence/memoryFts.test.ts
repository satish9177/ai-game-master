import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { NPC_MEMORY_SCHEMA_VERSION } from '../domain/memory/contracts'
import type { NpcMemoryInsert } from '../domain/memory/contracts'
import { createMemoryFtsQueryFromTokens } from '../domain/memory/ftsQuery'
import { ROOM_MEMORY_SCHEMA_VERSION } from '../domain/memory/roomContracts'
import type { RoomMemoryInsert } from '../domain/memory/roomContracts'
import { open, runMigrations } from './db'
import { migrations } from './migrations'
import { SqliteNpcMemoryStore } from './SqliteNpcMemoryStore'
import { SqliteRoomMemoryStore } from './SqliteRoomMemoryStore'
import { createCapturingLogger, createMemoryDb, silentLogger } from './testing/createTestDb'

function seedSession(db: DatabaseSync, sessionId: string, worldId = 'world-1'): void {
  db.prepare(
    `INSERT INTO world_sessions
       (session_id, world_id, schema_version, revision, snapshot_json, created_at, updated_at)
     VALUES (?, ?, 1, 1, '{}', '2026-06-23T10:00:00.000Z', '2026-06-23T10:00:00.000Z')`,
  ).run(sessionId, worldId)
}

function npcInsert(overrides: Partial<NpcMemoryInsert> = {}): NpcMemoryInsert {
  return {
    schemaVersion: NPC_MEMORY_SCHEMA_VERSION,
    memoryId: 'npc-mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    npcId: 'npc-1',
    kind: 'npc_belief',
    text: 'quiet lantern',
    provenance: { source: 'npc' },
    confidence: 'medium',
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

function roomInsert(overrides: Partial<RoomMemoryInsert> = {}): RoomMemoryInsert {
  return {
    schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
    memoryId: 'room-mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    roomId: 'room-1',
    kind: 'room_observation',
    text: 'quiet lantern',
    provenance: { source: 'npc' },
    confidence: 'medium',
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

function ftsQuery(...tokens: string[]) {
  const query = createMemoryFtsQueryFromTokens(tokens)
  if (query === null) throw new Error('test query must contain at least one safe token')
  return query
}

describe('memory FTS migration backfill', () => {
  it('backfills existing NPC and room memory rows when 0005 runs', async () => {
    const db = open(':memory:')
    try {
      runMigrations(db, migrations.filter((migration) => migration.version <= 4))
      seedSession(db, 'session-1')

      const npcRecord = { ...npcInsert({ memoryId: 'npc-old', text: 'forgotten amulet clue' }), seq: 1 }
      db.prepare(
        `INSERT INTO npc_memories
           (memory_id, world_id, session_id, npc_id, kind, seq, schema_version, memory_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        npcRecord.memoryId,
        npcRecord.worldId,
        npcRecord.sessionId,
        npcRecord.npcId,
        npcRecord.kind,
        npcRecord.seq,
        1,
        JSON.stringify(npcRecord),
        npcRecord.createdAt,
      )

      const roomRecord = { ...roomInsert({ memoryId: 'room-old', text: 'forgotten mural clue' }), seq: 1 }
      db.prepare(
        `INSERT INTO room_memories
           (memory_id, world_id, session_id, room_id, kind, seq, schema_version, memory_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        roomRecord.memoryId,
        roomRecord.worldId,
        roomRecord.sessionId,
        roomRecord.roomId,
        roomRecord.kind,
        roomRecord.seq,
        1,
        JSON.stringify(roomRecord),
        roomRecord.createdAt,
      )

      runMigrations(db)

      const npcStore = new SqliteNpcMemoryStore(db, silentLogger())
      const roomStore = new SqliteRoomMemoryStore(db, silentLogger())
      await expect(
        npcStore.searchForNpc(
          { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' },
          ftsQuery('amulet'),
        ),
      ).resolves.toMatchObject([{ memoryId: 'npc-old', text: 'forgotten amulet clue' }])
      await expect(
        roomStore.searchForRoom(
          { worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' },
          ftsQuery('mural'),
        ),
      ).resolves.toMatchObject([{ memoryId: 'room-old', text: 'forgotten mural clue' }])
    } finally {
      db.close()
    }
  })
})

describe('memory FTS live indexing', () => {
  it('indexes new NPC and room writes from validated record.text', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const npcStore = new SqliteNpcMemoryStore(db, silentLogger())
      const roomStore = new SqliteRoomMemoryStore(db, silentLogger())

      await npcStore.record(npcInsert({ memoryId: 'npc-live', text: 'silver compass under oath' }))
      await roomStore.record(roomInsert({ memoryId: 'room-live', text: 'silver compass on the table' }))

      expect(
        (
          await npcStore.searchForNpc(
            { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' },
            ftsQuery('compass'),
          )
        ).map((record) => record.memoryId),
      ).toEqual(['npc-live'])
      expect(
        (
          await roomStore.searchForRoom(
            { worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' },
            ftsQuery('compass'),
          )
        ).map((record) => record.memoryId),
      ).toEqual(['room-live'])
    } finally {
      close()
    }
  })

  it('returns base-table record bytes, not FTS row bytes', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      await store.record(npcInsert({ memoryId: 'base-source', text: 'original relic text' }))
      db.prepare(
        `INSERT INTO npc_memories_fts(text, memory_id, world_id, session_id, npc_id)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('mutated searchable token', 'base-source', 'world-1', 'session-1', 'npc-1')

      const got = await store.searchForNpc(
        { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' },
        ftsQuery('mutated'),
      )
      expect(got).toHaveLength(1)
      expect(got[0]?.text).toBe('original relic text')
    } finally {
      close()
    }
  })
})

describe('memory FTS scope isolation', () => {
  it('hard-filters NPC search by worldId + sessionId + npcId', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-a', 'world-a')
      seedSession(db, 'session-b', 'world-b')
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      await store.record(npcInsert({ memoryId: 'keep', worldId: 'world-a', sessionId: 'session-a', npcId: 'npc-1', text: 'shared keyword' }))
      await store.record(npcInsert({ memoryId: 'world', worldId: 'world-b', sessionId: 'session-a', npcId: 'npc-1', text: 'shared keyword' }))
      await store.record(npcInsert({ memoryId: 'session', worldId: 'world-a', sessionId: 'session-b', npcId: 'npc-1', text: 'shared keyword' }))
      await store.record(npcInsert({ memoryId: 'npc', worldId: 'world-a', sessionId: 'session-a', npcId: 'npc-2', text: 'shared keyword' }))

      const got = await store.searchForNpc(
        { worldId: 'world-a', sessionId: 'session-a', npcId: 'npc-1' },
        ftsQuery('shared'),
      )
      expect(got.map((record) => record.memoryId)).toEqual(['keep'])
    } finally {
      close()
    }
  })

  it('hard-filters room search by worldId + sessionId + roomId', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-a', 'world-a')
      seedSession(db, 'session-b', 'world-b')
      const store = new SqliteRoomMemoryStore(db, silentLogger())
      await store.record(roomInsert({ memoryId: 'keep', worldId: 'world-a', sessionId: 'session-a', roomId: 'room-1', text: 'shared keyword' }))
      await store.record(roomInsert({ memoryId: 'world', worldId: 'world-b', sessionId: 'session-a', roomId: 'room-1', text: 'shared keyword' }))
      await store.record(roomInsert({ memoryId: 'session', worldId: 'world-a', sessionId: 'session-b', roomId: 'room-1', text: 'shared keyword' }))
      await store.record(roomInsert({ memoryId: 'room', worldId: 'world-a', sessionId: 'session-a', roomId: 'room-2', text: 'shared keyword' }))

      const got = await store.searchForRoom(
        { worldId: 'world-a', sessionId: 'session-a', roomId: 'room-1' },
        ftsQuery('shared'),
      )
      expect(got.map((record) => record.memoryId)).toEqual(['keep'])
    } finally {
      close()
    }
  })
})

describe('memory FTS ordering and filtering', () => {
  it('orders deterministic equal-rank NPC matches by bm25 asc, then seq desc', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      await store.record(npcInsert({ memoryId: 'a', text: 'amber token' }))
      await store.record(npcInsert({ memoryId: 'b', text: 'amber token' }))
      await store.record(npcInsert({ memoryId: 'c', text: 'amber token' }))

      const first = await store.searchForNpc(
        { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' },
        ftsQuery('amber'),
      )
      const second = await store.searchForNpc(
        { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' },
        ftsQuery('amber'),
      )
      expect(first.map((record) => record.memoryId)).toEqual(['c', 'b', 'a'])
      expect(second).toEqual(first)
    } finally {
      close()
    }
  })

  it('skips corrupt or JSON-scope-mismatched base rows without leaking text', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const { logger, entries } = createCapturingLogger()
      const store = new SqliteRoomMemoryStore(db, logger)
      await store.record(roomInsert({ memoryId: 'good', text: 'visible cipher' }))

      const secret = 'SECRET-SCOPE-MISMATCH-CIPHER'
      const mismatched = { ...roomInsert({ memoryId: 'bad', roomId: 'other-room', text: secret }), seq: 2 }
      db.prepare(
        `INSERT INTO room_memories
           (memory_id, world_id, session_id, room_id, kind, seq, schema_version, memory_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'bad',
        'world-1',
        'session-1',
        'room-1',
        'room_observation',
        2,
        1,
        JSON.stringify(mismatched),
        '2026-06-23T10:00:00.000Z',
      )
      db.prepare(
        `INSERT INTO room_memories_fts(text, memory_id, world_id, session_id, room_id)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(secret, 'bad', 'world-1', 'session-1', 'room-1')

      const got = await store.searchForRoom(
        { worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' },
        ftsQuery('cipher'),
      )
      expect(got.map((record) => record.memoryId)).toEqual(['good'])
      const serialized = JSON.stringify(entries)
      expect(serialized).toContain('invalid-stored-memory')
      expect(serialized).not.toContain(secret)
    } finally {
      close()
    }
  })
})

describe('memory FTS preserves base table immutability', () => {
  it('keeps the NPC memory no-update trigger intact', async () => {
    const { db, close } = createMemoryDb()
    try {
      seedSession(db, 'session-1')
      const store = new SqliteNpcMemoryStore(db, silentLogger())
      await store.record(npcInsert({ memoryId: 'immutable', text: 'locked text' }))
      expect(() =>
        db.prepare(`UPDATE npc_memories SET kind = 'player_claim' WHERE memory_id = ?`).run('immutable'),
      ).toThrow(/immutable/i)
    } finally {
      close()
    }
  })
})
