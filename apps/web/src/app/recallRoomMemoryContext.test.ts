import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { RoomMemoryInsert, RoomMemoryRecord, RoomMemoryScope } from '../domain/memory/roomContracts'
import type { RoomMemoryStore, RoomMemoryWriteResult } from '../domain/ports/RoomMemoryStore'
import type { Logger, LogContext, LogLevel } from '../platform/logger/Logger'
import { InMemoryRoomMemoryStore } from '../memory/InMemoryRoomMemoryStore'
import { RoomMemoryService } from '../memory/RoomMemoryService'
import { DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT, recallRoomMemoryContext } from './recallRoomMemoryContext'

const WORLD_ID = 'world-1'
const SESSION_ID = '33333333-3333-4333-8333-333333333333'
const ROOM_ID = 'old-library'
const OTHER_ROOM_ID = 'boiler-room'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

function createSpyLogger(entries: LogEntry[]): Logger {
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
  let id = 1
  const idGenerator: IdGenerator = { newId: () => `mem-${String(id++).padStart(4, '0')}` }
  const clock: Clock = { now: () => '2026-07-01T00:00:00.000Z' }
  const entries: LogEntry[] = []
  const logger = createSpyLogger(entries)
  const service = new RoomMemoryService(store, clock, idGenerator, logger)
  return { store, service, logger, entries }
}

const scope: RoomMemoryScope = { worldId: WORLD_ID, sessionId: SESSION_ID, roomId: ROOM_ID }

describe('recallRoomMemoryContext', () => {
  it('bounds recall to the default top-N dialogue limit', async () => {
    const { service, logger } = harness()
    for (let i = 0; i < 8; i += 1) {
      await service.remember({
        worldId: WORLD_ID,
        sessionId: SESSION_ID,
        roomId: ROOM_ID,
        kind: 'room_observation',
        source: 'game',
        text: `memory-${i}`,
      })
    }

    const context = await recallRoomMemoryContext(scope, service, logger)

    expect(context.entries.length).toBe(DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT)
  })

  it('degrades to an empty context when the store throws, logging only a safe code', async () => {
    const throwingStore: RoomMemoryStore = {
      record: (): Promise<RoomMemoryWriteResult> => Promise.reject(new Error('SECRET DB FAILURE')),
      listForRoom: (): Promise<RoomMemoryRecord[]> => Promise.reject(new Error('SECRET DB FAILURE')),
    }
    const idGenerator: IdGenerator = { newId: () => 'mem-0001' }
    const clock: Clock = { now: () => '2026-07-01T00:00:00.000Z' }
    const entries: LogEntry[] = []
    const logger = createSpyLogger(entries)
    const service = new RoomMemoryService(throwingStore, clock, idGenerator, logger)

    const context = await recallRoomMemoryContext(scope, service, logger)

    expect(context).toEqual({ entries: [] })
    const logs = JSON.stringify(entries)
    expect(logs).not.toContain('SECRET DB FAILURE')
    expect(entries.some((entry) => entry.context.code === 'recall-threw')).toBe(true)
  })

  it('filters to only the requested room, even when other rooms have memories', async () => {
    const { service, logger } = harness()
    await service.remember({
      worldId: WORLD_ID,
      sessionId: SESSION_ID,
      roomId: ROOM_ID,
      kind: 'room_observation',
      source: 'game',
      text: 'the-current-room-memory',
    })
    await service.remember({
      worldId: WORLD_ID,
      sessionId: SESSION_ID,
      roomId: OTHER_ROOM_ID,
      kind: 'room_observation',
      source: 'game',
      text: 'a-different-room-memory',
    })

    const context = await recallRoomMemoryContext(scope, service, logger)

    expect(context.entries).toHaveLength(1)
    expect(context.entries[0]?.text).toBe('the-current-room-memory')
  })

  it('orders entries by rankMemories score (an activeNpcId match ranks first)', async () => {
    const { service, logger } = harness()
    await service.remember({
      worldId: WORLD_ID,
      sessionId: SESSION_ID,
      roomId: ROOM_ID,
      kind: 'room_note',
      source: 'game',
      text: 'unrelated-note',
      importance: 1,
    })
    await service.remember({
      worldId: WORLD_ID,
      sessionId: SESSION_ID,
      roomId: ROOM_ID,
      kind: 'room_observation',
      source: 'npc',
      text: 'npc-specific-memory',
      importance: 1,
      npcId: 'steward',
    })

    const context = await recallRoomMemoryContext(scope, service, logger, { activeNpcId: 'steward' })

    expect(context.entries[0]?.text).toBe('npc-specific-memory')
  })

  it('never writes to the store during recall', async () => {
    const store = new InMemoryRoomMemoryStore()
    let recordCalls = 0
    const spyStore: RoomMemoryStore = {
      record: (input: RoomMemoryInsert): Promise<RoomMemoryWriteResult> => {
        recordCalls += 1
        return store.record(input)
      },
      listForRoom: (s, options) => store.listForRoom(s, options),
    }
    const idGenerator: IdGenerator = { newId: () => 'mem-0001' }
    const clock: Clock = { now: () => '2026-07-01T00:00:00.000Z' }
    const entries: LogEntry[] = []
    const logger = createSpyLogger(entries)
    const service = new RoomMemoryService(spyStore, clock, idGenerator, logger)

    await recallRoomMemoryContext(scope, service, logger)

    expect(recordCalls).toBe(0)
  })
})
