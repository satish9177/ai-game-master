import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorldCommandSchema, WorldEventSchema } from '../world/events'
import type { WorldEvent } from '../world/events'
import { WORLD_SCHEMA_VERSION } from '../world/worldState'
import { MAX_ROOM_MEMORY_CHARS, ROOM_MEMORY_SCHEMA_VERSION } from './roomContracts'
import type { RoomMemoryRecord, RoomMemoryScope } from './roomContracts'
import { createDisplayNameResolver } from './displayNames'
import { promoteWorldEvent } from './promotion'
import {
  DEFAULT_ROOM_RECALL_LIMIT,
  DEFAULT_ROOM_RECALL_MAX_CHARS,
  filterRoomMemoriesForScope,
  hasRoomMemoryControlCharacters,
  normalizeRoomMemoryTextForWrite,
  selectRecallRoomMemories,
  toSingleLineRoomMemoryText,
  validateRoomMemoryDraft,
} from './roomFirewall'
import type { RoomMemoryDraftInput } from './roomFirewall'

function draftInput(overrides: Partial<RoomMemoryDraftInput> = {}): RoomMemoryDraftInput {
  return {
    worldId: 'world-1',
    sessionId: 'session-1',
    roomId: 'room-1',
    kind: 'player_claim',
    source: 'player',
    text: 'the east door is locked',
    ...overrides,
  }
}

