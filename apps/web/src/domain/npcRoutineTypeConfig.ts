import type { NpcRoutineNpcType } from './npcRoutinePresets'

export const NPC_TYPE_BY_ID: Readonly<Record<string, NpcRoutineNpcType>> = Object.freeze({
  'herald-asha': 'guard',
})

export function getRoutineNpcType(npcId: string): NpcRoutineNpcType | null {
  return NPC_TYPE_BY_ID[npcId] ?? null
}
