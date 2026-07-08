import { describe, it, expect } from 'vitest'
import {
  readRoutineEnabled,
  selectNpcRoutineModes,
  type NpcRoutineRawEnv,
} from './npcRoutine'
import type { NpcRoutineSchedule } from '../domain/npcRoutine'

describe('readRoutineEnabled', () => {
  it('defaults to false when env is empty', () => {
    expect(readRoutineEnabled({})).toBe(false)
  })

  it('returns true for "1" and "true"', () => {
    expect(readRoutineEnabled({ VITE_AIGM_DEMO_ROUTINE: '1' })).toBe(true)
    expect(readRoutineEnabled({ VITE_AIGM_DEMO_ROUTINE: 'true' })).toBe(true)
  })

  it('returns true for trimmed and case-insensitive variants', () => {
    expect(readRoutineEnabled({ VITE_AIGM_DEMO_ROUTINE: '  1  ' })).toBe(true)
    expect(readRoutineEnabled({ VITE_AIGM_DEMO_ROUTINE: '  TRUE  ' })).toBe(true)
    expect(readRoutineEnabled({ VITE_AIGM_DEMO_ROUTINE: 'True' })).toBe(true)
  })

  it('returns false for undefined, empty, and unrecognized values', () => {
    const raw: NpcRoutineRawEnv = {}
    expect(readRoutineEnabled({ ...raw, VITE_AIGM_DEMO_ROUTINE: undefined })).toBe(false)
    expect(readRoutineEnabled({ VITE_AIGM_DEMO_ROUTINE: '' })).toBe(false)
    expect(readRoutineEnabled({ VITE_AIGM_DEMO_ROUTINE: '0' })).toBe(false)
    expect(readRoutineEnabled({ VITE_AIGM_DEMO_ROUTINE: 'false' })).toBe(false)
    expect(readRoutineEnabled({ VITE_AIGM_DEMO_ROUTINE: 'yes' })).toBe(false)
    expect(readRoutineEnabled({ VITE_AIGM_DEMO_ROUTINE: 'on' })).toBe(false)
  })

  it('is unaffected by adjacent poisoned env keys', () => {
    expect(
      readRoutineEnabled({
        VITE_AIGM_DEMO_ROUTINE: undefined,
        VITE_AIGM_DEMO_CHASE: '1',
        VITE_AIGM_DEMO_ROUTINE_: 'true',
        DEMO_ROUTINE: '1',
      }),
    ).toBe(false)
  })

  it('performs no I/O and reads only the supplied env object', () => {
    expect(() => readRoutineEnabled({ VITE_AIGM_DEMO_ROUTINE: '1' })).not.toThrow()
  })
})

const HERALD_SCHEDULE: NpcRoutineSchedule = {
  dawn: 'idle',
  day: 'patrol',
  dusk: 'passive',
  night: 'rest',
}

const TEST_CONFIG: Readonly<Record<string, NpcRoutineSchedule>> = Object.freeze({
  'herald-asha': HERALD_SCHEDULE,
})

describe('selectNpcRoutineModes', () => {
  it('returns empty when disabled, even when herald-asha is present', () => {
    const result = selectNpcRoutineModes({
      enabled: false,
      presentNpcIds: new Set(['herald-asha']),
      timeOfDay: 'day',
      config: TEST_CONFIG,
    })
    expect(result.size).toBe(0)
  })

  it('returns empty when timeOfDay is null', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['herald-asha']),
      timeOfDay: null,
      config: TEST_CONFIG,
    })
    expect(result.size).toBe(0)
  })

  it('returns empty when timeOfDay is undefined', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['herald-asha']),
      timeOfDay: undefined,
      config: TEST_CONFIG,
    })
    expect(result.size).toBe(0)
  })

  it('resolves herald-asha to patrol for day when enabled and present', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['herald-asha']),
      timeOfDay: 'day',
      config: TEST_CONFIG,
    })
    expect(result.get('herald-asha')).toBe('patrol')
    expect(result.size).toBe(1)
  })

  it('resolves herald-asha to rest for night when enabled and present', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['herald-asha']),
      timeOfDay: 'night',
      config: TEST_CONFIG,
    })
    expect(result.get('herald-asha')).toBe('rest')
  })

  it('returns empty when herald-asha is absent from the room', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['steward-malik']),
      timeOfDay: 'day',
      config: TEST_CONFIG,
    })
    expect(result.size).toBe(0)
  })

  it('ignores a configured id when its schedule has no entry for the current bucket', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['partial-npc']),
      timeOfDay: 'dusk',
      config: { 'partial-npc': { day: 'patrol' } },
    })
    expect(result.size).toBe(0)
  })

  it('ignores unknown/hostile-looking/content-looking ids not present in config', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set([
        'murderous-bandit-leader',
        'assassin-of-the-dark-order',
        'quest-giver-with-secret-lore',
      ]),
      timeOfDay: 'day',
      config: TEST_CONFIG,
    })
    expect(result.size).toBe(0)
  })

  it('keeps deterministic config-key order regardless of presentNpcIds insertion order', () => {
    const config: Readonly<Record<string, NpcRoutineSchedule>> = Object.freeze({
      first: { day: 'idle' },
      second: { day: 'patrol' },
      third: { day: 'passive' },
    })
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['third', 'first', 'second']),
      timeOfDay: 'day',
      config,
    })
    expect([...result.keys()]).toEqual(['first', 'second', 'third'])
  })

  it('does not mutate presentNpcIds or config', () => {
    const presentNpcIds = new Set(['herald-asha'])
    const presentSnapshot = [...presentNpcIds]
    const configSnapshot = JSON.stringify(TEST_CONFIG)

    selectNpcRoutineModes({
      enabled: true,
      presentNpcIds,
      timeOfDay: 'day',
      config: TEST_CONFIG,
    })

    expect([...presentNpcIds]).toEqual(presentSnapshot)
    expect(JSON.stringify(TEST_CONFIG)).toEqual(configSnapshot)
  })

  it('is id-only: only the literal id string matters, never derived semantics', () => {
    const friendlyIdSelected = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['friendly-shopkeeper']),
      timeOfDay: 'day',
      config: { 'friendly-shopkeeper': { day: 'passive' } },
    })
    expect(friendlyIdSelected.get('friendly-shopkeeper')).toBe('passive')

    const hostileIdIgnored = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['hostile-warlord']),
      timeOfDay: 'day',
      config: TEST_CONFIG,
    })
    expect(hostileIdIgnored.size).toBe(0)
  })
})
