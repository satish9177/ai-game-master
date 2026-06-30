import restoreGeneratedQuestPlaySource from './restoreGeneratedQuestPlay.ts?raw'
import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import {
  buildGeneratedQuestSaveState,
  type GeneratedQuestSaveInput,
  type GeneratedQuestSaveState,
} from '../domain/quests/generatedQuestSaveState'
import type { QuestSpec } from '../domain/quests/questSpec'
import type { GeneratedStoryThreadKind } from '../domain/generatedStoryThread'
import type { WorldState } from '../domain/world/worldState'
import { restoreGeneratedQuestPlay } from './restoreGeneratedQuestPlay'

const ROOM_ID = 'room-1'
const OBJECT_ID = 'case-file'
const FLAG_KEY = `interaction:${OBJECT_ID}`

function makeLoadedRoom(id = ROOM_ID) {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name: 'Generated Chamber',
    shell: { dimensions: { width: 8, depth: 8, height: 4 }, exits: [] },
    spawn: { position: [0, 1.7, 0], yaw: 180 },
    lighting: { ambient: { intensity: 1 } },
    objects: [
      {
        type: 'scroll',
        id: OBJECT_ID,
        position: [1, 0, 1],
        interaction: { key: 'E', prompt: 'Read the file', effect: { kind: 'inspect' } },
      },
    ],
  })
}

const questSpec: QuestSpec = {
  questId: 'q1',
  title: 'Find the truth',
  anchorRoomId: ROOM_ID,
  objectives: [
    {
      id: 'o1',
      text: 'Inspect the case file',
      condition: { kind: 'room-flag', roomId: ROOM_ID, flag: FLAG_KEY },
    },
  ],
}

function makeWorldState(flags?: Record<string, boolean>): WorldState {
  return {
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
    currentRoomId: ROOM_ID,
    player: { health: { current: 80, max: 100 }, status: [] },
    inventory: [],
    roomStates:
      flags === undefined ? {} : { [ROOM_ID]: { visited: true, flags } },
    revision: 1,
    updatedAt: '2026-06-30T10:00:00.000Z',
  }
}

function makeState(
  extra: Omit<GeneratedQuestSaveInput, 'room' | 'objectivesPerRoom'> = {},
): GeneratedQuestSaveState {
  const built = buildGeneratedQuestSaveState({
    room: makeLoadedRoom(),
    objectivesPerRoom: true,
    ...extra,
  })
  if (built == null) throw new Error('fixture build failed')
  return built
}

describe('restoreGeneratedQuestPlay — valid snapshot', () => {
  it('returns a loaded room for a valid snapshot + restored WorldState', () => {
    const result = restoreGeneratedQuestPlay(makeState(), makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.play.room.id).toBe(ROOM_ID)
    expect(result.play.room.name).toBe('Generated Chamber')
  })

  it('preserves object ids from the parked room', () => {
    const state = makeState()
    const result = restoreGeneratedQuestPlay(state, makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.play.room.objects.map((o) => o.id)).toEqual(
      state.room.objects.map((o) => (o as { id?: string }).id),
    )
    expect(result.play.room.objects.map((o) => o.id)).toContain(OBJECT_ID)
  })

  it('seeds the room cache and a preloaded room source with the restored room', async () => {
    const result = restoreGeneratedQuestPlay(makeState(), makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.play.roomCache.get(ROOM_ID)).toBe(result.play.room)
    const sourced = await result.play.roomSource.getRoom()
    expect(sourced.ok).toBe(true)
    if (sourced.ok) expect(sourced.room).toBe(result.play.room)
  })

  it('projects initialPlayer from the restored WorldState', () => {
    const world = makeWorldState()
    const result = restoreGeneratedQuestPlay(makeState(), world)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.play.initialPlayer.health).toEqual({
      current: 80,
      max: 100,
      fraction: 0.8,
    })
  })

  it('always reports objectivesPerRoom: true', () => {
    const result = restoreGeneratedQuestPlay(makeState(), makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.play.objectivesPerRoom).toBe(true)
  })
})

describe('restoreGeneratedQuestPlay — resolved object ids', () => {
  it('recomputes resolved ids from restored flags + restored room', () => {
    const result = restoreGeneratedQuestPlay(
      makeState(),
      makeWorldState({ [FLAG_KEY]: true }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...(result.play.entryResolvedObjectIds ?? [])]).toEqual([OBJECT_ID])
  })

  it('returns no resolved ids when the restored flag is absent', () => {
    const result = restoreGeneratedQuestPlay(makeState(), makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...(result.play.entryResolvedObjectIds ?? [])]).toEqual([])
  })
})

