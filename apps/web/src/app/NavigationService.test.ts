import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import { projectWorldState } from '../domain/world/applyEvent'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { LogContext, Logger } from '../platform/logger/Logger'
import { InMemoryWorldStore } from '../world-session/InMemoryWorldStore'
import { WorldSession } from '../world-session/WorldSession'
import type { RoomResolver, ResolveRoomResult } from './AdjacentRoomPregenerator'
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

/** A RoomResolver stub that returns a fixed outcome for any id. */
function fixedResolver(outcome: ResolveRoomResult): RoomResolver {
  return { resolveRoom: async () => outcome }
}

function resolved(
  room: LoadedRoom,
  source: 'cache' | 'registry' | 'generated',
  cacheHit = false,
): RoomResolver {
  return fixedResolver({ ok: true, room, cacheHit, source })
}

async function start(session: WorldSession) {
  const started = await session.startSession(canon)
  if (!started.ok) throw new Error(started.error.code)
  return started.state
}

describe('NavigationService', () => {
  it('moves on a resolved room, appending the existing event and marking it visited', async () => {
    const harness = createHarness()
    const state = await start(harness.session)
    const service = new NavigationService(harness.session, resolved(roomB, 'registry'), harness.logger)

    const result = await service.navigate({ sessionId: state.sessionId, toRoomId: roomB.id })
    expect(result.status).toBe('navigated')
    if (result.status !== 'navigated') return
    expect(result.cacheHit).toBe(false)
    expect(result.room).toBe(roomB)
    expect(result.state.currentRoomId).toBe(roomB.id)
    expect(result.state.roomStates[roomB.id]?.visited).toBe(true)
    const events = await harness.store.listEvents(state.sessionId)
    expect(events.map((event) => event.type)).toEqual(['session-started', 'moved-to-room'])
    expect(projectWorldState(events)).toEqual(result.state)
  })

  it('navigates a non-authored target resolved on demand (generated source)', async () => {
    const harness = createHarness()
    const state = await start(harness.session)
    // The resolver acquired this room by generating it (source: 'generated').
    // NavigationService is agnostic to HOW the room was resolved.
    const service = new NavigationService(harness.session, resolved(roomB, 'generated'), harness.logger)

    const result = await service.navigate({ sessionId: state.sessionId, toRoomId: roomB.id })

    expect(result.status).toBe('navigated')
    if (result.status !== 'navigated') return
    expect(result.state.currentRoomId).toBe(roomB.id)
    const events = await harness.store.listEvents(state.sessionId)
    expect(events.map((event) => event.type)).toEqual(['session-started', 'moved-to-room'])
  })

  it('propagates the resolver cacheHit into the navigation result', async () => {
    const harness = createHarness()
    const state = await start(harness.session)
    const service = new NavigationService(harness.session, resolved(roomB, 'cache', true), harness.logger)

    const result = await service.navigate({ sessionId: state.sessionId, toRoomId: roomB.id })
    expect(result.status === 'navigated' && result.cacheHit).toBe(true)
  })

  it('maps an invalid-room resolver failure to failed without appending', async () => {
    const harness = createHarness()
    const state = await start(harness.session)
    const service = new NavigationService(
      harness.session,
      fixedResolver({ ok: false, reason: 'invalid-room' }),
      harness.logger,
    )

    expect(await service.navigate({ sessionId: state.sessionId, toRoomId: roomB.id }))
      .toEqual({ status: 'failed', reason: 'invalid-room' })
    expect(await harness.store.listEvents(state.sessionId)).toHaveLength(1)
  })

  it('maps an unavailable resolver failure to failed without appending', async () => {
    const harness = createHarness()
    const state = await start(harness.session)
    const service = new NavigationService(
      harness.session,
      fixedResolver({ ok: false, reason: 'unavailable' }),
      harness.logger,
    )

    expect(await service.navigate({ sessionId: state.sessionId, toRoomId: roomB.id }))
      .toEqual({ status: 'failed', reason: 'unavailable' })
    expect(await harness.store.listEvents(state.sessionId)).toHaveLength(1)
  })

  it('rejects self-navigation without appending', async () => {
    const harness = createHarness()
    const state = await start(harness.session)
    const service = new NavigationService(harness.session, resolved(roomA, 'cache', true), harness.logger)

    expect(await service.navigate({ sessionId: state.sessionId, toRoomId: roomA.id }))
      .toEqual({ status: 'rejected', reason: 'already-here' })
    expect(await harness.store.listEvents(state.sessionId)).toHaveLength(1)
  })

  it('maps a missing session to not-found after resolving the target', async () => {
    const harness = createHarness()
    const service = new NavigationService(harness.session, resolved(roomB, 'registry'), harness.logger)
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
      resolved(roomB, 'registry'),
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
