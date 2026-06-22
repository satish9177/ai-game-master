import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import { projectWorldState } from '../domain/world/applyEvent'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { LogContext, Logger } from '../platform/logger/Logger'
import { RoomRegistry } from '../room/RoomRegistry'
import { SessionRoomCache } from '../room/SessionRoomCache'
import { InMemoryWorldStore } from '../world-session/InMemoryWorldStore'
import { WorldSession } from '../world-session/WorldSession'
import { NavigationService } from './NavigationService'

const roomA = loadRoomSpec({
  schemaVersion: 1,
  id: 'room-a',
  name: 'SECRET ROOM A',
  shell: { dimensions: { width: 8, depth: 8, height: 4 }, exits: [] },
  spawn: { position: [0, 1.7, 2], yaw: 180 },
  lighting: { ambient: { intensity: 1 } },
  objects: [],
})
const roomB = loadRoomSpec({
  schemaVersion: 1,
  id: 'room-b',
  name: 'SECRET ROOM B',
  shell: { dimensions: { width: 8, depth: 8, height: 4 }, exits: [] },
  spawn: { position: [0, 1.7, 2], yaw: 180 },
  lighting: { ambient: { intensity: 1 } },
  objects: [],
})
const canon = {
  schemaVersion: 1,
  worldId: '00000000-0000-4000-8000-000000000001',
  name: 'SECRET WORLD',
  startingRoomId: roomA.id,
  initialPlayer: { health: { current: 10, max: 10 }, status: [], inventory: [] },
}

type LogEntry = { message: string; context: LogContext }

