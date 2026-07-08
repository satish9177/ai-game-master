import type { NpcRoutineMode } from '../npcRoutine'
import type { TimeOfDay } from '../world/worldClock'
import type { RoutineDialogueContext } from './contracts'

const MODE_TO_ACTIVITY: Record<NpcRoutineMode, RoutineDialogueContext['activity']> = {
  idle: 'standing by',
  patrol: 'patrolling',
  rest: 'resting',
  passive: 'keeping a quiet watch',
}

export function buildRoutineDialogueContext({
  mode,
  timeOfDay,
}: {
  mode: NpcRoutineMode | null | undefined
  timeOfDay: TimeOfDay | null | undefined
}): RoutineDialogueContext | null {
  if (mode == null) return null
  if (timeOfDay == null) return null
  return {
    mode,
    activity: MODE_TO_ACTIVITY[mode],
    timeOfDay,
  }
}
