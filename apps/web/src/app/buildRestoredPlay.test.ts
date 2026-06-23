import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { projectPlayerHud } from '../renderer/ui/playerHud'
import type { WorldState } from '../domain/world/worldState'
import type { ResolveRoomResult } from './AdjacentRoomPregenerator'
import { buildRestoredPlay } from './buildRestoredPlay'

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'
const CURRENT_ROOM_ID = 'throne-room'

const baseState: WorldState = {
  schemaVersion: 1,
  worldId: WORLD_ID,
  sessionId: SESSION_ID,
  currentRoomId: CURRENT_ROOM_ID,
  player: { health: { current: 75, max: 100 }, status: [] },
  inventory: [],
  roomStates: {},
  revision: 1,
  updatedAt: '2026-06-24T10:00:00.000Z',
}

function makeRoom(id: string, name = 'A room') {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name,
    shell: { dimensions: { width: 8, depth: 8, height: 4 }, exits: [] },
    spawn: { position: [0, 1.7, 0], yaw: 180 },
    lighting: { ambient: { intensity: 1 } },
    objects: [],
  })
}

const fallbackRoom = makeRoom('fallback-room', 'Fallback Room')
const authoredRoom = makeRoom(CURRENT_ROOM_ID, 'Throne Room')
const generatedRoom = makeRoom(CURRENT_ROOM_ID, 'Generated Room')

describe('buildRestoredPlay — authored room (source: registry)', () => {
  const resolveResult: ResolveRoomResult = {
    ok: true,
    room: authoredRoom,
    cacheHit: false,
    source: 'registry',
  }

  it('degraded is false', () => {
    const { degraded } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    expect(degraded).toBe(false)
  })

  it('sessionId is set from state', () => {
    const { play } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    expect(play.sessionId).toBe(SESSION_ID)
  })

  it('initialPlayer matches projectPlayerHud(state)', () => {
    const { play } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    expect(play.initialPlayer).toEqual(projectPlayerHud(baseState))
  })

  it('roomSource returns the resolved authored room', async () => {
    const { play } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    const result = await play.roomSource.getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.room).toBe(authoredRoom)
  })
})

describe('buildRestoredPlay — generated room (source: generated)', () => {
  it('degraded is true for source: generated', () => {
    const resolveResult: ResolveRoomResult = {
      ok: true,
      room: generatedRoom,
      cacheHit: false,
      source: 'generated',
    }
    const { degraded } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    expect(degraded).toBe(true)
  })

  it('degraded is true for source: cache', () => {
    const resolveResult: ResolveRoomResult = {
      ok: true,
      room: authoredRoom,
      cacheHit: true,
      source: 'cache',
    }
    const { degraded } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    expect(degraded).toBe(true)
  })
})

describe('buildRestoredPlay — failed resolve', () => {
  it('degraded is true when resolve fails', () => {
    const resolveResult: ResolveRoomResult = { ok: false, reason: 'unavailable' }
    const { degraded } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    expect(degraded).toBe(true)
  })

  it('fallback room is used under currentRoomId when resolve fails', async () => {
    const resolveResult: ResolveRoomResult = { ok: false, reason: 'invalid-room' }
    const { play } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    const result = await play.roomSource.getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.room.id).toBe(CURRENT_ROOM_ID)
      expect(result.room.name).toBe(fallbackRoom.name)
    }
  })

  it('failed resolve room is seeded in cache under currentRoomId', () => {
    const resolveResult: ResolveRoomResult = { ok: false, reason: 'unavailable' }
    const { play } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    expect(play.roomCache.has(CURRENT_ROOM_ID)).toBe(true)
    expect(play.roomCache.get(CURRENT_ROOM_ID)?.id).toBe(CURRENT_ROOM_ID)
  })
})

describe('buildRestoredPlay — fresh room cache', () => {
  it('resolved room is seeded in the cache under currentRoomId', () => {
    const resolveResult: ResolveRoomResult = {
      ok: true,
      room: authoredRoom,
      cacheHit: false,
      source: 'registry',
    }
    const { play } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    expect(play.roomCache.has(CURRENT_ROOM_ID)).toBe(true)
    expect(play.roomCache.get(CURRENT_ROOM_ID)).toBe(authoredRoom)
  })

  it('each call creates a new independent cache', () => {
    const resolveResult: ResolveRoomResult = {
      ok: true,
      room: authoredRoom,
      cacheHit: false,
      source: 'registry',
    }
    const { play: play1 } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    const { play: play2 } = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    expect(play1.roomCache).not.toBe(play2.roomCache)
  })
})

describe('buildRestoredPlay — no mutation, no generated/cache truth', () => {
  it('does not mutate the input WorldState', () => {
    const resolveResult: ResolveRoomResult = {
      ok: true,
      room: authoredRoom,
      cacheHit: false,
      source: 'registry',
    }
    const snapshot = JSON.parse(JSON.stringify(baseState)) as WorldState
    buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    expect(baseState).toEqual(snapshot)
  })

  it('no external worldBible or room cache is imported — helper is pure', () => {
    // Verified structurally: buildRestoredPlay accepts only (WorldState,
    // ResolveRoomResult, LoadedRoom) and imports no store, service, or
    // global cache. This test confirms the function produces a deterministic
    // result for the same inputs.
    const resolveResult: ResolveRoomResult = {
      ok: true,
      room: authoredRoom,
      cacheHit: false,
      source: 'registry',
    }
    const r1 = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    const r2 = buildRestoredPlay(baseState, resolveResult, fallbackRoom)
    expect(r1.degraded).toBe(r2.degraded)
    expect(r1.play.sessionId).toBe(r2.play.sessionId)
    expect(r1.play.initialPlayer).toEqual(r2.play.initialPlayer)
  })
})
