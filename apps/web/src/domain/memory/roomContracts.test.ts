import { describe, expect, it } from 'vitest'
import {
  MAX_ROOM_MEMORY_CHARS,
  ROOM_MEMORY_SCHEMA_VERSION,
  RoomMemoryRecordSchema,
} from './roomContracts'
import type { RoomMemoryRecord } from './roomContracts'

function validRecord(overrides: Partial<RoomMemoryRecord> = {}): RoomMemoryRecord {
  return {
    schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
    memoryId: 'mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    roomId: 'room-1',
    kind: 'player_claim',
    text: 'the east door is locked',
    provenance: { source: 'player', npcId: 'npc-1', turnIndex: 2 },
    confidence: 'medium',
    seq: 1,
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

describe('RoomMemoryRecordSchema', () => {
  it('parses a valid record and round-trips it unchanged', () => {
    const record = validRecord()
    const parsed = RoomMemoryRecordSchema.parse(record)
    expect(parsed).toEqual(record)
  })

  it('parses a record with optional provenance fields omitted', () => {
    const record = validRecord({ provenance: { source: 'game' } })
    expect(RoomMemoryRecordSchema.safeParse(record).success).toBe(true)
  })

  it('rejects unknown extra keys (.strict)', () => {
    const record = { ...validRecord(), extra: 'nope' } as unknown
    expect(RoomMemoryRecordSchema.safeParse(record).success).toBe(false)
  })

  it('rejects extra keys inside provenance (.strict)', () => {
    const record = validRecord({
      provenance: { source: 'player', secret: 'x' } as never,
    })
    expect(RoomMemoryRecordSchema.safeParse(record).success).toBe(false)
  })

  it('enforces the closed kind enum (NPC kinds are rejected)', () => {
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ kind: 'rumor' as never })).success).toBe(false)
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ kind: 'npc_belief' as never })).success).toBe(false)
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ kind: 'dialogue_summary' as never })).success).toBe(false)
  })

  it('accepts all four room memory kinds', () => {
    for (const kind of ['player_claim', 'room_observation', 'room_note', 'room_summary'] as const) {
      expect(RoomMemoryRecordSchema.safeParse(validRecord({ kind })).success).toBe(true)
    }
  })

  it('rejects source "system" (no hidden system memory)', () => {
    const record = validRecord({ provenance: { source: 'system' as never } })
    expect(RoomMemoryRecordSchema.safeParse(record).success).toBe(false)
  })

  it('accepts every allowed source', () => {
    for (const source of ['player', 'npc', 'game', 'llm'] as const) {
      const record = validRecord({ provenance: { source } })
      expect(RoomMemoryRecordSchema.safeParse(record).success).toBe(true)
    }
  })

  it('enforces the confidence enum', () => {
    const record = validRecord({ confidence: 'certain' as never })
    expect(RoomMemoryRecordSchema.safeParse(record).success).toBe(false)
  })

  it('rejects empty text', () => {
    const record = validRecord({ text: '' })
    expect(RoomMemoryRecordSchema.safeParse(record).success).toBe(false)
  })

  it('accepts text at the MAX_ROOM_MEMORY_CHARS boundary and rejects one over', () => {
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ text: 'a'.repeat(MAX_ROOM_MEMORY_CHARS) })).success).toBe(true)
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ text: 'a'.repeat(MAX_ROOM_MEMORY_CHARS + 1) })).success).toBe(false)
  })

  it('requires seq >= 1', () => {
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ seq: 0 })).success).toBe(false)
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ seq: 1.5 })).success).toBe(false)
  })

  it('requires turnIndex >= 0 and integer when present', () => {
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ provenance: { source: 'player', turnIndex: -1 } })).success).toBe(false)
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ provenance: { source: 'player', turnIndex: 0 } })).success).toBe(true)
  })

  it('rejects an empty scope id', () => {
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ worldId: '' })).success).toBe(false)
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ sessionId: '' })).success).toBe(false)
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ roomId: '' })).success).toBe(false)
  })

  it('pins the schema version literal', () => {
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ schemaVersion: 2 as never })).success).toBe(false)
  })
})

describe('RoomMemoryRecordSchema — optional recall metadata (Slice C, schemaVersion stays 1)', () => {
  it('parses and round-trips a record carrying importance/dedupeKey/entitySnapshots', () => {
    const record = validRecord({
      importance: 3,
      dedupeKey: 'world-1|session-1|room-state-changed|evt-1',
      entitySnapshots: { room: { id: 'room_library_3a', displayName: 'Old Library' } },
    })
    expect(RoomMemoryRecordSchema.parse(record)).toEqual(record)
  })

  it('still parses a fieldless v1 record (back-compat: no schemaVersion bump)', () => {
    expect(validRecord().schemaVersion).toBe(1)
    expect(RoomMemoryRecordSchema.safeParse(validRecord()).success).toBe(true)
  })

  it('bounds importance to an integer 0..5', () => {
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ importance: 5 })).success).toBe(true)
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ importance: 6 })).success).toBe(false)
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ importance: -1 })).success).toBe(false)
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ importance: 2.5 })).success).toBe(false)
  })

  it('bounds dedupeKey/entitySnapshots and .strict still rejects unknown snapshot keys', () => {
    expect(RoomMemoryRecordSchema.safeParse(validRecord({ dedupeKey: '' })).success).toBe(false)
    expect(
      RoomMemoryRecordSchema.safeParse(
        validRecord({ entitySnapshots: { room: { id: 'r', displayName: 'N', extra: 'x' } } as never }),
      ).success,
    ).toBe(false)
  })
})
