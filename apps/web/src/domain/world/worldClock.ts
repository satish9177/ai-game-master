import type { WorldEvent } from './events'

/**
 * World Clock v0 — a pure, deterministic projection over the authoritative
 * event log. It is NOT authoritative state: it holds no field on WorldState,
 * mints no event/command, and is never persisted on its own. Because SaveGame
 * already parks the full `log`, the clock re-derives identically after load with
 * no schema or save-game change.
 *
 * Time advances only on in-fiction travel: each `moved-to-room` event costs
 * HOURS_PER_MOVE. Every other event type (items, health, status, room-state,
 * session-started) leaves the clock untouched, and blocked navigation, dialogue,
 * and background pregeneration append no `moved-to-room` event so they cannot
 * advance time. There is no wall clock — this reads the log, never Date.now().
 */
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night'

export type WorldClock = {
  /** In-world day, starting at 1. */
  day: number
  /** Hour of day, 0..23. */
  hour: number
  timeOfDay: TimeOfDay
}

/** A fresh session (or empty log) reads as Day 1, Hour 8 ("day"). */
export const START_DAY = 1 as const
export const START_HOUR = 8 as const
export const HOURS_PER_MOVE = 1 as const
export const HOURS_PER_DAY = 24 as const

/**
 * Closed bucket boundaries. Half-open on the upper edge so each hour maps to
 * exactly one bucket:
 *   night [0,5)  dawn [5,8)  day [8,18)  dusk [18,21)  night [21,24)
 */
export function timeOfDayForHour(hour: number): TimeOfDay {
  if (hour < 5) return 'night'
  if (hour < 8) return 'dawn'
  if (hour < 18) return 'day'
  if (hour < 21) return 'dusk'
  return 'night'
}

export function computeWorldClock(log: readonly WorldEvent[]): WorldClock {
  let moves = 0
  for (const event of log) {
    if (event.type === 'moved-to-room') moves += 1
  }

  const absoluteHours =
    (START_DAY - 1) * HOURS_PER_DAY + START_HOUR + moves * HOURS_PER_MOVE
  const day = Math.floor(absoluteHours / HOURS_PER_DAY) + 1
  const hour = absoluteHours % HOURS_PER_DAY

  return { day, hour, timeOfDay: timeOfDayForHour(hour) }
}
