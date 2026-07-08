import type { TimeOfDay } from './world/worldClock'

export type NpcRoutineMode = 'idle' | 'patrol' | 'rest' | 'passive'

export type NpcRoutineSchedule = Partial<Record<TimeOfDay, NpcRoutineMode>>

export function selectRoutineMode(
  schedule: NpcRoutineSchedule,
  timeOfDay: TimeOfDay,
): NpcRoutineMode | null {
  const mode = schedule[timeOfDay]
  return mode ?? null
}

export function routineModeToMotorPolicy(mode: NpcRoutineMode): 'wander' | 'patrol' | 'idle' {
  switch (mode) {
    case 'idle':
      return 'idle'
    case 'rest':
      return 'idle'
    case 'patrol':
      return 'patrol'
    case 'passive':
      return 'wander'
  }
}
