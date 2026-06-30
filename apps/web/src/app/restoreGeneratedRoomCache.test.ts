import restoreGeneratedRoomCacheSource from './restoreGeneratedRoomCache.ts?raw'
import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import {
  buildGeneratedRoomCacheSaveState,
  type GeneratedRoomCacheSaveState,
} from '../domain/quests/generatedRoomCacheSaveState'
import type { RoomSpec } from '../domain/roomSpec'
import { restoreGeneratedRoomCache } from './restoreGeneratedRoomCache'

function makeRoom(id: string, overrides: Partial<RoomSpec> = {}): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
    name: `Generated ${id}`,
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 2.5 }],
    },
    spawn: { position: [0, 1.7, 0], yaw: 180 },
    lighting: { ambient: { color: '#404858', intensity: 0.6 } },
    objects: [
      {
        type: 'scroll',
        id: `${id}-object`,
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
    ],
    ...overrides,
  })
}

function makeState(rooms: Array<{ room: LoadedRoom; provenance: 'generated' | 'repaired' | 'fallback' }>): GeneratedRoomCacheSaveState {
  const state = buildGeneratedRoomCacheSaveState({ rooms, themePack: 'fantasy-keep' })
  if (state == null) throw new Error('fixture build failed')
  return state
}

describe('restoreGeneratedRoomCache', () => {
  it('restores valid saved rooms into a fresh cache', () => {
    const current = makeRoom('current-room')
    const previous = makeRoom('previous-room')
    const state = makeState([
      { room: current, provenance: 'generated' },
      { room: previous, provenance: 'repaired' },
    ])

    const result = restoreGeneratedRoomCache(state, current)

    expect(result.cache.get('current-room')?.id).toBe('current-room')
    expect(result.cache.get('previous-room')?.id).toBe('previous-room')
    expect(result.restoredRoomIds).toEqual(['current-room', 'previous-room'])
    expect(result.skippedRoomCount).toBe(0)
  })

  it('preserves object ids internally for restored rooms', () => {
    const current = makeRoom('current-room')
    const previous = makeRoom('previous-room')
    const result = restoreGeneratedRoomCache(
      makeState([
        { room: current, provenance: 'generated' },
        { room: previous, provenance: 'fallback' },
      ]),
      current,
    )

    expect(result.cache.get('previous-room')?.objects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'previous-room-object' })]),
    )
  })

  it('returns provenance for restored rooms', () => {
    const current = makeRoom('current-room')
    const fallback = makeRoom('fallback-room')

    const result = restoreGeneratedRoomCache(
      makeState([
        { room: current, provenance: 'generated' },
        { room: fallback, provenance: 'fallback' },
      ]),
      current,
    )

    expect([...result.provenance.entries()]).toEqual([
      ['current-room', 'generated'],
      ['fallback-room', 'fallback'],
    ])
  })

  it('includes the current room idempotently when it is already in the state', () => {
    const current = makeRoom('current-room')

    const result = restoreGeneratedRoomCache(
      makeState([{ room: current, provenance: 'generated' }]),
      current,
    )

    expect(result.cache.get('current-room')).toBe(current)
    expect(result.restoredRoomIds).toEqual(['current-room'])
  })

  it('adds the current room when absent from the state', () => {
    const current = makeRoom('current-room')
    const previous = makeRoom('previous-room')

    const result = restoreGeneratedRoomCache(
      makeState([{ room: previous, provenance: 'repaired' }]),
      current,
    )

    expect(result.cache.get('previous-room')?.id).toBe('previous-room')
    expect(result.cache.get('current-room')).toBe(current)
    expect(result.restoredRoomIds).toEqual(['previous-room', 'current-room'])
  })

  it('skips invalid room entries and restores the remaining rooms', () => {
    const current = makeRoom('current-room')
    const valid = makeRoom('valid-room')
    const state = {
      schemaVersion: 1,
      rooms: [
        {
          room: {
            schemaVersion: 1,
            id: 'SECRET-LEAK-ID',
            name: 'SECRET-LEAK-NAME',
            spawn: { position: [0, 0, 0], yaw: 0 },
            lighting: {},
            objects: [],
          },
          provenance: 'generated',
        },
        {
          room: {
            schemaVersion: valid.schemaVersion,
            id: valid.id,
            name: valid.name,
            shell: valid.shell,
            spawn: valid.spawn,
            lighting: valid.lighting,
            objects: valid.objects,
          },
          provenance: 'fallback',
        },
      ],
    } as unknown as GeneratedRoomCacheSaveState

    const result = restoreGeneratedRoomCache(state, current)

    expect(result.skippedRoomCount).toBe(1)
    expect(result.cache.get('valid-room')?.id).toBe('valid-room')
    expect(result.cache.get('SECRET-LEAK-ID')).toBeUndefined()
    expect(result.restoredRoomIds).toEqual(['valid-room', 'current-room'])
  })

  it('does not echo unsafe room or object identifiers in degradation output', () => {
    const current = makeRoom('current-room')
    const state = {
      schemaVersion: 1,
      rooms: [
        {
          room: {
            schemaVersion: 1,
            id: 'SECRET-LEAK-ID',
            name: 'SECRET-LEAK-NAME',
            spawn: { position: [0, 0, 0], yaw: 0 },
            lighting: {},
            objects: [{ id: 'SECRET-OBJECT-ID' }],
          },
          provenance: 'generated',
        },
      ],
    } as unknown as GeneratedRoomCacheSaveState

    const result = restoreGeneratedRoomCache(state, current)
    const serialized = JSON.stringify({
      skippedRoomCount: result.skippedRoomCount,
      restoredRoomIds: result.restoredRoomIds,
    })

    expect(serialized).not.toContain('SECRET-LEAK-ID')
    expect(serialized).not.toContain('SECRET-LEAK-NAME')
    expect(serialized).not.toContain('SECRET-OBJECT-ID')
  })

  it('does not mutate the state or current room', () => {
    const current = makeRoom('current-room')
    const previous = makeRoom('previous-room')
    const state = makeState([
      { room: current, provenance: 'generated' },
      { room: previous, provenance: 'repaired' },
    ])
    const stateBefore = structuredClone(state)
    const currentBefore = structuredClone(current)

    restoreGeneratedRoomCache(state, current)

    expect(state).toEqual(stateBefore)
    expect(current).toEqual(currentBefore)
  })
})

describe('restoreGeneratedRoomCache import boundary', () => {
  const source = restoreGeneratedRoomCacheSource

  it('uses loadRoomSpec as the only room reconstruction call', () => {
    expect(source).toContain('loadRoomSpec')
  })

  it('does not reference generators, providers, assembly, world-session, memory, dialogue, or cost paths', () => {
    const forbiddenFragments = [
      'assembleRoom(',
      'GeneratedRoomSource',
      'RoomGenerator',
      'ObjectiveGenerator',
      'recordAttempt',
      '../generation',
      '../providers',
      '../world-session',
      '../memory',
      '../dialogue',
      '../persistence',
      '../server',
    ]

    for (const fragment of forbiddenFragments) {
      expect(source).not.toContain(fragment)
    }
  })
})
