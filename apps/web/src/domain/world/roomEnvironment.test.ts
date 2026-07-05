import { describe, expect, it } from 'vitest'
import { computeWorldClock, HOURS_PER_MOVE } from './worldClock'
import { WorldEventSchema } from './events'
import type { WorldEvent } from './events'
import {
  BURNED_OUT_AFTER_HOURS,
  SMOLDER_AFTER_HOURS,
  elapsedWorldHoursSinceLastEntered,
  presentationTagsFor,
  projectRoomEnvironment,
  type RoomEnvironmentKind,
  type RoomEnvironmentState,
} from './roomEnvironment'

const WORLD_ID = '00000000-0000-4000-8000-000000000101'
const SESSION_ID = '00000000-0000-4000-8000-000000000102'

const seed = {
  schemaVersion: 1 as const,
  worldId: WORLD_ID,
  name: 'Environment content stays out of the model',
  startingRoomId: 'gatehouse',
  initialPlayer: {
    health: { current: 10, max: 10 },
    status: [] as string[],
    inventory: [] as { itemId: string; name: string; quantity: number }[],
  },
}

const event = (seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent =>
  WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    seq,
    occurredAt: `2026-07-05T10:00:${String(seq).padStart(2, '0')}.000Z`,
    type,
    payload,
  })

const start = event(1, 'session-started', { seed })

const moved = (seq: number, fromRoomId: string, toRoomId: string): WorldEvent =>
  event(seq, 'moved-to-room', { fromRoomId, toRoomId })

const itemAdded = (seq: number): WorldEvent =>
  event(seq, 'item-added', { item: { itemId: `item-${seq}`, name: `Item ${seq}`, quantity: 1 } })

const state = (kind: RoomEnvironmentKind): RoomEnvironmentState => ({ kind })

const stageRank: Record<RoomEnvironmentKind, number> = {
  burning: 0,
  smoldering: 1,
  burned_out: 2,
}

describe('projectRoomEnvironment', () => {
  it('returns no-op for absent environment state', () => {
    expect(projectRoomEnvironment(undefined, BURNED_OUT_AFTER_HOURS + 100)).toBeUndefined()
  })

  it('keeps burning below the smolder threshold', () => {
    expect(projectRoomEnvironment(state('burning'), SMOLDER_AFTER_HOURS - 1)).toEqual(state('burning'))
  })

  it('moves burning to smoldering at and above the smolder threshold', () => {
    expect(projectRoomEnvironment(state('burning'), SMOLDER_AFTER_HOURS)).toEqual(state('smoldering'))
    expect(projectRoomEnvironment(state('burning'), SMOLDER_AFTER_HOURS + 10)).toEqual(state('smoldering'))
  })

  it('keeps smoldering below the burned-out threshold', () => {
    expect(projectRoomEnvironment(state('smoldering'), BURNED_OUT_AFTER_HOURS - 1)).toEqual(state('smoldering'))
  })

  it('moves smoldering to burned_out at and above the burned-out threshold', () => {
    expect(projectRoomEnvironment(state('smoldering'), BURNED_OUT_AFTER_HOURS)).toEqual(state('burned_out'))
    expect(projectRoomEnvironment(state('smoldering'), BURNED_OUT_AFTER_HOURS + 10)).toEqual(state('burned_out'))
  })

  it('keeps burned_out terminal and idempotent', () => {
    expect(projectRoomEnvironment(state('burned_out'), 0)).toEqual(state('burned_out'))
    expect(projectRoomEnvironment(state('burned_out'), BURNED_OUT_AFTER_HOURS + 100)).toEqual(state('burned_out'))
  })

  it('is deterministic for the same input', () => {
    const prior = state('burning')

    expect(projectRoomEnvironment(prior, SMOLDER_AFTER_HOURS)).toEqual(
      projectRoomEnvironment(prior, SMOLDER_AFTER_HOURS),
    )
  })

  it('is monotonic and saturating as elapsed hours increase', () => {
    const elapsedSamples = [0, SMOLDER_AFTER_HOURS - 1, SMOLDER_AFTER_HOURS, BURNED_OUT_AFTER_HOURS]

    for (const priorKind of ['burning', 'smoldering', 'burned_out'] as const) {
      let previousRank = stageRank[priorKind]

      for (const elapsed of elapsedSamples) {
        const projected = projectRoomEnvironment(state(priorKind), elapsed)
        if (projected === undefined) throw new Error('environment state unexpectedly absent')
        const nextRank = stageRank[projected.kind]
        expect(nextRank).toBeGreaterThanOrEqual(previousRank)
        previousRank = nextRank
      }
    }
  })

  it('treats negative elapsed hours as zero', () => {
    expect(projectRoomEnvironment(state('burning'), -1)).toEqual(projectRoomEnvironment(state('burning'), 0))
    expect(projectRoomEnvironment(state('smoldering'), -1)).toEqual(projectRoomEnvironment(state('smoldering'), 0))
  })
})