describe('restoreGeneratedQuestPlay — optional quest fields', () => {
  it('returns questSpec unchanged when present', () => {
    const state = makeState({ questSpec })
    const result = restoreGeneratedQuestPlay(state, makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.play.questSpec).toEqual(state.questSpec)
  })

  it('omits questSpec when absent from the snapshot', () => {
    const result = restoreGeneratedQuestPlay(makeState(), makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.play.questSpec).toBeUndefined()
  })

  it.each<GeneratedStoryThreadKind>([
    'escape',
    'investigate',
    'survive',
    'rescue',
    'recover-item',
  ])('returns storyKind "%s" when present', (storyKind) => {
    const result = restoreGeneratedQuestPlay(makeState({ storyKind }), makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.play.storyKind).toBe(storyKind)
  })

  it('omits storyKind when absent from the snapshot', () => {
    const result = restoreGeneratedQuestPlay(makeState(), makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.play.storyKind).toBeUndefined()
  })

  it('returns hints when present', () => {
    const hints = { hint: 'Look for the case file', completionHint: 'You found it' }
    const result = restoreGeneratedQuestPlay(makeState({ hints }), makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.play.hints).toEqual(hints)
  })

  it('omits hints when absent from the snapshot', () => {
    const result = restoreGeneratedQuestPlay(makeState(), makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.play.hints).toBeUndefined()
  })
})

describe('restoreGeneratedQuestPlay — no onward navigation wiring', () => {
  it('does not set navigation or adjacentPregenerator on the result', () => {
    const result = restoreGeneratedQuestPlay(makeState({ questSpec }), makeWorldState())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const play = result.play as Record<string, unknown>
    expect(play.navigation).toBeUndefined()
    expect(play.adjacentPregenerator).toBeUndefined()
  })
})

describe('restoreGeneratedQuestPlay — purity', () => {
  it('does not mutate the WorldState or the snapshot', () => {
    const state = makeState({ questSpec, storyKind: 'investigate' })
    const world = makeWorldState({ [FLAG_KEY]: true })
    const stateSnapshot = structuredClone(state)
    const worldSnapshot = structuredClone(world)

    restoreGeneratedQuestPlay(state, world)

    expect(state).toEqual(stateSnapshot)
    expect(world).toEqual(worldSnapshot)
  })
})

describe('restoreGeneratedQuestPlay — invalid room', () => {
  it('returns a fixed failure code when the parked room fails to load', () => {
    // A room missing `shell` fails the strict RoomSpec envelope, so loadRoomSpec
    // throws. Cast simulates a corrupt-but-typed parked blob.
    const badState = {
      schemaVersion: 1,
      room: {
        schemaVersion: 1,
        id: 'SECRET-LEAK-ID',
        name: 'SECRET-LEAK-NAME',
        spawn: { position: [0, 0, 0], yaw: 0 },
        lighting: {},
        objects: [],
      },
      objectivesPerRoom: true,
    } as unknown as GeneratedQuestSaveState

    const result = restoreGeneratedQuestPlay(badState, makeWorldState())
    expect(result).toEqual({ ok: false, code: 'room-load-failed' })
  })

  it('does not echo room/object ids or input in the failure code', () => {
    const badState = {
      schemaVersion: 1,
      room: {
        schemaVersion: 1,
        id: 'SECRET-LEAK-ID',
        name: 'SECRET-LEAK-NAME',
        spawn: { position: [0, 0, 0], yaw: 0 },
        lighting: {},
        objects: [],
      },
      objectivesPerRoom: true,
    } as unknown as GeneratedQuestSaveState

    const result = restoreGeneratedQuestPlay(badState, makeWorldState())
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('SECRET-LEAK-ID')
    expect(serialized).not.toContain('SECRET-LEAK-NAME')
  })
})

describe('restoreGeneratedQuestPlay — no generator/provider/save/load side effects', () => {
  const source = restoreGeneratedQuestPlaySource

  it('imports nothing from the generation layer', () => {
    expect(source).not.toMatch(/generation\//)
  })

  it('does not reference a room/objective generator or assembly stage', () => {
    expect(source).not.toContain('assembleRoom')
    expect(source).not.toContain('ObjectiveGenerator')
    expect(source).not.toContain('RoomGenerator')
    expect(source).not.toContain('recordAttempt')
  })

  it('uses loadRoomSpec as the only room-reconstruction call', () => {
    expect(source).toContain('loadRoomSpec')
  })
})
