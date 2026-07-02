import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { RoomMemoryScope } from '../domain/memory/roomContracts'
import type { RoomMemoryStore, RoomMemoryWriteResult } from '../domain/ports/RoomMemoryStore'
import { createDisplayNameResolver } from '../domain/memory/displayNames'
import { WorldEventSchema } from '../domain/world/events'
import type { WorldEvent } from '../domain/world/events'
import type { Logger, LogContext, LogLevel } from '../platform/logger/Logger'
import { InMemoryRoomMemoryStore } from '../memory/InMemoryRoomMemoryStore'
import { RoomMemoryService, type RememberRoomMemoryResult } from '../memory/RoomMemoryService'
import { EMPTY_PROMOTION_SUMMARY } from './memoryFeedback'
import { promoteInteractionMemories } from './promoteInteractionMemories'

/**
 * `promoteWorldEvent` never builds a draft the firewall rejects, so a
 * `rejected` outcome can only be observed by faking `remember` directly
 * (real `RoomMemoryService` has private fields, hence the cast).
 */
function fakeRoomMemory(results: readonly RememberRoomMemoryResult[]): RoomMemoryService {
  let call = 0
  return {
    remember: (): Promise<RememberRoomMemoryResult> => {
      const result = results[call]
      call++
      if (result === undefined) throw new Error('SECRET STORE FAILURE DETAIL')
      return Promise.resolve(result)
    },
  } as unknown as RoomMemoryService
}

const WORLD_ID = 'world-1'
const SESSION_ID = '33333333-3333-4333-8333-333333333333'
const ROOM_ID = 'old-library'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

function createSpyLogger(entries: LogEntry[]): Logger {
  const build = (bindings: LogContext): Logger => {
    const record = (level: LogLevel) => (message: string, context: LogContext = {}) => {
      entries.push({ level, message, context: { ...bindings, ...context } })
    }
    return {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      child: (childBindings) => build({ ...bindings, ...childBindings }),
    }
  }
  return build({})
}

function createHarness() {
  const store = new InMemoryRoomMemoryStore()
  let id = 1
  const idGenerator: IdGenerator = {
    newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  const clock: Clock = { now: () => '2026-07-01T00:00:00.000Z' }
  const entries: LogEntry[] = []
  const logger = createSpyLogger(entries)
  const roomMemory = new RoomMemoryService(store, clock, idGenerator, logger)
  return { store, roomMemory, logger, entries }
}

function roomStateChanged(
  payload: { roomId: string; flags?: Record<string, boolean> },
  envelope?: { eventId?: string; seq?: number },
): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: envelope?.eventId ?? '11111111-1111-4111-8111-111111111111',
    sessionId: SESSION_ID,
    seq: envelope?.seq ?? 1,
    occurredAt: '2026-06-30T00:00:00.000Z',
    type: 'room-state-changed',
    payload,
  })
}

function itemDiscovered(payload: { roomId: string; itemId: string }): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: '22222222-2222-4222-8222-222222222222',
    sessionId: SESSION_ID,
    seq: 2,
    occurredAt: '2026-06-30T00:00:00.000Z',
    type: 'item-discovered',
    payload,
  })
}

function movedToRoom(): WorldEvent {
  return WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: '44444444-4444-4444-8444-444444444444',
    sessionId: SESSION_ID,
    seq: 3,
    occurredAt: '2026-06-30T00:00:00.000Z',
    type: 'moved-to-room',
    payload: { toRoomId: ROOM_ID },
  })
}

