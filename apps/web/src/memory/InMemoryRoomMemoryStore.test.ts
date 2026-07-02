import { describe, expect, it } from 'vitest'
import { ROOM_MEMORY_SCHEMA_VERSION } from '../domain/memory/roomContracts'
import type { RoomMemoryInsert, RoomMemoryRecord } from '../domain/memory/roomContracts'
import { InMemoryRoomMemoryStore } from './InMemoryRoomMemoryStore'

function insert(overrides: Partial<RoomMemoryInsert> = {}): RoomMemoryInsert {
  return {
    schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
    memoryId: 'mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    roomId: 'room-1',
    kind: 'room_observation',
    text: 'aaa',
    provenance: { source: 'npc' },
    confidence: 'low',
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

function record(overrides: Partial<RoomMemoryRecord> = {}): RoomMemoryRecord {
  return { ...insert(), seq: 1, ...overrides }
}

describe('InMemoryRoomMemoryStore.record', () => {
  it('assigns seq starting at 1, monotonic per (session, room)', async () => {
    const store = new InMemoryRoomMemoryStore()
    const a = await store.record(insert({ memoryId: 'a' }))
    const b = await store.record(insert({ memoryId: 'b' }))
    expect(a.ok && a.record.seq).toBe(1)
    expect(b.ok && b.record.seq).toBe(2)
  })

  it('keeps independent seq counters across rooms and sessions', async () => {
    const store = new InMemoryRoomMemoryStore()
    await store.record(insert({ memoryId: 'a', roomId: 'room-1' }))
    const room2 = await store.record(insert({ memoryId: 'b', roomId: 'room-2' }))
    const otherSession = await store.record(insert({ memoryId: 'c', sessionId: 'session-2' }))
    expect(room2.ok && room2.record.seq).toBe(1)
    expect(otherSession.ok && otherSession.record.seq).toBe(1)
  })
})

describe('InMemoryRoomMemoryStore.listForRoom', () => {
  it('returns scope-filtered records, seq desc, bounded by limit', async () => {
    const store = new InMemoryRoomMemoryStore()
    await store.record(insert({ memoryId: 'a' }))
    await store.record(insert({ memoryId: 'b' }))
    await store.record(insert({ memoryId: 'c' }))

    const got = await store.listForRoom(
      { worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' },
      { limit: 2 },
    )
    expect(got.map((r) => r.seq)).toEqual([3, 2])
  })

  it('isolates scope: no cross-world/session/room leak', async () => {
    const store = new InMemoryRoomMemoryStore()
    await store.record(insert({ memoryId: 'keep', worldId: 'wA', sessionId: 'sA', roomId: 'r1' }))
    await store.record(insert({ memoryId: 'w', worldId: 'wB', sessionId: 'sA', roomId: 'r1' }))
    await store.record(insert({ memoryId: 's', worldId: 'wA', sessionId: 'sB', roomId: 'r1' }))
    await store.record(insert({ memoryId: 'r', worldId: 'wA', sessionId: 'sA', roomId: 'r2' }))

    const got = await store.listForRoom({ worldId: 'wA', sessionId: 'sA', roomId: 'r1' })
    expect(got.map((r) => r.memoryId)).toEqual(['keep'])
  })

  it('returns [] for an unknown scope', async () => {
    const store = new InMemoryRoomMemoryStore()
    await store.record(insert())
    const got = await store.listForRoom({ worldId: 'world-1', sessionId: 'nope', roomId: 'room-1' })
    expect(got).toEqual([])
  })

  it('returns copies — mutating a returned record does not affect the store', async () => {
    const store = new InMemoryRoomMemoryStore()
    await store.record(insert({ memoryId: 'a', text: 'original' }))
    const first = await store.listForRoom({ worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' })
    first[0]!.text = 'mutated'
    const second = await store.listForRoom({ worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' })
    expect(second[0]!.text).toBe('original')
  })
})

describe('InMemoryRoomMemoryStore — dedupe (Slice C3)', () => {
  it('a repeated dedupeKey returns the original record with deduplicated:true, no second row', async () => {
    const store = new InMemoryRoomMemoryStore()
    const first = await store.record(insert({ memoryId: 'a', dedupeKey: 'evt-1' }))
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await store.record(insert({ memoryId: 'b', dedupeKey: 'evt-1' }))
    expect(second).toEqual({ ok: true, record: first.record, deduplicated: true })

    const got = await store.listForRoom({ worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' })
    expect(got).toHaveLength(1)
  })

  it('different dedupeKeys each insert their own row', async () => {
    const store = new InMemoryRoomMemoryStore()
    const a = await store.record(insert({ memoryId: 'a', dedupeKey: 'evt-1' }))
    const b = await store.record(insert({ memoryId: 'b', dedupeKey: 'evt-2' }))
    expect(a.ok && a.record.seq).toBe(1)
    expect(b.ok && 'deduplicated' in b).toBe(false)
    expect(b.ok && b.record.seq).toBe(2)
  })

  it('an absent dedupeKey preserves today’s behavior (no pre-check, two rows)', async () => {
    const store = new InMemoryRoomMemoryStore()
    const a = await store.record(insert({ memoryId: 'a' }))
    const b = await store.record(insert({ memoryId: 'b' }))
    expect(a.ok && 'deduplicated' in a).toBe(false)
    expect(b.ok && 'deduplicated' in b).toBe(false)
    const got = await store.listForRoom({ worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' })
    expect(got).toHaveLength(2)
  })
})

describe('InMemoryRoomMemoryStore.snapshotAll (Slice 4)', () => {
  it('returns every record in deterministic order regardless of insertion order', async () => {
    const store = new InMemoryRoomMemoryStore()
    await store.record(insert({ memoryId: 'b', roomId: 'room-2', worldId: 'world-1' }))
    await store.record(insert({ memoryId: 'a', roomId: 'room-1', worldId: 'world-1' }))
    await store.record(insert({ memoryId: 'c', roomId: 'room-1', worldId: 'world-0' }))

    const snapshot = store.snapshotAll()
    expect(snapshot.map((r) => r.memoryId)).toEqual(['c', 'a', 'b'])
  })

  it('is stable across repeated calls (order does not depend on call order)', async () => {
    const store = new InMemoryRoomMemoryStore()
    await store.record(insert({ memoryId: 'a' }))
    await store.record(insert({ memoryId: 'b' }))
    expect(store.snapshotAll()).toEqual(store.snapshotAll())
  })

  it('returns copies — mutating a returned record does not affect the store', async () => {
    const store = new InMemoryRoomMemoryStore()
    await store.record(insert({ memoryId: 'a', text: 'original' }))
    const snapshot = store.snapshotAll()
    snapshot[0]!.text = 'mutated'
    expect(store.snapshotAll()[0]!.text).toBe('original')
  })

  it('returns [] for an empty store', () => {
    const store = new InMemoryRoomMemoryStore()
    expect(store.snapshotAll()).toEqual([])
  })
})

describe('InMemoryRoomMemoryStore.restoreAll (Slice 4)', () => {
  it('replaces existing records', async () => {
    const store = new InMemoryRoomMemoryStore()
    await store.record(insert({ memoryId: 'old' }))

    store.restoreAll([record({ memoryId: 'restored', seq: 1 })])

    const got = await store.listForRoom({ worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' })
    expect(got.map((r) => r.memoryId)).toEqual(['restored'])
  })

  it('clears the store when restoring an empty list', async () => {
    const store = new InMemoryRoomMemoryStore()
    await store.record(insert({ memoryId: 'old' }))

    store.restoreAll([])

    const got = await store.listForRoom({ worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' })
    expect(got).toEqual([])
    expect(store.snapshotAll()).toEqual([])
  })

  it('copies input records — caller mutation after restore does not affect the store', () => {
    const store = new InMemoryRoomMemoryStore()
    const source = record({ memoryId: 'a', text: 'original' })

    store.restoreAll([source])
    source.text = 'mutated'

    expect(store.snapshotAll()[0]!.text).toBe('original')
  })

  it('listForRoom returns correctly scoped, seq-ordered records after restore', async () => {
    const store = new InMemoryRoomMemoryStore()
    store.restoreAll([
      record({ memoryId: 'a', roomId: 'room-1', seq: 1 }),
      record({ memoryId: 'b', roomId: 'room-1', seq: 2 }),
      record({ memoryId: 'other-room', roomId: 'room-2', seq: 1 }),
    ])

    const got = await store.listForRoom({ worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' })
    expect(got.map((r) => r.memoryId)).toEqual(['b', 'a'])
  })

  it('recording an already-restored dedupe key deduplicates instead of duplicating', async () => {
    const store = new InMemoryRoomMemoryStore()
    store.restoreAll([record({ memoryId: 'a', seq: 1, dedupeKey: 'evt-1' })])

    const second = await store.record(insert({ memoryId: 'b', dedupeKey: 'evt-1' }))
    expect(second.ok && 'deduplicated' in second && second.deduplicated).toBe(true)

    const got = await store.listForRoom({ worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' })
    expect(got).toHaveLength(1)
    expect(got[0]!.memoryId).toBe('a')
  })

  it('continues seq assignment correctly after restore', async () => {
    const store = new InMemoryRoomMemoryStore()
    store.restoreAll([record({ memoryId: 'a', seq: 5 })])

    const next = await store.record(insert({ memoryId: 'b' }))
    expect(next.ok && next.record.seq).toBe(6)
  })

  it('silently drops a record that fails schema re-validation', () => {
    const store = new InMemoryRoomMemoryStore()
    const invalid = { ...record({ memoryId: 'bad' }), kind: 'not-a-real-kind' } as unknown as RoomMemoryRecord

    store.restoreAll([record({ memoryId: 'good' }), invalid])

    expect(store.snapshotAll().map((r) => r.memoryId)).toEqual(['good'])
  })
})
