import { describe, expect, it } from 'vitest'
import { projectWorldState } from './applyEvent'
import { WorldEventSchema } from './events'
import type { WorldEvent } from './events'
import { SaveGameSchema } from './saveGame'
import {
  computeWorldClock,
  timeOfDayForHour,
  START_DAY,
  START_HOUR,
} from './worldClock'

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'

const event = (seq: number, type: WorldEvent['type'], payload: unknown): WorldEvent =>
  WorldEventSchema.parse({
    schemaVersion: 1,
    eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    seq,
    occurredAt: `2026-06-22T10:00:${String(seq).padStart(2, '0')}.000Z`,
    type,
    payload,
  })

const seed = {
  schemaVersion: 1 as const,
  worldId: WORLD_ID,
  name: 'Clock content stays out of the clock',
  startingRoomId: 'gatehouse',
  initialPlayer: {
    health: { current: 10, max: 10 },
    status: [] as string[],
    inventory: [] as { itemId: string; name: string; quantity: number }[],
  },
}

const start = event(1, 'session-started', { seed })

/** A start event plus `count` distinct room moves; seq/room alternate but stay valid. */
const logWithMoves = (count: number): WorldEvent[] => {
  const log: WorldEvent[] = [start]
  for (let i = 0; i < count; i += 1) {
    const from = i % 2 === 0 ? 'gatehouse' : 'yard'
    const to = i % 2 === 0 ? 'yard' : 'gatehouse'
    log.push(event(i + 2, 'moved-to-room', { fromRoomId: from, toRoomId: to }))
  }
  return log
}

describe('computeWorldClock', () => {
  it('defaults an empty log to the start of day 1', () => {
    expect(computeWorldClock([])).toEqual({
      day: START_DAY,
      hour: START_HOUR,
      timeOfDay: 'day',
    })
  })

  it('reads a fresh session (session-started only, no moves) as the start', () => {
    expect(computeWorldClock([start])).toEqual({ day: 1, hour: 8, timeOfDay: 'day' })
  })

  it('advances one hour per moved-to-room event', () => {
    expect(computeWorldClock(logWithMoves(1))).toEqual({ day: 1, hour: 9, timeOfDay: 'day' })
    expect(computeWorldClock(logWithMoves(3))).toEqual({ day: 1, hour: 11, timeOfDay: 'day' })
    expect(computeWorldClock(logWithMoves(9))).toEqual({ day: 1, hour: 17, timeOfDay: 'day' })
  })

  it('does not advance on non-move events', () => {
    const log: WorldEvent[] = [
      start,
      event(2, 'item-added', { item: { itemId: 'key', name: 'Iron Key', quantity: 1 } }),
      event(3, 'health-changed', { delta: -1 }),
      event(4, 'status-changed', { status: 'cold', op: 'add' }),
      event(5, 'room-state-changed', { roomId: 'gatehouse', flags: { gateOpen: true } }),
      event(6, 'item-removed', { itemId: 'key', quantity: 1 }),
    ]
    expect(computeWorldClock(log)).toEqual({ day: 1, hour: 8, timeOfDay: 'day' })
  })

  it('counts only the moves when moves and non-moves are interleaved', () => {
    const log: WorldEvent[] = [
      start,
      event(2, 'moved-to-room', { fromRoomId: 'gatehouse', toRoomId: 'yard' }),
      event(3, 'item-added', { item: { itemId: 'key', name: 'Iron Key', quantity: 1 } }),
      event(4, 'moved-to-room', { fromRoomId: 'yard', toRoomId: 'gatehouse' }),
      event(5, 'health-changed', { delta: -1 }),
    ]
    expect(computeWorldClock(log)).toEqual({ day: 1, hour: 10, timeOfDay: 'day' })
  })

  it('rolls over to the next day at hour 24', () => {
    // start hour 8 + 16 moves = hour 24 -> Day 2, Hour 0.
    expect(computeWorldClock(logWithMoves(16))).toEqual({ day: 2, hour: 0, timeOfDay: 'night' })
    expect(computeWorldClock(logWithMoves(17))).toEqual({ day: 2, hour: 1, timeOfDay: 'night' })
    // A full extra day later.
    expect(computeWorldClock(logWithMoves(40))).toEqual({ day: 3, hour: 0, timeOfDay: 'night' })
  })

  it('derives the correct bucket as hours cross boundaries', () => {
    // moves needed to reach a target hour on day 1 = targetHour - START_HOUR.
    expect(computeWorldClock(logWithMoves(0)).timeOfDay).toBe('day') // 08:00
    expect(computeWorldClock(logWithMoves(9)).timeOfDay).toBe('day') // 17:00
    expect(computeWorldClock(logWithMoves(10)).timeOfDay).toBe('dusk') // 18:00
    expect(computeWorldClock(logWithMoves(12)).timeOfDay).toBe('dusk') // 20:00
    expect(computeWorldClock(logWithMoves(13)).timeOfDay).toBe('night') // 21:00
    expect(computeWorldClock(logWithMoves(21)).timeOfDay).toBe('dawn') // 05:00 next day
  })

  it('is deterministic: the same log yields the same clock', () => {
    const a = logWithMoves(7)
    const b = logWithMoves(7)
    expect(computeWorldClock(a)).toEqual(computeWorldClock(b))
    expect(computeWorldClock(a)).toEqual(computeWorldClock(a))
  })

  it('survives a save/load round-trip via the persisted log', () => {
    const log = logWithMoves(5)
    const save = SaveGameSchema.parse({
      schemaVersion: 1,
      seed,
      log,
      snapshot: projectWorldState(log),
    })
    expect(computeWorldClock(save.log)).toEqual(computeWorldClock(log))
    expect(computeWorldClock(save.log)).toEqual({ day: 1, hour: 13, timeOfDay: 'day' })
  })
})

describe('timeOfDayForHour', () => {
  it('maps each hour to exactly one half-open bucket', () => {
    expect(timeOfDayForHour(0)).toBe('night')
    expect(timeOfDayForHour(4)).toBe('night')
    expect(timeOfDayForHour(5)).toBe('dawn')
    expect(timeOfDayForHour(7)).toBe('dawn')
    expect(timeOfDayForHour(8)).toBe('day')
    expect(timeOfDayForHour(17)).toBe('day')
    expect(timeOfDayForHour(18)).toBe('dusk')
    expect(timeOfDayForHour(20)).toBe('dusk')
    expect(timeOfDayForHour(21)).toBe('night')
    expect(timeOfDayForHour(23)).toBe('night')
  })
})
