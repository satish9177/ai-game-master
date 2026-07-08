import { describe, expect, it } from 'vitest'
import { getRoutineSchedule, NPC_ROUTINE_CONFIG } from './npcRoutineConfig'
import type { NpcRoutineMode } from './npcRoutine'

const CLOSED_MODES: readonly NpcRoutineMode[] = ['idle', 'patrol', 'rest', 'passive']

describe('NPC_ROUTINE_CONFIG', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(NPC_ROUTINE_CONFIG)).toBe(true)
  })

  it('contains only herald-asha for V0', () => {
    expect(Object.keys(NPC_ROUTINE_CONFIG)).toEqual(['herald-asha'])
  })

  it('every configured mode is one of the closed four modes', () => {
    for (const schedule of Object.values(NPC_ROUTINE_CONFIG)) {
      for (const mode of Object.values(schedule)) {
        expect(CLOSED_MODES).toContain(mode)
      }
    }
  })

  it('herald-asha schedule matches the authored dawn/day/dusk/night mapping', () => {
    expect(NPC_ROUTINE_CONFIG['herald-asha']).toEqual({
      dawn: 'idle',
      day: 'patrol',
      dusk: 'passive',
      night: 'rest',
    })
  })
})

describe('getRoutineSchedule', () => {
  it('returns the herald-asha schedule', () => {
    expect(getRoutineSchedule('herald-asha')).toEqual({
      dawn: 'idle',
      day: 'patrol',
      dusk: 'passive',
      night: 'rest',
    })
  })

  it('returns null for an unknown id', () => {
    expect(getRoutineSchedule('unknown-npc')).toBeNull()
  })

  it('returns null for a hostile-looking id (no name/role-based lookup)', () => {
    expect(getRoutineSchedule('bandit')).toBeNull()
    expect(getRoutineSchedule('guard')).toBeNull()
  })

  it('returns null for a content-looking id (no semantic/generated-text lookup)', () => {
    expect(getRoutineSchedule('the herald walks at dawn')).toBeNull()
    expect(getRoutineSchedule('<script>alert(1)</script>')).toBeNull()
    expect(getRoutineSchedule('')).toBeNull()
  })

  it('is keyed by id only, not by any other config field', () => {
    expect(getRoutineSchedule('Herald Asha')).toBeNull()
    expect(getRoutineSchedule('HERALD-ASHA')).toBeNull()
  })
})