describe('promoteInteractionMemories', () => {
  it('promotes a durable room-state-changed event into a recorded room memory', async () => {
    const { store, roomMemory, logger } = createHarness()
    const event = roomStateChanged({ roomId: ROOM_ID, flags: { opened: true } })

    const summary = await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger)

    const records = await store.listForRoom({ worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID })
    expect(records).toHaveLength(1)
    expect(records[0]?.kind).toBe('room_observation')
    expect(summary).toEqual({ recorded: 1, deduplicated: 0, rejected: 0, failed: 0 })
  })

  it('skips a non-promotable event without calling remember', async () => {
    const { store, roomMemory, logger } = createHarness()
    const event = movedToRoom()

    const summary = await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger)

    const records = await store.listForRoom({ worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID })
    expect(records).toHaveLength(0)
    expect(summary).toEqual(EMPTY_PROMOTION_SUMMARY)
  })

  it('returns a zero summary when there are no events', async () => {
    const { roomMemory, logger } = createHarness()

    const summary = await promoteInteractionMemories([], WORLD_ID, roomMemory, logger)

    expect(summary).toEqual(EMPTY_PROMOTION_SUMMARY)
  })

  it('dedupes the same committed event replayed across two calls (store-level C3 dedupe)', async () => {
    const { store, roomMemory, logger } = createHarness()
    const event = roomStateChanged({ roomId: ROOM_ID, flags: { burned: true } })

    const first = await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger)
    const second = await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger)

    const scope: RoomMemoryScope = { worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID }
    const records = await store.listForRoom(scope)
    expect(records).toHaveLength(1)
    expect(first).toEqual({ recorded: 1, deduplicated: 0, rejected: 0, failed: 0 })
    expect(second).toEqual({ recorded: 0, deduplicated: 1, rejected: 0, failed: 0 })
  })

  it('counts a rejected remember outcome', async () => {
    const entries: LogEntry[] = []
    const logger = createSpyLogger(entries)
    const roomMemory = fakeRoomMemory([{ status: 'rejected', reason: 'text-too-long' }])
    const event = roomStateChanged({ roomId: ROOM_ID, flags: { collapsed: true } })

    const summary = await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger)

    expect(summary).toEqual({ recorded: 0, deduplicated: 0, rejected: 1, failed: 0 })
  })

  it('counts a store-reported failure (ok: false) without throwing', async () => {
    const failingStore: RoomMemoryStore = {
      record: (): Promise<RoomMemoryWriteResult> =>
        Promise.resolve({ ok: false, error: { code: 'session-not-found' } }),
      listForRoom: () => Promise.resolve([]),
    }
    const idGenerator: IdGenerator = { newId: () => '00000000-0000-4000-8000-000000000001' }
    const clock: Clock = { now: () => '2026-07-01T00:00:00.000Z' }
    const entries: LogEntry[] = []
    const logger = createSpyLogger(entries)
    const roomMemory = new RoomMemoryService(failingStore, clock, idGenerator, logger)
    const event = roomStateChanged({ roomId: ROOM_ID, flags: { collapsed: true } })

    const summary = await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger)

    expect(summary).toEqual({ recorded: 0, deduplicated: 0, rejected: 0, failed: 1 })
  })

  it('does not throw when the store rejects, counts it as failed, and logs a safe code only', async () => {
    const throwingStore: RoomMemoryStore = {
      record: (): Promise<RoomMemoryWriteResult> =>
        Promise.reject(new Error('SECRET STORE FAILURE DETAIL')),
      listForRoom: () => Promise.resolve([]),
    }
    const idGenerator: IdGenerator = { newId: () => '00000000-0000-4000-8000-000000000001' }
    const clock: Clock = { now: () => '2026-07-01T00:00:00.000Z' }
    const entries: LogEntry[] = []
    const logger = createSpyLogger(entries)
    const roomMemory = new RoomMemoryService(throwingStore, clock, idGenerator, logger)
    const event = roomStateChanged({ roomId: ROOM_ID, flags: { collapsed: true } })

    const summary = await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger)

    expect(summary).toEqual({ recorded: 0, deduplicated: 0, rejected: 0, failed: 1 })

    const logs = JSON.stringify(entries)
    expect(logs).not.toContain('SECRET STORE FAILURE DETAIL')
    expect(entries.some((entry) => entry.context.code === 'promotion-threw')).toBe(true)
  })

  it('produces correct counts for mixed outcomes across multiple events', async () => {
    // Call order: recorded, deduplicated, rejected, failed; the 5th call (no
    // entry left) simulates an unexpected store throw, also counted as failed.
    const entries: LogEntry[] = []
    const logger = createSpyLogger(entries)
    const roomMemory = fakeRoomMemory([
      { status: 'recorded', record: { memoryId: 'm1' } as never },
      { status: 'deduplicated', record: { memoryId: 'm1' } as never },
      { status: 'rejected', reason: 'text-too-long' },
      { status: 'failed', reason: 'session-not-found' },
    ])
    const events = [
      roomStateChanged({ roomId: ROOM_ID, flags: { a: true } }, { eventId: '11111111-1111-4111-8111-111111111111', seq: 1 }),
      roomStateChanged({ roomId: ROOM_ID, flags: { b: true } }, { eventId: '22222222-2222-4222-8222-222222222222', seq: 2 }),
      roomStateChanged({ roomId: ROOM_ID, flags: { c: true } }, { eventId: '33333333-3333-4333-8333-333333333333', seq: 3 }),
      roomStateChanged({ roomId: ROOM_ID, flags: { d: true } }, { eventId: '44444444-4444-4444-8444-444444444444', seq: 4 }),
      roomStateChanged({ roomId: ROOM_ID, flags: { e: true } }, { eventId: '55555555-5555-4555-8555-555555555555', seq: 5 }),
    ]

    const summary = await promoteInteractionMemories(events, WORLD_ID, roomMemory, logger)

    expect(summary).toEqual({ recorded: 1, deduplicated: 1, rejected: 1, failed: 2 })
  })

  it('promotes item-discovered with named text when a display-name resolver is supplied', async () => {
    const { store, roomMemory, logger } = createHarness()
    const event = itemDiscovered({ roomId: ROOM_ID, itemId: 'silver-key' })
    const displayNames = createDisplayNameResolver({
      room: { [ROOM_ID]: 'Old Library' },
      item: { 'silver-key': 'Silver Key' },
    })

    await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger, displayNames)

    const records = await store.listForRoom({ worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID })
    expect(records).toHaveLength(1)
    expect(records[0]?.text).toBe('The player found the Silver Key in the Old Library.')
  })

  it('promotes multiple committed events from one interaction in order', async () => {
    const { store, roomMemory, logger } = createHarness()
    const discovered = itemDiscovered({ roomId: ROOM_ID, itemId: 'silver-key' })
    const stateChanged = roomStateChanged(
      { roomId: ROOM_ID, flags: { 'interaction:medical-crate': true } },
      { eventId: '55555555-5555-4555-8555-555555555555', seq: 4 },
    )

    await promoteInteractionMemories([discovered, stateChanged], WORLD_ID, roomMemory, logger)

    const records = await store.listForRoom({ worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID })
    expect(records).toHaveLength(2)
    expect(records.map((r) => r.kind)).toEqual(['room_observation', 'room_observation'])
  })
})
