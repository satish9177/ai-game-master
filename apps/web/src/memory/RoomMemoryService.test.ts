import { describe, expect, it } from 'vitest'
import { promoteWorldEvent } from '../domain/memory/promotion'
import { RoomMemoryRecordSchema } from '../domain/memory/roomContracts'
import type { RoomMemoryRecord, RoomMemoryScope } from '../domain/memory/roomContracts'
import type { RoomMemoryDraftInput } from '../domain/memory/roomFirewall'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type {
  RoomMemoryStore,
  RoomMemoryStoreErrorCode,
  RoomMemoryWriteResult,
} from '../domain/ports/RoomMemoryStore'
import { WorldCommandSchema, WorldEventSchema } from '../domain/world/events'
import type { WorldEvent } from '../domain/world/events'
import { WORLD_SCHEMA_VERSION } from '../domain/world/worldState'
import type { Logger, LogContext, LogLevel } from '../platform/logger/Logger'
import { InMemoryRoomMemoryStore } from './InMemoryRoomMemoryStore'
import { RoomMemoryService } from './RoomMemoryService'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

function capturingLogger(entries: LogEntry[]): Logger {
  const record = (level: LogLevel) => (message: string, context: LogContext = {}) => {
    entries.push({ level, message, context })
  }
  const logger: Logger = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
  }
  return logger
}

function harness() {
  const store = new InMemoryRoomMemoryStore()
  const entries: LogEntry[] = []
  let nextId = 1
  const ids: IdGenerator = { newId: () => `mem-${String(nextId++).padStart(4, '0')}` }
  let tick = 0
  const clock: Clock = { now: () => `2026-06-23T10:00:${String(tick++).padStart(2, '0')}.000Z` }
  const service = new RoomMemoryService(store, clock, ids, capturingLogger(entries))
  return { store, entries, service }
}

const baseInput: RoomMemoryDraftInput = {
  worldId: 'world-1',
  sessionId: 'session-1',
  roomId: 'room-1',
  kind: 'player_claim',
  source: 'player',
  text: 'the east door is locked',
}

const scopeOf = (i: RoomMemoryDraftInput): RoomMemoryScope => ({
  worldId: i.worldId,
  sessionId: i.sessionId,
  roomId: i.roomId,
})

/** A store that always fails, to drive the `failed` path / log without SQLite. */
class FailingStore implements RoomMemoryStore {
  private readonly code: RoomMemoryStoreErrorCode
  constructor(code: RoomMemoryStoreErrorCode) {
    this.code = code
  }
  async record(): Promise<RoomMemoryWriteResult> {
    return { ok: false, error: { code: this.code } }
  }
  async listForRoom(): Promise<RoomMemoryRecord[]> {
    return []
  }
}

describe('RoomMemoryService.remember', () => {
  it('records a valid memory, stamping memoryId/createdAt and an assigned seq', async () => {
    const { service } = harness()
    const result = await service.remember(baseInput)
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect(result.record.memoryId).toBe('mem-0001')
    expect(result.record.createdAt).toBe('2026-06-23T10:00:00.000Z')
    expect(result.record.seq).toBe(1)
    expect(RoomMemoryRecordSchema.safeParse(result.record).success).toBe(true)
  })

  it('assigns a monotonic seq per (session, room), independent across rooms', async () => {
    const { service } = harness()
    const a1 = await service.remember(baseInput)
    const a2 = await service.remember(baseInput)
    const b1 = await service.remember({ ...baseInput, roomId: 'room-2' })
    expect(a1.status === 'recorded' && a1.record.seq).toBe(1)
    expect(a2.status === 'recorded' && a2.record.seq).toBe(2)
    expect(b1.status === 'recorded' && b1.record.seq).toBe(1)
  })

  it('rejects an invalid draft and stores nothing', async () => {
    const { service, store } = harness()
    const result = await service.remember({ ...baseInput, text: '   ' })
    expect(result).toEqual({ status: 'rejected', reason: 'empty-text' })
    expect(await store.listForRoom(scopeOf(baseInput))).toEqual([])
  })

  it('maps a store failure to failed', async () => {
    const entries: LogEntry[] = []
    const service = new RoomMemoryService(
      new FailingStore('session-not-found'),
      { now: () => '2026-06-23T10:00:00.000Z' },
      { newId: () => 'mem-x' },
      capturingLogger(entries),
    )
    const result = await service.remember(baseInput)
    expect(result).toEqual({ status: 'failed', reason: 'session-not-found' })
  })
})

