import type { NpcRoutineMode, NpcRoutineSchedule } from './npcRoutine'

export type NpcRoutineNpcType =
  | 'guard'
  | 'merchant'
  | 'villager'
  | 'noble'
  | 'servant'
  | 'wanderer'
  | 'static_npc'

export type NpcRoutinePreset =
  | 'stationary'
  | 'day_patrol_night_rest'
  | 'day_idle_night_rest'
  | 'wander_day_rest_night'
  | 'patrol_morning_day_rest_night'

export const NPC_ROUTINE_NPC_TYPES = [
  'guard',
  'merchant',
  'villager',
  'noble',
  'servant',
  'wanderer',
  'static_npc',
] as const satisfies readonly NpcRoutineNpcType[]

const NPC_ROUTINE_PRESETS: readonly NpcRoutinePreset[] = [
  'stationary',
  'day_patrol_night_rest',
  'day_idle_night_rest',
  'wander_day_rest_night',
  'patrol_morning_day_rest_night',
]

export function isNpcRoutineNpcType(value: unknown): value is NpcRoutineNpcType {
  return (
    typeof value === 'string' &&
    (NPC_ROUTINE_NPC_TYPES as readonly string[]).includes(value)
  )
}

function isNpcRoutinePreset(value: unknown): value is NpcRoutinePreset {
  return (
    typeof value === 'string' &&
    (NPC_ROUTINE_PRESETS as readonly string[]).includes(value)
  )
}

export const ROUTINE_PRESETS: Readonly<Record<NpcRoutinePreset, NpcRoutineSchedule>> =
  Object.freeze({
    stationary: Object.freeze({
      dawn: 'idle',
      day: 'idle',
      dusk: 'idle',
      night: 'idle',
    } satisfies Record<string, NpcRoutineMode>),
    day_patrol_night_rest: Object.freeze({
      dawn: 'idle',
      day: 'patrol',
      dusk: 'idle',
      night: 'rest',
    } satisfies Record<string, NpcRoutineMode>),
    day_idle_night_rest: Object.freeze({
      dawn: 'idle',
      day: 'idle',
      dusk: 'idle',
      night: 'rest',
    } satisfies Record<string, NpcRoutineMode>),
    wander_day_rest_night: Object.freeze({
      dawn: 'passive',
      day: 'passive',
      dusk: 'passive',
      night: 'rest',
    } satisfies Record<string, NpcRoutineMode>),
    patrol_morning_day_rest_night: Object.freeze({
      dawn: 'patrol',
      day: 'patrol',
      dusk: 'rest',
      night: 'rest',
    } satisfies Record<string, NpcRoutineMode>),
  })

export const NPC_TYPE_TO_ROUTINE_PRESET: Readonly<Record<NpcRoutineNpcType, NpcRoutinePreset>> =
  Object.freeze({
    guard: 'day_patrol_night_rest',
    merchant: 'day_idle_night_rest',
    villager: 'wander_day_rest_night',
    noble: 'day_idle_night_rest',
    servant: 'wander_day_rest_night',
    wanderer: 'wander_day_rest_night',
    static_npc: 'stationary',
  })

export function resolveRoutineScheduleForNpc(args: {
  npcId: string
  npcType?: NpcRoutineNpcType | string | null
  explicitConfig?: Readonly<Record<string, NpcRoutineSchedule>>
  typePresetMap?: Readonly<Record<NpcRoutineNpcType, NpcRoutinePreset>>
  presets?: Readonly<Record<NpcRoutinePreset, NpcRoutineSchedule>>
}): NpcRoutineSchedule | null {
  const {
    npcId,
    npcType,
    explicitConfig,
    typePresetMap = NPC_TYPE_TO_ROUTINE_PRESET,
    presets = ROUTINE_PRESETS,
  } = args

  const explicitSchedule = explicitConfig?.[npcId]
  if (explicitSchedule) {
    return explicitSchedule
  }

  if (!isNpcRoutineNpcType(npcType)) {
    return null
  }

  const preset = typePresetMap[npcType]
  if (!isNpcRoutinePreset(preset)) {
    return null
  }

  return presets[preset] ?? null
}
