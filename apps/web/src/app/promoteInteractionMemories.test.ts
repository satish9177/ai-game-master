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
import { RoomMemoryService } from '../memory/RoomMemoryService'
import { promoteInteractionMemories } from './promoteInteractionMemories'

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

    await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger)

    const records = await store.listForRoom({ worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID })
    expect(records).toHaveLength(1)
    expect(records[0]?.kind).toBe('room_observation')
  })

  it('skips a non-promotable event without calling remember', async () => {
    const { store, roomMemory, logger } = createHarness()
    const event = movedToRoom()

    await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger)

    const records = await store.listForRoom({ worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID })
    expect(records).toHaveLength(0)
  })

  it('dedupes the same committed event replayed across two calls (store-level C3 dedupe)', async () => {
    const { store, roomMemory, logger } = createHarness()
    const event = roomStateChanged({ roomId: ROOM_ID, flags: { burned: true } })

    await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger)
    await promoteInteractionMemories([event], WORLD_ID, roomMemory, logger)

    const scope: RoomMemoryScope = { worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID }
    const records = await store.listForRoom(scope)
    expect(records).toHaveLength(1)
  })

  it('does not throw when the store rejects, and logs a safe code only', async () => {
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

    await expect(
      promoteInteractionMemories([event], WORLD_ID, roomMemory, logger),
    ).resolves.toBeUndefined()

    const logs = JSON.stringify(entries)
    expect(logs).not.toContain('SECRET STORE FAILURE DETAIL')
    expect(entries.some((entry) => entry.context.code === 'promotion-threw')).toBe(true)
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
