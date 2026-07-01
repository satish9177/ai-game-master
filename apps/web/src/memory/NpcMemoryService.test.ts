import { describe, expect, it } from 'vitest'
import { NpcMemoryRecordSchema } from '../domain/memory/contracts'
import type { MemoryScope, NpcMemoryRecord } from '../domain/memory/contracts'
import type { MemoryDraftInput } from '../domain/memory/firewall'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type {
  NpcMemoryStore,
  NpcMemoryStoreErrorCode,
  NpcMemoryWriteResult,
} from '../domain/ports/NpcMemoryStore'
import { WorldCommandSchema, WorldEventSchema } from '../domain/world/events'
import type { Logger, LogContext, LogLevel } from '../platform/logger/Logger'
import { InMemoryNpcMemoryStore } from './InMemoryNpcMemoryStore'
import { NpcMemoryService } from './NpcMemoryService'

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
  const store = new InMemoryNpcMemoryStore()
  const entries: LogEntry[] = []
  let nextId = 1
  const ids: IdGenerator = { newId: () => `mem-${String(nextId++).padStart(4, '0')}` }
  let tick = 0
  const clock: Clock = { now: () => `2026-06-23T10:00:${String(tick++).padStart(2, '0')}.000Z` }
  const service = new NpcMemoryService(store, clock, ids, capturingLogger(entries))
  return { store, entries, service }
}

const baseInput: MemoryDraftInput = {
  worldId: 'world-1',
  sessionId: 'session-1',
  npcId: 'npc-1',
  kind: 'player_claim',
  source: 'player',
  text: 'the bridge is out',
}

const scopeOf = (i: MemoryDraftInput): MemoryScope => ({
  worldId: i.worldId,
  sessionId: i.sessionId,
  npcId: i.npcId,
})

/** A store that always fails, to drive the `failed` path / log without SQLite. */
class FailingStore implements NpcMemoryStore {
  private readonly code: NpcMemoryStoreErrorCode
  constructor(code: NpcMemoryStoreErrorCode) {
    this.code = code
  }
  async record(): Promise<NpcMemoryWriteResult> {
    return { ok: false, error: { code: this.code } }
  }
  async listForNpc(): Promise<NpcMemoryRecord[]> {
    return []
  }
}

describe('NpcMemoryService.remember', () => {
  it('records a valid memory, stamping memoryId/createdAt and an assigned seq', async () => {
    const { service } = harness()
    const result = await service.remember(baseInput)
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect(result.record.memoryId).toBe('mem-0001')
    expect(result.record.createdAt).toBe('2026-06-23T10:00:00.000Z')
    expect(result.record.seq).toBe(1)
    expect(NpcMemoryRecordSchema.safeParse(result.record).success).toBe(true)
  })

  it('assigns a monotonic seq per (session, npc), independent across npcs', async () => {
    const { service } = harness()
    const a1 = await service.remember(baseInput)
    const a2 = await service.remember(baseInput)
    const b1 = await service.remember({ ...baseInput, npcId: 'npc-2' })
    expect(a1.status === 'recorded' && a1.record.seq).toBe(1)
    expect(a2.status === 'recorded' && a2.record.seq).toBe(2)
    expect(b1.status === 'recorded' && b1.record.seq).toBe(1)
  })

  it('rejects an invalid draft and stores nothing', async () => {
    const { service, store } = harness()
    const result = await service.remember({ ...baseInput, text: '   ' })
    expect(result).toEqual({ status: 'rejected', reason: 'empty-text' })
    expect(await store.listForNpc(scopeOf(baseInput))).toEqual([])
  })

  it('maps a store failure to failed', async () => {
    const entries: LogEntry[] = []
    const service = new NpcMemoryService(
      new FailingStore('session-not-found'),
      { now: () => '2026-06-23T10:00:00.000Z' },
      { newId: () => 'mem-x' },
      capturingLogger(entries),
    )
    const result = await service.remember(baseInput)
    expect(result).toEqual({ status: 'failed', reason: 'session-not-found' })
  })
})

describe('NpcMemoryService.recall', () => {
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
    const recalled = await service.recall({ worldId: 'world-1', sessionId: 'other', npcId: 'npc-1' })
    expect(recalled).toEqual({ status: 'recalled', memories: [] })
  })
})

describe('NpcMemoryService — no cross-world/session/NPC leak', () => {
  it('recall returns only the exact scope triple’s memories', async () => {
    const { service } = harness()
    await service.remember({ ...baseInput, worldId: 'worldA', sessionId: 'sessionA', npcId: 'npc1', text: 'A-sA-1' })
    await service.remember({ ...baseInput, worldId: 'worldB', sessionId: 'sessionB', npcId: 'npc1', text: 'B-sB-1' })
    await service.remember({ ...baseInput, worldId: 'worldA', sessionId: 'sessionA', npcId: 'npc2', text: 'A-sA-2' })

    const recalled = await service.recall({ worldId: 'worldA', sessionId: 'sessionA', npcId: 'npc1' })
    expect(recalled.memories.map((m) => m.text)).toEqual(['A-sA-1'])
  })
})

