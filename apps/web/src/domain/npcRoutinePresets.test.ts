import { describe, expect, it } from 'vitest'
import {
  NPC_ROUTINE_NPC_TYPES,
  NPC_TYPE_TO_ROUTINE_PRESET,
  ROUTINE_PRESETS,
  isNpcRoutineNpcType,
  resolveRoutineScheduleForNpc,
  type NpcRoutineNpcType,
  type NpcRoutinePreset,
} from './npcRoutinePresets'
import type { NpcRoutineMode, NpcRoutineSchedule } from './npcRoutine'

const CLOSED_MODES: readonly NpcRoutineMode[] = ['idle', 'patrol', 'rest', 'passive']

const CLOSED_NPC_TYPES: readonly NpcRoutineNpcType[] = [
  'guard',
  'merchant',
  'villager',
  'noble',
  'servant',
  'wanderer',
  'static_npc',
]

const CLOSED_PRESETS: readonly NpcRoutinePreset[] = [
  'stationary',
  'day_patrol_night_rest',
  'day_idle_night_rest',
  'wander_day_rest_night',
  'patrol_morning_day_rest_night',
]

describe('NpcRoutineNpcType', () => {
  it('NPC_TYPE_TO_ROUTINE_PRESET keys are exactly the closed npc type values', () => {
    expect(Object.keys(NPC_TYPE_TO_ROUTINE_PRESET).sort()).toEqual([...CLOSED_NPC_TYPES].sort())
  })
})

describe('NPC_ROUTINE_NPC_TYPES', () => {
  it('contains exactly the seven closed npc type values', () => {
    expect([...NPC_ROUTINE_NPC_TYPES].sort()).toEqual([...CLOSED_NPC_TYPES].sort())
    expect(NPC_ROUTINE_NPC_TYPES).toHaveLength(7)
  })
})

describe('isNpcRoutineNpcType', () => {
  it('accepts each of the seven closed npc type values', () => {
    for (const npcType of CLOSED_NPC_TYPES) {
      expect(isNpcRoutineNpcType(npcType)).toBe(true)
    }
  })

  it('rejects wrong-case, free-text, hostile-looking, and non-string values', () => {
    expect(isNpcRoutineNpcType('Guard')).toBe(false)
    expect(isNpcRoutineNpcType('GUARD')).toBe(false)
    expect(isNpcRoutineNpcType('guardian')).toBe(false)
    expect(isNpcRoutineNpcType('night guard patrol schedule')).toBe(false)
    expect(isNpcRoutineNpcType('<script>alert(1)</script>')).toBe(false)
    expect(isNpcRoutineNpcType('')).toBe(false)
    expect(isNpcRoutineNpcType(null)).toBe(false)
    expect(isNpcRoutineNpcType(undefined)).toBe(false)
    expect(isNpcRoutineNpcType(123)).toBe(false)
    expect(isNpcRoutineNpcType(true)).toBe(false)
    expect(isNpcRoutineNpcType(['guard'])).toBe(false)
    expect(isNpcRoutineNpcType({ npcType: 'guard' })).toBe(false)
  })
})

describe('NpcRoutinePreset', () => {
  it('ROUTINE_PRESETS keys are exactly the closed preset values', () => {
    expect(Object.keys(ROUTINE_PRESETS).sort()).toEqual([...CLOSED_PRESETS].sort())
  })
})

describe('ROUTINE_PRESETS', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(ROUTINE_PRESETS)).toBe(true)
  })

  it('every preset schedule uses only the closed idle/patrol/rest/passive modes', () => {
    for (const schedule of Object.values(ROUTINE_PRESETS)) {
      for (const mode of Object.values(schedule as NpcRoutineSchedule)) {
        expect(CLOSED_MODES).toContain(mode)
      }
    }
  })
})

describe('NPC_TYPE_TO_ROUTINE_PRESET', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(NPC_TYPE_TO_ROUTINE_PRESET)).toBe(true)
  })

  it('covers every closed NpcRoutineNpcType with a valid closed preset', () => {
    for (const npcType of CLOSED_NPC_TYPES) {
      const preset = NPC_TYPE_TO_ROUTINE_PRESET[npcType]
      expect(CLOSED_PRESETS).toContain(preset)
    }
  })

  it('matches the authored type -> preset mapping', () => {
    expect(NPC_TYPE_TO_ROUTINE_PRESET).toEqual({
      guard: 'day_patrol_night_rest',
      merchant: 'day_idle_night_rest',
      villager: 'wander_day_rest_night',
      noble: 'day_idle_night_rest',
      servant: 'wander_day_rest_night',
      wanderer: 'wander_day_rest_night',
      static_npc: 'stationary',
    })
  })
})