describe('presentationTagsFor', () => {
  it('maps smoldering to stale_smoke', () => {
    expect(presentationTagsFor(state('smoldering'))).toEqual(['stale_smoke'])
  })

  it('maps burned_out to cold_ashes', () => {
    expect(presentationTagsFor(state('burned_out'))).toEqual(['cold_ashes'])
  })

  it('does not emit tags for absent or burning state', () => {
    expect(presentationTagsFor(undefined)).toEqual([])
    expect(presentationTagsFor(state('burning'))).toEqual([])
  })
})

describe('elapsedWorldHoursSinceLastEntered', () => {
  it('returns 0 when the room was never entered', () => {
    const log = [start, moved(2, 'gatehouse', 'yard'), moved(3, 'yard', 'tower')]

    expect(elapsedWorldHoursSinceLastEntered(log, 'cellar')).toBe(0)
  })

  it('returns 0 for the first and current room entry', () => {
    const log = [start, moved(2, 'gatehouse', 'yard')]

    expect(elapsedWorldHoursSinceLastEntered(log, 'yard')).toBe(0)
  })

  it('uses the most recent entry when a room is revisited after moves', () => {
    const log = [
      start,
      moved(2, 'gatehouse', 'yard'),
      moved(3, 'yard', 'tower'),
      moved(4, 'tower', 'yard'),
      moved(5, 'yard', 'cellar'),
      moved(6, 'cellar', 'gatehouse'),
    ]

    expect(elapsedWorldHoursSinceLastEntered(log, 'yard')).toBe(2 * HOURS_PER_MOVE)
  })

  it('ignores non-moved-to-room events', () => {
    const withNonMove = [
      start,
      moved(2, 'gatehouse', 'yard'),
      itemAdded(3),
      event(4, 'room-state-changed', { roomId: 'yard', flags: { gateOpen: true } }),
      moved(5, 'yard', 'tower'),
    ]
    const moveOnly = [start, moved(2, 'gatehouse', 'yard'), moved(3, 'yard', 'tower')]

    expect(elapsedWorldHoursSinceLastEntered(withNonMove, 'yard')).toBe(
      elapsedWorldHoursSinceLastEntered(moveOnly, 'yard'),
    )
  })

  it('agrees with world-clock moved-to-room accounting', () => {
    const enteredRoomLog = [start, moved(2, 'gatehouse', 'yard'), itemAdded(3)]
    const finalLog = [...enteredRoomLog, moved(4, 'yard', 'tower'), moved(5, 'tower', 'cellar')]

    const enteredClock = computeWorldClock(enteredRoomLog)
    const finalClock = computeWorldClock(finalLog)
    const enteredAbsoluteHours = (enteredClock.day - 1) * 24 + enteredClock.hour
    const finalAbsoluteHours = (finalClock.day - 1) * 24 + finalClock.hour

    expect(elapsedWorldHoursSinceLastEntered(finalLog, 'yard')).toBe(finalAbsoluteHours - enteredAbsoluteHours)
  })
})

describe('room environment model is dry at runtime', () => {
  const sourceModules = import.meta.glob(['../../**/*.ts', '../../**/*.tsx'], {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>

  it('has no production runtime or composition importer yet', () => {
    const productionReferences = Object.entries(sourceModules).filter(([path, source]) => {
      if (path.endsWith('/roomEnvironment.ts')) return false
      if (path.endsWith('/roomEnvironment.test.ts')) return false
      if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) return false
      return source.includes('roomEnvironment') || source.includes('RoomEnvironmentState')
    })

    expect(productionReferences).toEqual([])
  })
})