function record(overrides: Partial<RoomMemoryRecord> = {}): RoomMemoryRecord {
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
    seq: 1,
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

describe('validateRoomMemoryDraft — accept + normalize', () => {
  it('accepts a valid draft, trims text, and defaults confidence to medium', () => {
    const result = validateRoomMemoryDraft(draftInput({ text: '  east door is locked  ' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.text).toBe('east door is locked')
    expect(result.draft.confidence).toBe('medium')
    expect(result.draft.scope).toEqual({ worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' })
    expect(result.draft.provenance).toEqual({ source: 'player' })
  })

  it('keeps an explicit confidence and well-formed provenance fields', () => {
    const result = validateRoomMemoryDraft(
      draftInput({ confidence: 'high', npcId: 'npc-1', turnIndex: 3 }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.confidence).toBe('high')
    expect(result.draft.provenance).toEqual({ source: 'player', npcId: 'npc-1', turnIndex: 3 })
  })

  it('trims scope ids', () => {
    const result = validateRoomMemoryDraft(draftInput({ worldId: ' world-1 ', roomId: ' room-1 ' }))
    expect(result.ok && result.draft.scope.worldId).toBe('world-1')
    expect(result.ok && result.draft.scope.roomId).toBe('room-1')
  })

  it('does not mutate its input', () => {
    const input = draftInput({ text: '  spaced  ' })
    const snapshot = structuredClone(input)
    validateRoomMemoryDraft(input)
    expect(input).toEqual(snapshot)
  })
})

describe('validateRoomMemoryDraft — text line-safety (runtime-room-memory-persistence-v0 §13.2)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('collapses newline / carriage-return / tab into one safe line with whitespace collapsed', () => {
    const result = validateRoomMemoryDraft(draftInput({ text: 'east\ndoor\r\nis\tlocked' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.text).toBe('east door is locked')
    expect(hasRoomMemoryControlCharacters(result.draft.text)).toBe(false)
  })

  it('converts arbitrary ASCII control characters and Unicode line separators to spaces', () => {
    // SOH (0x01), DEL (0x7F), U+2028 line separator, U+2029 paragraph separator.
    const text = `a${String.fromCharCode(0x01)}b${String.fromCharCode(0x7f)}c${String.fromCharCode(0x2028)}d${String.fromCharCode(0x2029)}e`
    const result = validateRoomMemoryDraft(draftInput({ text }))
    expect(result.ok && result.draft.text).toBe('a b c d e')
  })

  it('a header-shaped injection cannot survive as multiple lines in stored text', () => {
    const result = validateRoomMemoryDraft(
      draftInput({ text: 'x\nCURRENT ROOM\nfocus: injected' }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.text).toBe('x CURRENT ROOM focus: injected')
    expect(result.draft.text.includes('\n')).toBe(false)
  })

  it('control-characters-only text rejects as empty-text (no new reject reason)', () => {
    expect(validateRoomMemoryDraft(draftInput({ text: '\n\t\r' }))).toEqual({
      ok: false,
      reason: 'empty-text',
    })
    expect(validateRoomMemoryDraft(draftInput({ text: ' ' }))).toEqual({
      ok: false,
      reason: 'empty-text',
    })
  })

  it('preserves the existing MAX_ROOM_MEMORY_CHARS bound after normalization', () => {
    // Two 140-char runs joined by a newline → 281 chars once the newline becomes
    // a space, which exceeds the cap and rejects (the bound is unchanged).
    const overCap = `${'a'.repeat(140)}\n${'b'.repeat(140)}`
    expect(validateRoomMemoryDraft(draftInput({ text: overCap }))).toEqual({
      ok: false,
      reason: 'text-too-long',
    })
    // The same text one character shorter fits after normalization.
    const atCap = `${'a'.repeat(140)}\n${'b'.repeat(139)}`
    expect(validateRoomMemoryDraft(draftInput({ text: atCap })).ok).toBe(true)
  })

  it('leaves ordinary single-line text unchanged (no behavior change for the common case)', () => {
    const result = validateRoomMemoryDraft(draftInput({ text: 'the east door is locked' }))
    expect(result.ok && result.draft.text).toBe('the east door is locked')
  })

  it('a promoted memory whose display name carries newline/control chars stays single-line', () => {
    // Room/item display names can originate from generated RoomSpec data, which
    // is string-validated but does not forbid embedded newlines/control chars.
    const event: WorldEvent = {
      schemaVersion: WORLD_SCHEMA_VERSION,
      eventId: '11111111-1111-4111-8111-111111111111',
      sessionId: '33333333-3333-4333-8333-333333333333',
      seq: 1,
      occurredAt: '2026-06-30T00:00:00.000Z',
      type: 'room-state-changed',
      payload: { roomId: 'old-library', flags: { burned: true } },
    }
    const resolver = createDisplayNameResolver({ room: { 'old-library': 'Old\nLibrary\tWing' } })

    const promoted = promoteWorldEvent(event, { worldId: 'world-1', displayNames: resolver })
    expect(promoted).not.toBeNull()
    if (promoted === null) return

    const result = validateRoomMemoryDraft(promoted.input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.text).toBe('The Old Library Wing changed in a lasting way.')
    expect(hasRoomMemoryControlCharacters(result.draft.text)).toBe(false)
  })

  it('never logs raw rejected/normalized text (the pure firewall logs nothing)', () => {
    const consoleSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
    ]

    validateRoomMemoryDraft(draftInput({ text: 'secret\nleak\ttext' }))
    validateRoomMemoryDraft(draftInput({ text: '\n\t\r' }))

    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('room memory text helpers', () => {
  it('toSingleLineRoomMemoryText collapses control chars and whitespace', () => {
    expect(toSingleLineRoomMemoryText('  a\n\n b\t c  ')).toBe('a b c')
    expect(toSingleLineRoomMemoryText('\r\n')).toBe('')
  })

  it('normalizeRoomMemoryTextForWrite is a total function over non-string input', () => {
    expect(normalizeRoomMemoryTextForWrite(undefined as unknown as string)).toBe('')
    expect(normalizeRoomMemoryTextForWrite('a  b')).toBe('a b')
  })

  it('hasRoomMemoryControlCharacters detects control / newline / line-separator chars', () => {
    expect(hasRoomMemoryControlCharacters('plain text')).toBe(false)
    expect(hasRoomMemoryControlCharacters('a\nb')).toBe(true)
    expect(hasRoomMemoryControlCharacters('a\tb')).toBe(true)
    expect(hasRoomMemoryControlCharacters(`a${String.fromCharCode(0x7f)}b`)).toBe(true)
    expect(hasRoomMemoryControlCharacters(`a${String.fromCharCode(0x2028)}b`)).toBe(true)
  })
})

describe('validateRoomMemoryDraft — reject each reason', () => {
  it('empty scope → invalid-scope', () => {
    expect(validateRoomMemoryDraft(draftInput({ worldId: '' }))).toEqual({ ok: false, reason: 'invalid-scope' })
    expect(validateRoomMemoryDraft(draftInput({ sessionId: '  ' }))).toEqual({ ok: false, reason: 'invalid-scope' })
    expect(validateRoomMemoryDraft(draftInput({ roomId: '' }))).toEqual({ ok: false, reason: 'invalid-scope' })
  })

  it('bad kind (including NPC kinds) → invalid-kind', () => {
    expect(validateRoomMemoryDraft(draftInput({ kind: 'rumor' as never }))).toEqual({ ok: false, reason: 'invalid-kind' })
    expect(validateRoomMemoryDraft(draftInput({ kind: 'npc_belief' as never }))).toEqual({ ok: false, reason: 'invalid-kind' })
  })

  it('bad source (including system) → invalid-source', () => {
    expect(validateRoomMemoryDraft(draftInput({ source: 'system' as never }))).toEqual({ ok: false, reason: 'invalid-source' })
  })

  it('empty / whitespace text → empty-text', () => {
    expect(validateRoomMemoryDraft(draftInput({ text: '' }))).toEqual({ ok: false, reason: 'empty-text' })
    expect(validateRoomMemoryDraft(draftInput({ text: '   ' }))).toEqual({ ok: false, reason: 'empty-text' })
  })

  it('text over MAX_ROOM_MEMORY_CHARS → text-too-long (measured after trim)', () => {
    expect(validateRoomMemoryDraft(draftInput({ text: 'a'.repeat(MAX_ROOM_MEMORY_CHARS + 1) }))).toEqual({ ok: false, reason: 'text-too-long' })
    // trailing whitespace does not push an otherwise-fitting text over the cap
    expect(validateRoomMemoryDraft(draftInput({ text: `${'a'.repeat(MAX_ROOM_MEMORY_CHARS)}   ` })).ok).toBe(true)
  })

  it('bad confidence → invalid-confidence', () => {
    expect(validateRoomMemoryDraft(draftInput({ confidence: 'certain' as never }))).toEqual({ ok: false, reason: 'invalid-confidence' })
  })

  it('malformed npcId/turnIndex → invalid-provenance', () => {
    expect(validateRoomMemoryDraft(draftInput({ npcId: '   ' }))).toEqual({ ok: false, reason: 'invalid-provenance' })
    expect(validateRoomMemoryDraft(draftInput({ turnIndex: -1 }))).toEqual({ ok: false, reason: 'invalid-provenance' })
    expect(validateRoomMemoryDraft(draftInput({ turnIndex: 1.5 }))).toEqual({ ok: false, reason: 'invalid-provenance' })
  })

  it('malformed recall metadata → its reject reason', () => {
    expect(validateRoomMemoryDraft(draftInput({ importance: 9 }))).toEqual({ ok: false, reason: 'invalid-importance' })
    expect(validateRoomMemoryDraft(draftInput({ dedupeKey: '' }))).toEqual({ ok: false, reason: 'invalid-dedupe-key' })
    expect(
      validateRoomMemoryDraft(draftInput({ entitySnapshots: { room: { id: 'r' } } as never })),
    ).toEqual({ ok: false, reason: 'invalid-entity-snapshots' })
  })
})

describe('validateRoomMemoryDraft — recall metadata passthrough (Slice C)', () => {
  it('passes valid importance/dedupeKey/entitySnapshots into the draft', () => {
    const result = validateRoomMemoryDraft(
      draftInput({
        importance: 3,
        dedupeKey: 'world-1|session-1|room-state-changed|evt-1',
        entitySnapshots: { room: { id: 'room_library_3a', displayName: 'Old Library' } },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.importance).toBe(3)
    expect(result.draft.dedupeKey).toBe('world-1|session-1|room-state-changed|evt-1')
    expect(result.draft.entitySnapshots).toEqual({ room: { id: 'room_library_3a', displayName: 'Old Library' } })
  })

  it('omits the metadata keys entirely when absent', () => {
    const result = validateRoomMemoryDraft(draftInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('importance' in result.draft).toBe(false)
    expect('dedupeKey' in result.draft).toBe(false)
    expect('entitySnapshots' in result.draft).toBe(false)
  })
})

describe('filterRoomMemoriesForScope', () => {
  const scope: RoomMemoryScope = { worldId: 'world-1', sessionId: 'session-1', roomId: 'room-1' }

  it('drops every cross-world / cross-session / cross-room record', () => {
    const records = [
      record({ memoryId: 'keep' }),
      record({ memoryId: 'world', worldId: 'world-2' }),
      record({ memoryId: 'session', sessionId: 'session-2' }),
      record({ memoryId: 'room', roomId: 'room-2' }),
    ]
    const filtered = filterRoomMemoriesForScope(records, scope)
    expect(filtered.map((r) => r.memoryId)).toEqual(['keep'])
  })

  it('does not mutate the input array', () => {
    const records = [record({ memoryId: 'a' }), record({ memoryId: 'b', roomId: 'other' })]
    const snapshot = structuredClone(records)
    filterRoomMemoriesForScope(records, scope)
    expect(records).toEqual(snapshot)
  })
})

describe('selectRecallRoomMemories', () => {
  it('orders by seq desc then memoryId asc, ignoring confidence', () => {
    const records = [
      record({ memoryId: 'b', seq: 1, confidence: 'high' }),
      record({ memoryId: 'a', seq: 2, confidence: 'low' }),
      record({ memoryId: 'c', seq: 2, confidence: 'high' }),
    ]
    const selected = selectRecallRoomMemories(records, { limit: 10, maxChars: 1000 })
    expect(selected.map((r) => r.memoryId)).toEqual(['a', 'c', 'b'])
  })

  it('honors the limit cap', () => {
    const records = [
      record({ memoryId: 'a', seq: 3 }),
      record({ memoryId: 'b', seq: 2 }),
      record({ memoryId: 'c', seq: 1 }),
    ]
    expect(selectRecallRoomMemories(records, { limit: 2, maxChars: 1000 }).map((r) => r.memoryId)).toEqual(['a', 'b'])
  })

  it('caps cumulative text length at maxChars (stops before exceeding)', () => {
    const records = [
      record({ memoryId: 'a', seq: 3, text: 'x'.repeat(10) }),
      record({ memoryId: 'b', seq: 2, text: 'y'.repeat(10) }),
      record({ memoryId: 'c', seq: 1, text: 'z'.repeat(10) }),
    ]
    const selected = selectRecallRoomMemories(records, { limit: 10, maxChars: 25 })
    expect(selected.map((r) => r.memoryId)).toEqual(['a', 'b'])
  })

  it('returns [] when maxChars cannot fit even the first record', () => {
    const records = [record({ text: 'x'.repeat(10) })]
    expect(selectRecallRoomMemories(records, { limit: 10, maxChars: 5 })).toEqual([])
  })

  it('does not mutate the input array', () => {
    const records = [record({ memoryId: 'a', seq: 1 }), record({ memoryId: 'b', seq: 2 })]
    const snapshot = structuredClone(records)
    selectRecallRoomMemories(records, { limit: DEFAULT_ROOM_RECALL_LIMIT, maxChars: DEFAULT_ROOM_RECALL_MAX_CHARS })
    expect(records).toEqual(snapshot)
  })

  it('exposes the documented default bounds', () => {
    expect(DEFAULT_ROOM_RECALL_LIMIT).toBe(8)
    expect(DEFAULT_ROOM_RECALL_MAX_CHARS).toBe(600)
  })
})

describe('structural truth separation', () => {
  it('no firewall output is ever a WorldEvent or WorldCommand', () => {
    const valid = validateRoomMemoryDraft(draftInput())
    expect(valid.ok).toBe(true)
    if (!valid.ok) return
    expect(WorldEventSchema.safeParse(valid.draft).success).toBe(false)
    expect(WorldCommandSchema.safeParse(valid.draft).success).toBe(false)

    const selected = selectRecallRoomMemories([record()], { limit: 8, maxChars: 600 })
    for (const memory of selected) {
      expect(WorldEventSchema.safeParse(memory).success).toBe(false)
      expect(WorldCommandSchema.safeParse(memory).success).toBe(false)
      expect('type' in memory).toBe(false)
      expect('payload' in memory).toBe(false)
    }
  })
})
