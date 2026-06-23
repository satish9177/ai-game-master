import { describe, expect, it } from 'vitest'
import { WorldCommandSchema, WorldEventSchema } from '../world/events'
import { MAX_MEMORY_CHARS, NPC_MEMORY_SCHEMA_VERSION } from './contracts'
import type { MemoryScope, NpcMemoryRecord } from './contracts'
import {
  DEFAULT_RECALL_LIMIT,
  DEFAULT_RECALL_MAX_CHARS,
  filterMemoriesForScope,
  selectRecallMemories,
  validateMemoryDraft,
} from './firewall'
import type { MemoryDraftInput } from './firewall'

function draftInput(overrides: Partial<MemoryDraftInput> = {}): MemoryDraftInput {
  return {
    worldId: 'world-1',
    sessionId: 'session-1',
    npcId: 'npc-1',
    kind: 'player_claim',
    source: 'player',
    text: 'the bridge is out',
    ...overrides,
  }
}

function record(overrides: Partial<NpcMemoryRecord> = {}): NpcMemoryRecord {
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
    seq: 1,
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

describe('validateMemoryDraft — accept + normalize', () => {
  it('accepts a valid draft, trims text, and defaults confidence to medium', () => {
    const result = validateMemoryDraft(draftInput({ text: '  hello world  ' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.text).toBe('hello world')
    expect(result.draft.confidence).toBe('medium')
    expect(result.draft.scope).toEqual({ worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' })
    expect(result.draft.provenance).toEqual({ source: 'player' })
  })

  it('keeps an explicit confidence and well-formed provenance fields', () => {
    const result = validateMemoryDraft(
      draftInput({ confidence: 'high', roomId: 'room-2', turnIndex: 3 }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.confidence).toBe('high')
    expect(result.draft.provenance).toEqual({ source: 'player', roomId: 'room-2', turnIndex: 3 })
  })

  it('trims scope ids', () => {
    const result = validateMemoryDraft(draftInput({ worldId: ' world-1 ' }))
    expect(result.ok && result.draft.scope.worldId).toBe('world-1')
  })

  it('does not mutate its input', () => {
    const input = draftInput({ text: '  spaced  ' })
    const snapshot = structuredClone(input)
    validateMemoryDraft(input)
    expect(input).toEqual(snapshot)
  })
})

describe('validateMemoryDraft — reject each reason', () => {
  it('empty scope → invalid-scope', () => {
    expect(validateMemoryDraft(draftInput({ worldId: '' }))).toEqual({ ok: false, reason: 'invalid-scope' })
    expect(validateMemoryDraft(draftInput({ sessionId: '  ' }))).toEqual({ ok: false, reason: 'invalid-scope' })
    expect(validateMemoryDraft(draftInput({ npcId: '' }))).toEqual({ ok: false, reason: 'invalid-scope' })
  })

  it('bad kind → invalid-kind', () => {
    expect(validateMemoryDraft(draftInput({ kind: 'rumor' as never }))).toEqual({ ok: false, reason: 'invalid-kind' })
  })

  it('bad source (including system) → invalid-source', () => {
    expect(validateMemoryDraft(draftInput({ source: 'system' as never }))).toEqual({ ok: false, reason: 'invalid-source' })
  })

  it('empty / whitespace text → empty-text', () => {
    expect(validateMemoryDraft(draftInput({ text: '' }))).toEqual({ ok: false, reason: 'empty-text' })
    expect(validateMemoryDraft(draftInput({ text: '   ' }))).toEqual({ ok: false, reason: 'empty-text' })
  })

  it('text over MAX_MEMORY_CHARS → text-too-long (measured after trim)', () => {
    expect(validateMemoryDraft(draftInput({ text: 'a'.repeat(MAX_MEMORY_CHARS + 1) }))).toEqual({ ok: false, reason: 'text-too-long' })
    // trailing whitespace does not push an otherwise-fitting text over the cap
    expect(validateMemoryDraft(draftInput({ text: `${'a'.repeat(MAX_MEMORY_CHARS)}   ` })).ok).toBe(true)
  })

  it('bad confidence → invalid-confidence', () => {
    expect(validateMemoryDraft(draftInput({ confidence: 'certain' as never }))).toEqual({ ok: false, reason: 'invalid-confidence' })
  })

  it('malformed roomId/turnIndex → invalid-provenance', () => {
    expect(validateMemoryDraft(draftInput({ roomId: '   ' }))).toEqual({ ok: false, reason: 'invalid-provenance' })
    expect(validateMemoryDraft(draftInput({ turnIndex: -1 }))).toEqual({ ok: false, reason: 'invalid-provenance' })
    expect(validateMemoryDraft(draftInput({ turnIndex: 1.5 }))).toEqual({ ok: false, reason: 'invalid-provenance' })
  })
})

describe('filterMemoriesForScope', () => {
  const scope: MemoryScope = { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' }

  it('drops every cross-world / cross-session / cross-npc record', () => {
    const records = [
      record({ memoryId: 'keep' }),
      record({ memoryId: 'world', worldId: 'world-2' }),
      record({ memoryId: 'session', sessionId: 'session-2' }),
      record({ memoryId: 'npc', npcId: 'npc-2' }),
    ]
    const filtered = filterMemoriesForScope(records, scope)
    expect(filtered.map((r) => r.memoryId)).toEqual(['keep'])
  })

  it('does not mutate the input array', () => {
    const records = [record({ memoryId: 'a' }), record({ memoryId: 'b', npcId: 'other' })]
    const snapshot = structuredClone(records)
    filterMemoriesForScope(records, scope)
    expect(records).toEqual(snapshot)
  })
})

describe('selectRecallMemories', () => {
  it('orders by seq desc then memoryId asc, ignoring confidence', () => {
    const records = [
      record({ memoryId: 'b', seq: 1, confidence: 'high' }),
      record({ memoryId: 'a', seq: 2, confidence: 'low' }),
      record({ memoryId: 'c', seq: 2, confidence: 'high' }),
    ]
    const selected = selectRecallMemories(records, { limit: 10, maxChars: 1000 })
    expect(selected.map((r) => r.memoryId)).toEqual(['a', 'c', 'b'])
  })

  it('honors the limit cap', () => {
    const records = [
      record({ memoryId: 'a', seq: 3 }),
      record({ memoryId: 'b', seq: 2 }),
      record({ memoryId: 'c', seq: 1 }),
    ]
    expect(selectRecallMemories(records, { limit: 2, maxChars: 1000 }).map((r) => r.memoryId)).toEqual(['a', 'b'])
  })

  it('caps cumulative text length at maxChars (stops before exceeding)', () => {
    const records = [
      record({ memoryId: 'a', seq: 3, text: 'x'.repeat(10) }),
      record({ memoryId: 'b', seq: 2, text: 'y'.repeat(10) }),
      record({ memoryId: 'c', seq: 1, text: 'z'.repeat(10) }),
    ]
    const selected = selectRecallMemories(records, { limit: 10, maxChars: 25 })
    expect(selected.map((r) => r.memoryId)).toEqual(['a', 'b'])
  })

  it('returns [] when maxChars cannot fit even the first record', () => {
    const records = [record({ text: 'x'.repeat(10) })]
    expect(selectRecallMemories(records, { limit: 10, maxChars: 5 })).toEqual([])
  })

  it('does not mutate the input array', () => {
    const records = [record({ memoryId: 'a', seq: 1 }), record({ memoryId: 'b', seq: 2 })]
    const snapshot = structuredClone(records)
    selectRecallMemories(records, { limit: DEFAULT_RECALL_LIMIT, maxChars: DEFAULT_RECALL_MAX_CHARS })
    expect(records).toEqual(snapshot)
  })

  it('exposes the documented default bounds', () => {
    expect(DEFAULT_RECALL_LIMIT).toBe(8)
    expect(DEFAULT_RECALL_MAX_CHARS).toBe(600)
  })
})

describe('structural truth separation', () => {
  it('no firewall output is ever a WorldEvent or WorldCommand', () => {
    const valid = validateMemoryDraft(draftInput())
    expect(valid.ok).toBe(true)
    if (!valid.ok) return
    expect(WorldEventSchema.safeParse(valid.draft).success).toBe(false)
    expect(WorldCommandSchema.safeParse(valid.draft).success).toBe(false)

    const selected = selectRecallMemories([record()], { limit: 8, maxChars: 600 })
    for (const memory of selected) {
      expect(WorldEventSchema.safeParse(memory).success).toBe(false)
      expect(WorldCommandSchema.safeParse(memory).success).toBe(false)
      expect('type' in memory).toBe(false)
      expect('payload' in memory).toBe(false)
    }
  })
})