function createHarness() {
  const store = new InMemoryWorldStore()
  let id = 2
  const ids: IdGenerator = {
    newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  let tick = 0
  const clock: Clock = {
    now: () => `2026-06-22T10:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  const logs: LogEntry[] = []
  const logger: Logger = {
    debug: (message, context = {}) => logs.push({ message, context }),
    info: (message, context = {}) => logs.push({ message, context }),
    warn: (message, context = {}) => logs.push({ message, context }),
    error: (message, context = {}) => logs.push({ message, context }),
    child: () => logger,
  }
  const session = new WorldSession(store, clock, ids, logger)
  return { store, logs, logger, session }
}

async function start(session: WorldSession) {
  const started = await session.startSession(canon)
  if (!started.ok) throw new Error(started.error.code)
  return started.state
}

describe('NavigationService', () => {
  it('resolves a cache miss once and returns the identical cached room on a hit', async () => {
    const harness = createHarness()
    let resolves = 0
    const registry = {
      resolve: () => {
        resolves += 1
        return { ok: true, room: roomB } as const
      },
    }
    const service = new NavigationService(
      harness.session,
      registry,
      new SessionRoomCache(),
      harness.logger,
    )

    const first = await service.resolveRoom(roomB.id)
    const second = await service.resolveRoom(roomB.id)

    expect(first.ok && first.cacheHit).toBe(false)
    expect(second.ok && second.cacheHit).toBe(true)
    expect(first.ok && second.ok && first.room === second.room).toBe(true)
    expect(resolves).toBe(1)
  })

  it('does not append when a target is unknown, invalid, or unavailable', async () => {
    const harness = createHarness()
    const state = await start(harness.session)
    const registry = new RoomRegistry({ invalid: {}, [roomB.id]: roomB })
    const service = new NavigationService(
      harness.session,
      registry,
      new SessionRoomCache(),
      harness.logger,
    )

    expect(await service.navigate({ sessionId: state.sessionId, toRoomId: 'missing' }))
      .toEqual({ status: 'rejected', reason: 'unknown-room' })
    expect(await service.navigate({ sessionId: state.sessionId, toRoomId: 'invalid' }))
      .toEqual({ status: 'failed', reason: 'invalid-room' })

    const unavailable = new NavigationService(
      harness.session,
      { resolve: () => { throw new Error('SECRET TRANSPORT FAILURE') } },
      new SessionRoomCache(),
      harness.logger,
    )
    expect(await unavailable.navigate({ sessionId: state.sessionId, toRoomId: roomB.id }))
      .toEqual({ status: 'failed', reason: 'unavailable' })
    expect(await harness.store.listEvents(state.sessionId)).toHaveLength(1)
  })

  it('rejects self-navigation without appending', async () => {
    const harness = createHarness()
    const state = await start(harness.session)
    const service = new NavigationService(
      harness.session,
      new RoomRegistry({ [roomA.id]: roomA }),
      new SessionRoomCache(),
      harness.logger,
    )

    expect(await service.navigate({ sessionId: state.sessionId, toRoomId: roomA.id }))
      .toEqual({ status: 'rejected', reason: 'already-here' })
    expect(await harness.store.listEvents(state.sessionId)).toHaveLength(1)
  })

  it('moves with the existing event and marks the destination visited', async () => {
    const harness = createHarness()
    const state = await start(harness.session)
    const service = new NavigationService(
      harness.session,
      new RoomRegistry({ [roomB.id]: roomB }),
      new SessionRoomCache(),
      harness.logger,
    )

    const result = await service.navigate({ sessionId: state.sessionId, toRoomId: roomB.id })
    expect(result.status).toBe('navigated')
    if (result.status !== 'navigated') return
    expect(result.cacheHit).toBe(false)
    expect(result.state.currentRoomId).toBe(roomB.id)
    expect(result.state.roomStates[roomB.id]?.visited).toBe(true)
    const events = await harness.store.listEvents(state.sessionId)
    expect(events.map((event) => event.type)).toEqual(['session-started', 'moved-to-room'])
    expect(projectWorldState(events)).toEqual(result.state)
  })

  it('returns through the cache while preserving room flags in session state', async () => {
    const harness = createHarness()
    let state = await start(harness.session)
    const cache = new SessionRoomCache()
    cache.set(roomA.id, roomA)
    const service = new NavigationService(
      harness.session,
      new RoomRegistry({ [roomA.id]: roomA, [roomB.id]: roomB }),
      cache,
      harness.logger,
    )
    const flagged = await harness.session.setRoomState(
      state.sessionId,
      roomA.id,
      { flags: { inspected: true } },
      state.revision,
    )
    if (!flagged.ok) throw new Error(flagged.error.code)
    state = flagged.state

    const outward = await service.navigate({ sessionId: state.sessionId, toRoomId: roomB.id })
    if (outward.status !== 'navigated') throw new Error(outward.reason)
    const returned = await service.navigate({ sessionId: state.sessionId, toRoomId: roomA.id })
    if (returned.status !== 'navigated') throw new Error(returned.reason)
    const revisited = await service.navigate({ sessionId: state.sessionId, toRoomId: roomB.id })
    if (revisited.status !== 'navigated') throw new Error(revisited.reason)

    expect(returned.cacheHit).toBe(true)
    expect(returned.room).toBe(roomA)
    expect(revisited.cacheHit).toBe(true)
    expect(revisited.room).toBe(outward.room)
    expect(revisited.state.roomStates[roomA.id]).toMatchObject({
      visited: true,
      flags: { inspected: true },
    })
    const events = await harness.store.listEvents(state.sessionId)
    expect(projectWorldState(events)).toEqual(revisited.state)
  })

  it('maps a missing session to not-found after resolving the target', async () => {
    const harness = createHarness()
    const service = new NavigationService(
      harness.session,
      new RoomRegistry({ [roomB.id]: roomB }),
      new SessionRoomCache(),
      harness.logger,
    )
    expect(await service.navigate({
      sessionId: '00000000-0000-4000-8000-000000000099',
      toRoomId: roomB.id,
    })).toEqual({ status: 'failed', reason: 'not-found' })
  })

  it('maps append conflicts and keeps logs free of narrative values', async () => {
    const harness = createHarness()
    const current = await start(harness.session)
    const service = new NavigationService(
      {
        getWorldState: async () => ({ ok: true, state: current }),
        move: async () => ({
          ok: false,
          error: { code: 'conflict', message: 'SECRET CONFLICT DETAIL' },
        }),
      },
      new RoomRegistry({ [roomB.id]: roomB }),
      new SessionRoomCache(),
      harness.logger,
    )

    expect(await service.navigate({ sessionId: current.sessionId, toRoomId: roomB.id }))
      .toEqual({ status: 'failed', reason: 'conflict' })
    const serialized = JSON.stringify(harness.logs)
    expect(serialized).not.toContain('SECRET')
    expect(serialized).toContain(current.sessionId)
    expect(serialized).toContain(roomB.id)
    expect(serialized).toContain('conflict')
  })
})
