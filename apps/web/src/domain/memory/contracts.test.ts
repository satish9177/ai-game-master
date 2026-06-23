import { describe, expect, it } from 'vitest'
import {
  MAX_MEMORY_CHARS,
  NPC_MEMORY_SCHEMA_VERSION,
  NpcMemoryRecordSchema,
} from './contracts'
import type { NpcMemoryRecord } from './contracts'

function validRecord(overrides: Partial<NpcMemoryRecord> = {}): NpcMemoryRecord {
  return {
    schemaVersion: NPC_MEMORY_SCHEMA_VERSION,
    memoryId: 'mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    npcId: 'npc-1',
    kind: 'player_claim',
    text: 'the player says the bridge is out',
    provenance: { source: 'player', roomId: 'room-1', turnIndex: 2 },
    confidence: 'medium',
    seq: 1,
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

describe('NpcMemoryRecordSchema', () => {
  it('parses a valid record and round-trips it unchanged', () => {
    const record = validRecord()
    const parsed = NpcMemoryRecordSchema.parse(record)
    expect(parsed).toEqual(record)
  })

  it('parses a record with optional provenance fields omitted', () => {
    const record = validRecord({ provenance: { source: 'game' } })
    expect(NpcMemoryRecordSchema.safeParse(record).success).toBe(true)
  })

  it('rejects unknown extra keys (.strict)', () => {
    const record = { ...validRecord(), extra: 'nope' } as unknown
    expect(NpcMemoryRecordSchema.safeParse(record).success).toBe(false)
  })

  it('rejects extra keys inside provenance (.strict)', () => {
    const record = validRecord({
      provenance: { source: 'player', secret: 'x' } as never,
    })
    expect(NpcMemoryRecordSchema.safeParse(record).success).toBe(false)
  })

  it('enforces the closed kind enum', () => {
    const record = validRecord({ kind: 'rumor' as never })
    expect(NpcMemoryRecordSchema.safeParse(record).success).toBe(false)
  })

  it('rejects source "system" (no hidden system memory)', () => {
    const record = validRecord({ provenance: { source: 'system' as never } })
    expect(NpcMemoryRecordSchema.safeParse(record).success).toBe(false)
  })

  it('accepts every allowed source', () => {
    for (const source of ['player', 'npc', 'game', 'llm'] as const) {
      const record = validRecord({ provenance: { source } })
      expect(NpcMemoryRecordSchema.safeParse(record).success).toBe(true)
    }
  })

  it('enforces the confidence enum', () => {
    const record = validRecord({ confidence: 'certain' as never })
    expect(NpcMemoryRecordSchema.safeParse(record).success).toBe(false)
  })

  it('rejects empty text', () => {
    const record = validRecord({ text: '' })
    expect(NpcMemoryRecordSchema.safeParse(record).success).toBe(false)
  })

  it('accepts text at the MAX_MEMORY_CHARS boundary and rejects one over', () => {
    expect(NpcMemoryRecordSchema.safeParse(validRecord({ text: 'a'.repeat(MAX_MEMORY_CHARS) })).success).toBe(true)
    expect(NpcMemoryRecordSchema.safeParse(validRecord({ text: 'a'.repeat(MAX_MEMORY_CHARS + 1) })).success).toBe(false)
  })

  it('requires seq >= 1', () => {
    expect(NpcMemoryRecordSchema.safeParse(validRecord({ seq: 0 })).success).toBe(false)
    expect(NpcMemoryRecordSchema.safeParse(validRecord({ seq: 1.5 })).success).toBe(false)
  })

  it('requires turnIndex >= 0 and integer when present', () => {
    expect(NpcMemoryRecordSchema.safeParse(validRecord({ provenance: { source: 'player', turnIndex: -1 } })).success).toBe(false)
    expect(NpcMemoryRecordSchema.safeParse(validRecord({ provenance: { source: 'player', turnIndex: 0 } })).success).toBe(true)
  })

  it('rejects an empty scope id', () => {
    expect(NpcMemoryRecordSchema.safeParse(validRecord({ worldId: '' })).success).toBe(false)
    expect(NpcMemoryRecordSchema.safeParse(validRecord({ sessionId: '' })).success).toBe(false)
    expect(NpcMemoryRecordSchema.safeParse(validRecord({ npcId: '' })).success).toBe(false)
  })

  it('pins the schema version literal', () => {
    expect(NpcMemoryRecordSchema.safeParse(validRecord({ schemaVersion: 2 as never })).success).toBe(false)
  })
})