describe('RoomMemoryService.recall', () => {
  it('returns scoped, seq-desc, bounded records', async () => {
    const { service } = harness()
    await service.remember({ ...baseInput, text: 'first' })
    await service.remember({ ...baseInput, text: 'second' })
    await service.remember({ ...baseInput, text: 'third' })

    const recalled = await service.recall(scopeOf(baseInput), { limit: 2 })
    expect(recalled.status).toBe('recalled')
    expect(recalled.memories.map((m) => m.seq)).toEqual([3, 2])
  })

  it('returns [] for an unknown scope (not a failure)', async () => {
    const { service } = harness()
    await service.remember(baseInput)
    const recalled = await service.recall({ worldId: 'world-1', sessionId: 'other', roomId: 'room-1' })
    expect(recalled).toEqual({ status: 'recalled', memories: [] })
  })
})

describe('RoomMemoryService — no cross-world/session/room leak', () => {
  it('recall returns only the exact scope triple memories', async () => {
    const { service } = harness()
    await service.remember({ ...baseInput, worldId: 'worldA', sessionId: 'sessionA', roomId: 'roomX', text: 'A-sA-X' })
    await service.remember({ ...baseInput, worldId: 'worldB', sessionId: 'sessionB', roomId: 'roomX', text: 'B-sB-X' })
    await service.remember({ ...baseInput, worldId: 'worldA', sessionId: 'sessionA', roomId: 'roomY', text: 'A-sA-Y' })

    const recalled = await service.recall({ worldId: 'worldA', sessionId: 'sessionA', roomId: 'roomX' })
    expect(recalled.memories.map((m) => m.text)).toEqual(['A-sA-X'])
  })
})

describe('RoomMemoryService — memory is supporting context, never truth', () => {
  it('takes no WorldSession seam: constructor arity is (store, clock, idGen, logger)', () => {
    expect(RoomMemoryService.length).toBe(4)
  })

  it('records a player_claim without producing any event/command surface', async () => {
    const { service } = harness()
    const result = await service.remember({
      ...baseInput,
      kind: 'player_claim',
      source: 'player',
      text: 'the east door is locked',
    })
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect(WorldEventSchema.safeParse(result.record).success).toBe(false)
    expect(WorldCommandSchema.safeParse(result.record).success).toBe(false)
    expect('type' in result.record).toBe(false)
  })

  it('records a room_note (generated room text) that coexists as inert context only', async () => {
    const { service } = harness()
    const result = await service.remember({
      ...baseInput,
      kind: 'room_note',
      source: 'game',
      text: 'The great hall smells of pine and old smoke.',
    })
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect(WorldEventSchema.safeParse(result.record).success).toBe(false)
    expect(WorldCommandSchema.safeParse(result.record).success).toBe(false)
    // room_note is stored and recalled but never updates RoomSpec or worldState
    const recalled = await service.recall(scopeOf(baseInput))
    expect(recalled.memories).toHaveLength(1)
    expect(recalled.memories[0]!.kind).toBe('room_note')
  })

  it('records a room_summary with no event/command surface', async () => {
    const { service } = harness()
    const result = await service.remember({
      ...baseInput,
      kind: 'room_summary',
      source: 'game',
      text: 'Player entered and interacted with the chest.',
    })
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect(WorldEventSchema.safeParse(result.record).success).toBe(false)
    expect(WorldCommandSchema.safeParse(result.record).success).toBe(false)
  })

  it('records a source:llm memory only as scoped memory, never a command/event', async () => {
    const { service } = harness()
    const result = await service.remember({
      ...baseInput,
      kind: 'room_observation',
      source: 'llm',
      text: 'the west gate looked rusted',
    })
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect(result.record.provenance.source).toBe('llm')
    expect(WorldCommandSchema.safeParse(result.record).success).toBe(false)
    expect(WorldEventSchema.safeParse(result.record).success).toBe(false)
  })

  it('the only store surface used is record/listForRoom (no world write path)', async () => {
    const calls: string[] = []
    const inner = new InMemoryRoomMemoryStore()
    const recordingStore: RoomMemoryStore = {
      record: (input) => {
        calls.push('record')
        return inner.record(input)
      },
      listForRoom: (scope, options) => {
        calls.push('listForRoom')
        return inner.listForRoom(scope, options)
      },
    }
    const service = new RoomMemoryService(
      recordingStore,
      { now: () => '2026-06-23T10:00:00.000Z' },
      { newId: () => 'mem-1' },
      capturingLogger([]),
    )
    await service.remember(baseInput)
    await service.recall(scopeOf(baseInput))
    expect(new Set(calls)).toEqual(new Set(['record', 'listForRoom']))
  })
})