describe('NpcMemoryService — memory is supporting context, never truth', () => {
  it('takes no WorldSession seam: constructor arity is (store, clock, idGen, logger)', () => {
    expect(NpcMemoryService.length).toBe(4)
  })

  it('records a player_claim without producing any event/command surface', async () => {
    const { service } = harness()
    const result = await service.remember({
      ...baseInput,
      kind: 'player_claim',
      source: 'player',
      text: 'I killed the king',
    })
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect(WorldEventSchema.safeParse(result.record).success).toBe(false)
    expect(WorldCommandSchema.safeParse(result.record).success).toBe(false)
    expect('type' in result.record).toBe(false)
  })

  it('records a (possibly false) npc_belief that simply coexists and recalls', async () => {
    const { service } = harness()
    await service.remember({ ...baseInput, kind: 'npc_belief', source: 'npc', text: 'the player stole the medicine' })
    const recalled = await service.recall(scopeOf(baseInput))
    expect(recalled.memories).toHaveLength(1)
    expect(recalled.memories[0]!.kind).toBe('npc_belief')
  })

  it('records a dialogue_summary with no event/command surface', async () => {
    const { service } = harness()
    const result = await service.remember({ ...baseInput, kind: 'dialogue_summary', source: 'game', text: 'they discussed the bridge' })
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect(WorldEventSchema.safeParse(result.record).success).toBe(false)
  })

  it('records a source:llm memory only as scoped memory, never a command/event', async () => {
    const { service } = harness()
    const result = await service.remember({ ...baseInput, kind: 'npc_observation', source: 'llm', text: 'the gate looked rusted' })
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect(result.record.provenance.source).toBe('llm')
    expect(WorldCommandSchema.safeParse(result.record).success).toBe(false)
    expect(WorldEventSchema.safeParse(result.record).success).toBe(false)
  })

  it('the only store surface used is record/listForNpc (no world write path)', async () => {
    const calls: string[] = []
    const inner = new InMemoryNpcMemoryStore()
    const recordingStore: NpcMemoryStore = {
      record: (input) => {
        calls.push('record')
        return inner.record(input)
      },
      listForNpc: (scope, options) => {
        calls.push('listForNpc')
        return inner.listForNpc(scope, options)
      },
    }
    const service = new NpcMemoryService(
      recordingStore,
      { now: () => '2026-06-23T10:00:00.000Z' },
      { newId: () => 'mem-1' },
      capturingLogger([]),
    )
    await service.remember(baseInput)
    await service.recall(scopeOf(baseInput))
    expect(new Set(calls)).toEqual(new Set(['record', 'listForNpc']))
  })
})

describe('NpcMemoryService — log safety', () => {
  it('logs ids/enums/counts/codes only — never text or player lines', async () => {
    const { service, entries } = harness()
    const secretText = 'SECRET-MEMORY-TEXT-the-king-is-dead'
    await service.remember({ ...baseInput, text: secretText })
    await service.remember({ ...baseInput, text: '   ' }) // rejected
    await service.recall(scopeOf(baseInput))

    // a store failure path through a capturing logger
    const failEntries: LogEntry[] = []
    const failing = new NpcMemoryService(
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

describe('NpcMemoryService — carries recall metadata (Slice C)', () => {
  it('persists importance/dedupeKey/entitySnapshots onto the record and recalls them', async () => {
    const { service } = harness()
    const result = await service.remember({
      ...baseInput,
      importance: 5,
      dedupeKey: 'world-1|session-1|room-state-changed|evt-1',
      entitySnapshots: { room: { id: 'room_library_3a', displayName: 'Old Library' } },
    })
    expect(result.status).toBe('recorded')
    if (result.status !== 'recorded') return
    expect(result.record.importance).toBe(5)
    expect(result.record.dedupeKey).toBe('world-1|session-1|room-state-changed|evt-1')
    expect(result.record.entitySnapshots).toEqual({ room: { id: 'room_library_3a', displayName: 'Old Library' } })

    const recalled = await service.recall(scopeOf(baseInput))
    expect(recalled.memories[0]?.importance).toBe(5)
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

describe('NpcMemoryService — dedupe (Slice C3)', () => {
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
    const secretText = 'SECRET-DEDUPE-TEXT-xyz'
    await service.remember({ ...baseInput, text: secretText, dedupeKey: 'evt-1' })
    await service.remember({ ...baseInput, text: secretText, dedupeKey: 'evt-1' })
    const serialized = JSON.stringify(entries)
    expect(serialized).not.toContain(secretText)
    expect(serialized).toContain('deduplicated')
  })
})
