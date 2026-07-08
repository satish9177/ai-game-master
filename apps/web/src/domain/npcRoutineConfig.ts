import type { NpcRoutineSchedule } from './npcRoutine'

export const NPC_ROUTINE_CONFIG: Readonly<Record<string, NpcRoutineSchedule>> = Object.freeze({
  'herald-asha': Object.freeze({
    dawn: 'idle',
    day: 'patrol',
    dusk: 'passive',
    night: 'rest',
  }),
})

export function getRoutineSchedule(npcId: string): NpcRoutineSchedule | null {
  return NPC_ROUTINE_CONFIG[npcId] ?? null
}