describe('RoomMemoryService — log safety', () => {
  it('logs ids/enums/counts/codes only — never text or player lines', async () => {
    const { service, entries } = harness()
    const secretText = 'SECRET-ROOM-MEMORY-TEXT-the-east-door-is-open'
    await service.remember({ ...baseInput, text: secretText })
    await service.remember({ ...baseInput, text: '   ' }) // rejected
    await service.recall(scopeOf(baseInput))

    // a store failure path through a capturing logger
    const failEntries: LogEntry[] = []
    const failing = new RoomMemoryService(
      new FailingStore('conflict'),
      { now: () => '2026-06-23T10:00:00.000Z' },
      { newId: () => 'mem-fail' },
      capturingLogger(failEntries),
    )
    await failing.remember({ ...baseInput, text: secretText })

    const serialized = JSON.stringify([...entries, ...failEntries])
    expect(serialized).not.toContain(secretText)
    // ids / enums / codes are present
    expect(serialized).toContain('player_claim')
    expect(serialized).toContain('mem-0001')
    expect(serialized).toContain('conflict')
  })
})

describe('RoomMemoryService — carries recall metadata (Slice C)', () => {
  it('persists importance/dedupeKey/entitySnapshots onto the record and recalls them', async () => {
    const { service } = harness()
    const result = await service.remember({
      ...baseInput,
      importance: 3,
      dedupeKey: 'world-1|session-1|room-state-changed|evt-1',
      entitySnapshots: { room: { id: 'room_library_3a', displayName: 'Old Library' } },
    })
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect(result.record.importance).toBe(3)
    expect(result.record.dedupeKey).toBe('world-1|session-1|room-state-changed|evt-1')
    expect(result.record.entitySnapshots).toEqual({ room: { id: 'room_library_3a', displayName: 'Old Library' } })

    const recalled = await service.recall(scopeOf(baseInput))
    expect(recalled.memories[0]?.importance).toBe(3)
  })

  it('omits metadata fields when not provided (back-compat record shape)', async () => {
    const { service } = harness()
    const result = await service.remember(baseInput)
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect('importance' in result.record).toBe(false)
    expect('dedupeKey' in result.record).toBe(false)
    expect('entitySnapshots' in result.record).toBe(false)
  })
})

describe('RoomMemoryService — dedupe (Slice C3)', () => {
  it('a repeated dedupeKey remembers once, then reports deduplicated with the original record', async () => {
    const { service } = harness()
    const first = await service.remember({ ...baseInput, dedupeKey: 'evt-1' })
    expect(first.status).toBe('recorded')
    if (first.status !== 'recorded') return

    const second = await service.remember({ ...baseInput, text: 'a different draft', dedupeKey: 'evt-1' })
    expect(second).toEqual({ status: 'deduplicated', record: first.record })
  })

  it('does not log memory text on a deduplicated write', async () => {
    const { service, entries } = harness()
    const secretText = 'SECRET-ROOM-DEDUPE-TEXT-xyz'
    await service.remember({ ...baseInput, text: secretText, dedupeKey: 'evt-1' })
    await service.remember({ ...baseInput, text: secretText, dedupeKey: 'evt-1' })
    const serialized = JSON.stringify(entries)
    expect(serialized).not.toContain(secretText)
    expect(serialized).toContain('deduplicated')
  })

  it('a promoted draft (promoteWorldEvent) dedupes end-to-end through remember', async () => {
    const { service } = harness()
    const event: WorldEvent = {
      schemaVersion: WORLD_SCHEMA_VERSION,
      eventId: '11111111-1111-4111-8111-111111111111',
      sessionId: 'session-1',
      seq: 1,
      occurredAt: '2026-06-30T00:00:00.000Z',
      type: 'room-state-changed',
      payload: { roomId: 'room-1', flags: { burned: true } },
    }
    const promoted = promoteWorldEvent(event, { worldId: 'world-1' })
    expect(promoted).not.toBeNull()
    expect(promoted?.input.dedupeKey).toBeDefined()
    expect(promoted?.input.importance).toBe(promoted?.importance)

    // Simulate the same committed event being promoted/remembered twice
    // (e.g. an orchestrator replay) — the second call must dedupe, not double-write.
    const first = await service.remember(promoted!.input)
    const second = await service.remember(promoted!.input)
    expect(first.status).toBe('recorded')
    expect(second.status).toBe('deduplicated')
    if (first.status !== 'recorded' || second.status !== 'deduplicated') return
    expect(second.record.memoryId).toBe(first.record.memoryId)

    const recalled = await service.recall(scopeOf(promoted!.input))
    expect(recalled.memories).toHaveLength(1)
  })
})
