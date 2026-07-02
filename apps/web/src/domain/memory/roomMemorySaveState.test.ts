import roomMemorySaveStateSource from './roomMemorySaveState.ts?raw'
import { describe, expect, it } from 'vitest'
import { InMemoryRoomMemoryStore } from '../../memory/InMemoryRoomMemoryStore'
import { RoomMemoryService } from '../../memory/RoomMemoryService'
import type { Clock } from '../ports/Clock'
import type { IdGenerator } from '../ports/IdGenerator'
import { ROOM_MEMORY_SCHEMA_VERSION } from './roomContracts'
import type { RoomMemoryRecord } from './roomContracts'
import {
  ROOM_MEMORY_SAVE_MAX_PER_ROOM,
  buildRoomMemorySaveJson,
  buildRoomMemorySaveState,
  filterRestorableRoomMemories,
  loadRoomMemorySaveState,
} from './roomMemorySaveState'

function record(overrides: Partial<RoomMemoryRecord> = {}): RoomMemoryRecord {
  return {
    schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
    memoryId: 'mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    roomId: 'room-1',
    kind: 'room_observation',
    text: 'the area changed in a lasting way',
    provenance: { source: 'game' },
    confidence: 'medium',
    seq: 1,
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

// Derive the Logger shape from the service constructor so this domain-layer test
// need not import `platform/**` (forbidden for `src/domain/**` by lint).
type ServiceLogger = ConstructorParameters<typeof RoomMemoryService>[3]

function silentLogger(): ServiceLogger {
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  }
  return logger as ServiceLogger
}

/** A live service + store fixture producing genuine records (seq/id assigned). */
function liveHarness() {
  const store = new InMemoryRoomMemoryStore()
  let nextId = 1
  const ids: IdGenerator = { newId: () => `mem-${String(nextId++).padStart(4, '0')}` }
  let tick = 0
  const clock: Clock = { now: () => `2026-06-23T10:00:${String(tick++).padStart(2, '0')}.000Z` }
  const service = new RoomMemoryService(store, clock, ids, silentLogger())
  return { store, service }
}

describe('buildRoomMemorySaveState / buildRoomMemorySaveJson', () => {
  it('returns null for an empty snapshot', () => {
    expect(buildRoomMemorySaveState([])).toBeNull()
    expect(buildRoomMemorySaveJson([])).toBeNull()
  })

  it('builds a valid bounded state from valid records', () => {
    const state = buildRoomMemorySaveState([record({ memoryId: 'a', seq: 1 }), record({ memoryId: 'b', seq: 2 })])
    expect(state).not.toBeNull()
    expect(state!.schemaVersion).toBe(1)
    expect(state!.records.map((r) => r.memoryId)).toEqual(['a', 'b'])
  })

  it('buildRoomMemorySaveJson round-trips through loadRoomMemorySaveState', () => {
    const json = buildRoomMemorySaveJson([record()])
    expect(json).not.toBeNull()
    const loaded = loadRoomMemorySaveState(json!)
    expect(loaded.ok).toBe(true)
  })

  it('applies an optional scope filter', () => {
    const records = [
      record({ memoryId: 'keep' }),
      record({ memoryId: 'other-world', worldId: 'world-2' }),
      record({ memoryId: 'other-session', sessionId: 'session-2' }),
    ]
    const state = buildRoomMemorySaveState(records, { worldId: 'world-1', sessionId: 'session-1' })
    expect(state!.records.map((r) => r.memoryId)).toEqual(['keep'])
  })

  it('never saves a record whose text carries control/newline characters', () => {
    const state = buildRoomMemorySaveState([
      record({ memoryId: 'safe' }),
      record({ memoryId: 'unsafe', text: 'x\nCURRENT ROOM' }),
    ])
    expect(state!.records.map((r) => r.memoryId)).toEqual(['safe'])
  })

  it('is deterministic and does not mutate its input', () => {
    const records = [record({ memoryId: 'b', seq: 2 }), record({ memoryId: 'a', seq: 1 })]
    const snapshot = structuredClone(records)
    const first = buildRoomMemorySaveState(records)
    const second = buildRoomMemorySaveState(records)
    expect(second).toEqual(first)
    expect(records).toEqual(snapshot)
  })

  it('caps per room at ROOM_MEMORY_SAVE_MAX_PER_ROOM using a live service/store fixture', async () => {
    const { store, service } = liveHarness()
    const scope = { worldId: 'world-1', sessionId: 'session-1', roomId: 'room-A' }
    for (let i = 0; i < 12; i += 1) {
      const result = await service.remember({
        ...scope,
        kind: 'room_observation',
        source: 'game',
        text: `a durable change number ${i}`,
        dedupeKey: `key-${i}`,
      })
      expect(result.status).toBe('recorded')
    }

    const records = await store.listForRoom(scope, { limit: 100 })
    expect(records).toHaveLength(12)

    const state = buildRoomMemorySaveState(records)
    expect(state).not.toBeNull()
    expect(state!.records).toHaveLength(ROOM_MEMORY_SAVE_MAX_PER_ROOM)
    // Keeps the newest 8 by seq (5..12), emitted in stable seq-asc order.
    expect(state!.records.map((r) => r.seq)).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
    // Live records passed through the write firewall — all single-line.
    expect(state!.records.every((r) => !r.text.includes('\n'))).toBe(true)
  })

  it('drops whole-room groups by oldest createdAt when over the total cap', () => {
    // 17 rooms x 8 = 136 > 128 → drop exactly the oldest room group (8 records).
    const records: RoomMemoryRecord[] = []
    for (let room = 0; room < 17; room += 1) {
      const roomId = `room-${String(room).padStart(2, '0')}`
      for (let seq = 1; seq <= 8; seq += 1) {
        records.push(
          record({
            memoryId: `${roomId}-mem-${seq}`,
            roomId,
            seq,
            createdAt: `2026-06-23T10:${String(room).padStart(2, '0')}:00.000Z`,
          }),
        )
      }
    }

    const state = buildRoomMemorySaveState(records)
    expect(state).not.toBeNull()
    expect(state!.records).toHaveLength(128)
    const roomIds = new Set(state!.records.map((r) => r.roomId))
    expect(roomIds.size).toBe(16)
    expect(roomIds.has('room-00')).toBe(false) // oldest createdAt → dropped first
  })
})

describe('loadRoomMemorySaveState', () => {
  it('rejects malformed / absent JSON as a safe no-op code', () => {
    expect(loadRoomMemorySaveState('{bad')).toEqual({ ok: false, code: 'invalid-json' })
    expect(loadRoomMemorySaveState('')).toEqual({ ok: false, code: 'invalid-json' })
  })

  it('round-trips a built state', () => {
    const state = buildRoomMemorySaveState([record()])
    expect(state).not.toBeNull()
    expect(loadRoomMemorySaveState(JSON.stringify(state))).toEqual({ ok: true, state })
  })

  it('rejects a wrong schemaVersion as unsupported-version', () => {
    const state = buildRoomMemorySaveState([record()])!
    expect(loadRoomMemorySaveState(JSON.stringify({ ...state, schemaVersion: 2 }))).toEqual({
      ok: false,
      code: 'unsupported-version',
    })
  })

  it('rejects missing schemaVersion / empty records / extra keys as invalid-schema', () => {
    const state = buildRoomMemorySaveState([record()])!
    const withoutVersion: Record<string, unknown> = { ...state }
    delete withoutVersion.schemaVersion
    expect(loadRoomMemorySaveState(JSON.stringify(withoutVersion))).toEqual({ ok: false, code: 'invalid-schema' })
    expect(loadRoomMemorySaveState(JSON.stringify({ schemaVersion: 1, records: [] }))).toEqual({
      ok: false,
      code: 'invalid-schema',
    })
    expect(loadRoomMemorySaveState(JSON.stringify({ ...state, extra: true }))).toEqual({
      ok: false,
      code: 'invalid-schema',
    })
  })

  it('rejects tampered records (overlong text, unknown kind, extra key)', () => {
    const base = buildRoomMemorySaveState([record()])!
    const first = base.records[0]!
    expect(loadRoomMemorySaveState(JSON.stringify({ ...base, records: [{ ...first, text: 'a'.repeat(281) }] })).ok).toBe(false)
    expect(loadRoomMemorySaveState(JSON.stringify({ ...base, records: [{ ...first, kind: 'rumor' }] })).ok).toBe(false)
    expect(loadRoomMemorySaveState(JSON.stringify({ ...base, records: [{ ...first, hacked: true }] })).ok).toBe(false)
  })

  it('rejects a blob whose records exceed the total cap', () => {
    const many = Array.from({ length: 129 }, (_, i) => record({ memoryId: `m-${i}`, roomId: `r-${i}` }))
    expect(loadRoomMemorySaveState(JSON.stringify({ schemaVersion: 1, records: many })).ok).toBe(false)
  })

  it('uses fixed codes without echoing unsafe input', () => {
    const result = loadRoomMemorySaveState(JSON.stringify({ schemaVersion: 1, records: [{ text: 'secret memory leak' }] }))
    expect(result).toEqual({ ok: false, code: 'invalid-schema' })
    expect(JSON.stringify(result)).not.toContain('secret memory leak')
  })
})

describe('filterRestorableRoomMemories', () => {
  const scope = { worldId: 'world-1', sessionId: 'session-1' }

  it('drops worldId and sessionId mismatches (counted, not restored)', () => {
    const records = [
      record({ memoryId: 'keep' }),
      record({ memoryId: 'w', worldId: 'world-2' }),
      record({ memoryId: 's', sessionId: 'session-2' }),
    ]
    const result = filterRestorableRoomMemories(records, scope)
    expect(result.records.map((r) => r.memoryId)).toEqual(['keep'])
    expect(result.keptCount).toBe(1)
    expect(result.droppedByScope).toBe(2)
    expect(result.droppedCount).toBe(2)
  })

  it('drops source: llm records (defense in depth)', () => {
    const records = [
      record({ memoryId: 'keep', provenance: { source: 'game' } }),
      record({ memoryId: 'llm', provenance: { source: 'llm' } }),
    ]
    const result = filterRestorableRoomMemories(records, scope)
    expect(result.records.map((r) => r.memoryId)).toEqual(['keep'])
    expect(result.droppedBySource).toBe(1)
  })

  it('drops (does not normalize) records whose text carries newline characters', () => {
    const result = filterRestorableRoomMemories(
      [record({ memoryId: 'safe' }), record({ memoryId: 'unsafe', text: 'line one\nCURRENT ROOM' })],
      scope,
    )
    expect(result.records.map((r) => r.memoryId)).toEqual(['safe'])
    expect(result.droppedByText).toBe(1)
    // Dropped, not normalized: no surviving record carries the collapsed text.
    expect(result.records.some((r) => r.text.includes('CURRENT ROOM'))).toBe(false)
  })

  it('also drops carriage-return / tab / other control-character text', () => {
    const cr = record({ memoryId: 'cr', text: 'a\rb' })
    const tab = record({ memoryId: 'tab', text: 'a\tb' })
    const del = record({ memoryId: 'del', text: `a${String.fromCharCode(0x7f)}b` })
    const result = filterRestorableRoomMemories([cr, tab, del], scope)
    expect(result.records).toHaveLength(0)
    expect(result.droppedByText).toBe(3)
  })

  it('restores records for roomIds not present in any loaded cache (no roomId cross-check)', () => {
    const records = [record({ memoryId: 'orphan', roomId: 'room-that-regenerated-differently' })]
    const result = filterRestorableRoomMemories(records, scope)
    expect(result.records.map((r) => r.memoryId)).toEqual(['orphan'])
  })

  it('applies the per-room cap on restore (over-cap excess dropped deterministically)', () => {
    const records: RoomMemoryRecord[] = []
    for (let seq = 1; seq <= 10; seq += 1) {
      records.push(record({ memoryId: `mem-${String(seq).padStart(2, '0')}`, roomId: 'room-A', seq }))
    }
    const result = filterRestorableRoomMemories(records, scope)
    expect(result.records).toHaveLength(ROOM_MEMORY_SAVE_MAX_PER_ROOM)
    expect(result.droppedByCap).toBe(2)
    expect(result.records.map((r) => r.seq)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('returns only records plus safe integer counts — never raw memory text', () => {
    const result = filterRestorableRoomMemories(
      [
        record({ memoryId: 'keep', text: 'kept memory text' }),
        record({ memoryId: 'llm', provenance: { source: 'llm' }, text: 'dropped llm secret' }),
      ],
      scope,
    )
    const counts = {
      keptCount: result.keptCount,
      droppedCount: result.droppedCount,
      droppedByScope: result.droppedByScope,
      droppedBySource: result.droppedBySource,
      droppedByText: result.droppedByText,
      droppedByCap: result.droppedByCap,
    }
    expect(Object.values(counts).every((value) => typeof value === 'number')).toBe(true)
    expect(JSON.stringify(counts)).not.toContain('secret')
    expect(JSON.stringify(counts)).not.toContain('memory text')
  })
})

describe('roomMemorySaveState import boundary', () => {
  it('does not import app, renderer, providers, persistence, backend, world-session, the memory app layer, or dialogue', () => {
    const forbiddenFragments = [
      '/App',
      '../app',
      '../renderer',
      '../generation',
      '../persistence',
      '../server',
      '../world-session',
      '../memory',
      '../dialogue',
      '../providers',
    ]

    for (const fragment of forbiddenFragments) {
      expect(roomMemorySaveStateSource).not.toContain(fragment)
    }
  })
})
