import { describe, expect, it } from 'vitest'
import { NPC_MEMORY_SCHEMA_VERSION } from '../domain/memory/contracts'
import type { NpcMemoryInsert } from '../domain/memory/contracts'
import { InMemoryNpcMemoryStore } from './InMemoryNpcMemoryStore'

function insert(overrides: Partial<NpcMemoryInsert> = {}): NpcMemoryInsert {
  return {
    schemaVersion: NPC_MEMORY_SCHEMA_VERSION,
    memoryId: 'mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    npcId: 'npc-1',
    kind: 'npc_belief',
    text: 'aaa',
    provenance: { source: 'npc' },
    confidence: 'low',
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

describe('InMemoryNpcMemoryStore.record', () => {
  it('assigns seq starting at 1, monotonic per (session, npc)', async () => {
    const store = new InMemoryNpcMemoryStore()
    const a = await store.record(insert({ memoryId: 'a' }))
    const b = await store.record(insert({ memoryId: 'b' }))
    expect(a.ok && a.record.seq).toBe(1)
    expect(b.ok && b.record.seq).toBe(2)
  })

  it('keeps independent seq counters across npcs and sessions', async () => {
    const store = new InMemoryNpcMemoryStore()
    await store.record(insert({ memoryId: 'a', npcId: 'npc-1' }))
    const npc2 = await store.record(insert({ memoryId: 'b', npcId: 'npc-2' }))
    const otherSession = await store.record(insert({ memoryId: 'c', sessionId: 'session-2' }))
    expect(npc2.ok && npc2.record.seq).toBe(1)
    expect(otherSession.ok && otherSession.record.seq).toBe(1)
  })
})

describe('InMemoryNpcMemoryStore.listForNpc', () => {
  it('returns scope-filtered records, seq desc, bounded by limit', async () => {
    const store = new InMemoryNpcMemoryStore()
    await store.record(insert({ memoryId: 'a' }))
    await store.record(insert({ memoryId: 'b' }))
    await store.record(insert({ memoryId: 'c' }))

    const got = await store.listForNpc(
      { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' },
      { limit: 2 },
    )
    expect(got.map((r) => r.seq)).toEqual([3, 2])
  })

  it('isolates scope: no cross-world/session/npc leak', async () => {
    const store = new InMemoryNpcMemoryStore()
    await store.record(insert({ memoryId: 'keep', worldId: 'wA', sessionId: 'sA', npcId: 'n1' }))
    await store.record(insert({ memoryId: 'w', worldId: 'wB', sessionId: 'sA', npcId: 'n1' }))
    await store.record(insert({ memoryId: 's', worldId: 'wA', sessionId: 'sB', npcId: 'n1' }))
    await store.record(insert({ memoryId: 'n', worldId: 'wA', sessionId: 'sA', npcId: 'n2' }))

    const got = await store.listForNpc({ worldId: 'wA', sessionId: 'sA', npcId: 'n1' })
    expect(got.map((r) => r.memoryId)).toEqual(['keep'])
  })

  it('returns [] for an unknown scope', async () => {
    const store = new InMemoryNpcMemoryStore()
    await store.record(insert())
    const got = await store.listForNpc({ worldId: 'world-1', sessionId: 'nope', npcId: 'npc-1' })
    expect(got).toEqual([])
  })

  it('returns copies — mutating a returned record does not affect the store', async () => {
    const store = new InMemoryNpcMemoryStore()
    await store.record(insert({ memoryId: 'a', text: 'original' }))
    const first = await store.listForNpc({ worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' })
    first[0]!.text = 'mutated'
    const second = await store.listForNpc({ worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' })
    expect(second[0]!.text).toBe('original')
  })
})

describe('InMemoryNpcMemoryStore — dedupe (Slice C3)', () => {
  it('a repeated dedupeKey returns the original record with deduplicated:true, no second row', async () => {
    const store = new InMemoryNpcMemoryStore()
    const first = await store.record(insert({ memoryId: 'a', dedupeKey: 'evt-1' }))
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await store.record(insert({ memoryId: 'b', dedupeKey: 'evt-1' }))
    expect(second).toEqual({ ok: true, record: first.record, deduplicated: true })

    const got = await store.listForNpc({ worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' })
    expect(got).toHaveLength(1)
  })

  it('different dedupeKeys each insert their own row', async () => {
    const store = new InMemoryNpcMemoryStore()
    const a = await store.record(insert({ memoryId: 'a', dedupeKey: 'evt-1' }))
    const b = await store.record(insert({ memoryId: 'b', dedupeKey: 'evt-2' }))
    expect(a.ok && a.record.seq).toBe(1)
    expect(b.ok && 'deduplicated' in b).toBe(false)
    expect(b.ok && b.record.seq).toBe(2)
  })

  it('an absent dedupeKey preserves today’s behavior (no pre-check, two rows)', async () => {
    const store = new InMemoryNpcMemoryStore()
    const a = await store.record(insert({ memoryId: 'a' }))
    const b = await store.record(insert({ memoryId: 'b' }))
    expect(a.ok && 'deduplicated' in a).toBe(false)
    expect(b.ok && 'deduplicated' in b).toBe(false)
    const got = await store.listForNpc({ worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' })
    expect(got).toHaveLength(2)
  })
})