describe('resolveRoutineScheduleForNpc', () => {
  const explicitConfig: Readonly<Record<string, NpcRoutineSchedule>> = Object.freeze({
    'herald-asha': Object.freeze({
      dawn: 'idle',
      day: 'patrol',
      dusk: 'passive',
      night: 'rest',
    }),
  })

  it('explicit id config wins over npcType', () => {
    const result = resolveRoutineScheduleForNpc({
      npcId: 'herald-asha',
      npcType: 'wanderer',
      explicitConfig,
    })
    expect(result).toEqual({
      dawn: 'idle',
      day: 'patrol',
      dusk: 'passive',
      night: 'rest',
    })
  })

  it('herald-asha explicit config path remains possible with no npcType at all', () => {
    const result = resolveRoutineScheduleForNpc({
      npcId: 'herald-asha',
      explicitConfig,
    })
    expect(result).toEqual(explicitConfig['herald-asha'])
  })

  it('returns the preset schedule for a valid npcType when no explicit config exists', () => {
    const result = resolveRoutineScheduleForNpc({
      npcId: 'guard-1',
      npcType: 'guard',
      explicitConfig,
    })
    expect(result).toEqual(ROUTINE_PRESETS.day_patrol_night_rest)
  })

  it('resolves every closed npcType to its mapped preset schedule', () => {
    for (const npcType of CLOSED_NPC_TYPES) {
      const result = resolveRoutineScheduleForNpc({ npcId: 'some-npc', npcType })
      expect(result).toEqual(ROUTINE_PRESETS[NPC_TYPE_TO_ROUTINE_PRESET[npcType]])
    }
  })

  it('returns null for an unknown npcType', () => {
    expect(
      resolveRoutineScheduleForNpc({ npcId: 'unknown-npc', npcType: 'bandit' }),
    ).toBeNull()
  })

  it('returns null for a missing npcType', () => {
    expect(resolveRoutineScheduleForNpc({ npcId: 'unknown-npc' })).toBeNull()
    expect(resolveRoutineScheduleForNpc({ npcId: 'unknown-npc', npcType: null })).toBeNull()
    expect(
      resolveRoutineScheduleForNpc({ npcId: 'unknown-npc', npcType: undefined }),
    ).toBeNull()
  })

  it('returns null for free-text or hostile-looking npcType strings (no semantic parsing)', () => {
    expect(
      resolveRoutineScheduleForNpc({ npcId: 'npc', npcType: 'the guard patrols at dawn' }),
    ).toBeNull()
    expect(
      resolveRoutineScheduleForNpc({ npcId: 'npc', npcType: '<script>alert(1)</script>' }),
    ).toBeNull()
    expect(resolveRoutineScheduleForNpc({ npcId: 'npc', npcType: '' })).toBeNull()
    expect(resolveRoutineScheduleForNpc({ npcId: 'npc', npcType: 'Guard' })).toBeNull()
    expect(resolveRoutineScheduleForNpc({ npcId: 'npc', npcType: 'GUARD' })).toBeNull()
  })

  it('returns null when the id is absent from both explicit config and a type map', () => {
    expect(
      resolveRoutineScheduleForNpc({ npcId: 'nobody', explicitConfig, npcType: undefined }),
    ).toBeNull()
  })

  it('returns null for an invalid preset mapping (defensive, not reachable via closed types)', () => {
    const brokenTypePresetMap = {
      guard: 'not_a_real_preset',
    } as unknown as Readonly<Record<NpcRoutineNpcType, NpcRoutinePreset>>
    expect(
      resolveRoutineScheduleForNpc({
        npcId: 'guard-1',
        npcType: 'guard',
        typePresetMap: brokenTypePresetMap,
      }),
    ).toBeNull()
  })

  it('returns null when the resolved preset is missing from the presets table', () => {
    const sparsePresets = {} as unknown as Readonly<Record<NpcRoutinePreset, NpcRoutineSchedule>>
    expect(
      resolveRoutineScheduleForNpc({
        npcId: 'guard-1',
        npcType: 'guard',
        presets: sparsePresets,
      }),
    ).toBeNull()
  })

  it('never mutates the config/preset tables it is given', () => {
    const configSnapshot = JSON.parse(JSON.stringify(explicitConfig))
    const presetsSnapshot = JSON.parse(JSON.stringify(ROUTINE_PRESETS))
    const typeMapSnapshot = JSON.parse(JSON.stringify(NPC_TYPE_TO_ROUTINE_PRESET))

    resolveRoutineScheduleForNpc({ npcId: 'herald-asha', npcType: 'guard', explicitConfig })
    resolveRoutineScheduleForNpc({ npcId: 'someone-else', npcType: 'villager' })
    resolveRoutineScheduleForNpc({ npcId: 'nobody', npcType: 'not-a-type' })

    expect(explicitConfig).toEqual(configSnapshot)
    expect(ROUTINE_PRESETS).toEqual(presetsSnapshot)
    expect(NPC_TYPE_TO_ROUTINE_PRESET).toEqual(typeMapSnapshot)
  })

  it('never throws for malformed input shapes', () => {
    expect(() =>
      resolveRoutineScheduleForNpc({ npcId: '', npcType: undefined }),
    ).not.toThrow()
    expect(() =>
      resolveRoutineScheduleForNpc({
        npcId: 'x',
        npcType: 123 as unknown as string,
      }),
    ).not.toThrow()
    expect(() =>
      resolveRoutineScheduleForNpc({
        npcId: 'x',
        npcType: {} as unknown as string,
      }),
    ).not.toThrow()
  })
})
