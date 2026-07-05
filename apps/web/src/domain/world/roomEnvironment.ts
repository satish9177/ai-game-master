import type { WorldEvent } from './events'
import { HOURS_PER_MOVE } from './worldClock'

export type RoomEnvironmentKind = 'burning' | 'smoldering' | 'burned_out'

export type RoomEnvironmentState = {
  kind: RoomEnvironmentKind
}

export type EnvironmentPresentationTag = 'stale_smoke' | 'cold_ashes'

export const SMOLDER_AFTER_HOURS = 2 as const
export const BURNED_OUT_AFTER_HOURS = 6 as const

export const ROOM_ENVIRONMENT_TRANSITION_THRESHOLDS = Object.freeze({
  smolderAfterHours: SMOLDER_AFTER_HOURS,
  burnedOutAfterHours: BURNED_OUT_AFTER_HOURS,
})

export function projectRoomEnvironment(
  prior: RoomEnvironmentState | undefined,
  elapsedWorldHours: number,
): RoomEnvironmentState | undefined {
  if (prior === undefined) return undefined

  const elapsed = Math.max(0, elapsedWorldHours)

  switch (prior.kind) {
    case 'burning':
      return elapsed >= SMOLDER_AFTER_HOURS ? { kind: 'smoldering' } : prior
    case 'smoldering':
      return elapsed >= BURNED_OUT_AFTER_HOURS ? { kind: 'burned_out' } : prior
    case 'burned_out':
      return prior
  }
}

export function presentationTagsFor(state: RoomEnvironmentState | undefined): EnvironmentPresentationTag[] {
  if (state === undefined) return []

  switch (state.kind) {
    case 'burning':
      return []
    case 'smoldering':
      return ['stale_smoke']
    case 'burned_out':
      return ['cold_ashes']
  }
}

export function elapsedWorldHoursSinceLastEntered(log: readonly WorldEvent[], roomId: string): number {
  let moveCount = 0
  let lastEnteredMoveCount: number | undefined

  for (const event of log) {
    if (event.type !== 'moved-to-room') continue

    moveCount += 1
    if (event.payload.toRoomId === roomId) {
      lastEnteredMoveCount = moveCount
    }
  }

  if (lastEnteredMoveCount === undefined) return 0

  return Math.max(0, (moveCount - lastEnteredMoveCount) * HOURS_PER_MOVE)
}
