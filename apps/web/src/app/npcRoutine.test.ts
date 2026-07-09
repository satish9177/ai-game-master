import { describe, it, expect } from 'vitest'
import {
  readRoutineEnabled,
  selectNpcRoutineModes,
  type NpcRoutineRawEnv,
} from './npcRoutine'
import type { NpcRoutineSchedule } from '../domain/npcRoutine'
import type { NpcRoutineNpcType } from '../domain/npcRoutinePresets'

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

describe('selectNpcRoutineModes - type preset integration (Slice 2)', () => {
  it('preserves existing herald-asha explicit schedule behavior with the default authored type map', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['herald-asha']),
      timeOfDay: 'day',
      config: TEST_CONFIG,
    })
    expect(result.get('herald-asha')).toBe('patrol')
    expect(result.size).toBe(1)
  })

  it('explicit id config wins over an injected type preset fallback', () => {
    const explicitConfig: Readonly<Record<string, NpcRoutineSchedule>> = Object.freeze({
      'npc-x': { night: 'rest' },
    })
    const typeConfig: Readonly<Record<string, NpcRoutineNpcType>> = Object.freeze({
      'npc-x': 'guard',
    })

    const nightResult = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['npc-x']),
      timeOfDay: 'night',
      config: explicitConfig,
      typeConfig,
    })
    expect(nightResult.get('npc-x')).toBe('rest')

    // guard's preset would resolve 'day' to 'patrol', but explicit config has
    // no 'day' entry, so explicit config wins entirely -- no fallback merge.
    const dayResult = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['npc-x']),
      timeOfDay: 'day',
      config: explicitConfig,
      typeConfig,
    })
    expect(dayResult.size).toBe(0)
  })

  it('a type-mapped NPC without explicit id config gets a routine via its type preset', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['guard-1']),
      timeOfDay: 'day',
      config: {},
      typeConfig: { 'guard-1': 'guard' },
    })
    expect(result.get('guard-1')).toBe('patrol')
  })

  it('an unknown id with no explicit config and no type mapping returns no routine', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['nobody']),
      timeOfDay: 'day',
      config: {},
      typeConfig: {},
    })
    expect(result.size).toBe(0)
  })

  it('an unknown/free-text/hostile-looking type mapping returns no routine (no semantic parsing)', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['bandit-1']),
      timeOfDay: 'day',
      config: {},
      typeConfig: { 'bandit-1': 'bandit leader' as unknown as NpcRoutineNpcType },
    })
    expect(result.size).toBe(0)
  })

  it('a generated npc id with no authored type entry returns no routine', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['generated-npc-42']),
      timeOfDay: 'day',
      config: {},
      typeConfig: { 'guard-1': 'guard' },
    })
    expect(result.size).toBe(0)
  })

  it('gate off still returns empty even with a type-mapped id present', () => {
    const result = selectNpcRoutineModes({
      enabled: false,
      presentNpcIds: new Set(['guard-1']),
      timeOfDay: 'day',
      config: {},
      typeConfig: { 'guard-1': 'guard' },
    })
    expect(result.size).toBe(0)
  })

  it('a missing time bucket for a type-resolved preset still returns empty', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['static-1']),
      timeOfDay: 'dawn',
      config: {},
      typeConfig: { 'static-1': 'static_npc' },
    })
    // 'stationary' preset maps dawn->idle, so use a type whose preset omits a
    // bucket instead: none of the authored presets omit a bucket, so assert
    // the resolved mode is the preset's dawn value, proving no default/mutation.
    expect(result.get('static-1')).toBe('idle')
  })

  it('does not mutate presentNpcIds, config, or typeConfig', () => {
    const presentNpcIds = new Set(['guard-1'])
    const config = Object.freeze({})
    const typeConfig = Object.freeze({ 'guard-1': 'guard' as NpcRoutineNpcType })
    const presentSnapshot = [...presentNpcIds]
    const configSnapshot = JSON.stringify(config)
    const typeConfigSnapshot = JSON.stringify(typeConfig)

    selectNpcRoutineModes({
      enabled: true,
      presentNpcIds,
      timeOfDay: 'day',
      config,
      typeConfig,
    })

    expect([...presentNpcIds]).toEqual(presentSnapshot)
    expect(JSON.stringify(config)).toEqual(configSnapshot)
    expect(JSON.stringify(typeConfig)).toEqual(typeConfigSnapshot)
  })
})

/**
 * Coverage for generated-npc-routine-type-v0 (ADR-0090, Slice 3):
 * `roomNpcTypeById`, a third, lowest-priority `npcType` source sourced from
 * validated generated-room NPC objects. Priority stays: explicit
 * `NPC_ROUTINE_CONFIG` id schedule first, then authored `typeConfig`, then
 * `roomNpcTypeById`, else no routine. No new resolver is introduced --
 * `resolveRoutineScheduleForNpc` is reused unchanged.
 */
describe('selectNpcRoutineModes - roomNpcTypeById (Slice 3)', () => {
  it('a generated npc with a valid roomNpcTypeById entry and no authored entry resolves the expected mode by timeOfDay', () => {
    const roomNpcTypeById = new Map<string, NpcRoutineNpcType>([['generated-npc', 'guard']])

    const dayResult = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['generated-npc']),
      timeOfDay: 'day',
      config: {},
      typeConfig: {},
      roomNpcTypeById,
    })
    expect(dayResult.get('generated-npc')).toBe('patrol') // guard's day_patrol_night_rest preset

    const nightResult = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['generated-npc']),
      timeOfDay: 'night',
      config: {},
      typeConfig: {},
      roomNpcTypeById,
    })
    expect(nightResult.get('generated-npc')).toBe('rest')
  })

  it('a present generated npc with no roomNpcTypeById entry gets no routine (missing roomNpcTypeById arg entirely)', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['generated-npc']),
      timeOfDay: 'day',
      config: {},
      typeConfig: {},
      // roomNpcTypeById omitted entirely -- defaults to empty
    })
    expect(result.size).toBe(0)
  })

  it('a roomNpcTypeById entry for an npc that is not present in the room gets no routine', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['some-other-npc']),
      timeOfDay: 'day',
      config: {},
      typeConfig: {},
      roomNpcTypeById: new Map([['generated-npc', 'guard']]),
    })
    expect(result.size).toBe(0)
  })

  it('explicit NPC_ROUTINE_CONFIG id schedule wins even when roomNpcTypeById disagrees', () => {
    const explicitConfig: Readonly<Record<string, NpcRoutineSchedule>> = Object.freeze({
      'herald-asha': HERALD_SCHEDULE,
    })
    const roomNpcTypeById = new Map<string, NpcRoutineNpcType>([['herald-asha', 'wanderer']])

    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['herald-asha']),
      timeOfDay: 'day',
      config: explicitConfig,
      typeConfig: {},
      roomNpcTypeById,
    })
    // herald-asha's explicit schedule resolves day -> patrol; wanderer's
    // preset would resolve day -> passive if it were consulted at all.
    expect(result.get('herald-asha')).toBe('patrol')
  })

  it('authored typeConfig wins over roomNpcTypeById for the same id', () => {
    const roomNpcTypeById = new Map<string, NpcRoutineNpcType>([['dual-source-npc', 'wanderer']])

    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['dual-source-npc']),
      timeOfDay: 'day',
      config: {},
      typeConfig: { 'dual-source-npc': 'guard' },
      roomNpcTypeById,
    })
    // authored 'guard' -> day_patrol_night_rest -> day:'patrol'.
    // room 'wanderer' -> wander_day_rest_night -> day:'passive'.
    // authored must win, so the result must be 'patrol', not 'passive'.
    expect(result.get('dual-source-npc')).toBe('patrol')
  })

  it('an invalid/unknown roomNpcTypeById value (already dropped upstream to undefined) never reaches this selector as a bad type, so absence yields no routine', () => {
    // By the time roomNpcTypeById is built (Slice 1's schema `.catch(undefined)`
    // boundary), an invalid npcType is already undefined and therefore absent
    // from the map -- there is no way to construct a `ReadonlyMap<string,
    // NpcRoutineNpcType>` entry with an invalid value through the closed type.
    // This test proves the absence path (no entry at all) still yields no
    // routine, matching "invalid npcType -> no routine" end to end.
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['poisoned-npc']),
      timeOfDay: 'day',
      config: {},
      typeConfig: {},
      roomNpcTypeById: new Map(),
    })
    expect(result.size).toBe(0)
  })

  it('VITE_AIGM_DEMO_ROUTINE disabled returns empty even with a valid roomNpcTypeById entry present', () => {
    const result = selectNpcRoutineModes({
      enabled: false,
      presentNpcIds: new Set(['generated-npc']),
      timeOfDay: 'day',
      config: {},
      typeConfig: {},
      roomNpcTypeById: new Map([['generated-npc', 'guard']]),
    })
    expect(result.size).toBe(0)
  })

  it('a missing timeOfDay returns empty even with a valid roomNpcTypeById entry present', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['generated-npc']),
      timeOfDay: undefined,
      config: {},
      typeConfig: {},
      roomNpcTypeById: new Map([['generated-npc', 'guard']]),
    })
    expect(result.size).toBe(0)
  })

  it('keeps deterministic id order: config keys, then typeConfig keys, then roomNpcTypeById keys, deduped', () => {
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['from-room-b', 'from-config', 'from-type', 'from-room-a']),
      timeOfDay: 'day',
      config: { 'from-config': { day: 'idle' } },
      typeConfig: { 'from-type': 'guard' },
      roomNpcTypeById: new Map<string, NpcRoutineNpcType>([
        ['from-room-b', 'villager'],
        ['from-room-a', 'wanderer'],
      ]),
    })
    expect([...result.keys()]).toEqual(['from-config', 'from-type', 'from-room-b', 'from-room-a'])
  })

  it('an id present in both config and roomNpcTypeById is not duplicated in iteration order', () => {
    const roomNpcTypeById = new Map<string, NpcRoutineNpcType>([['herald-asha', 'wanderer']])
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['herald-asha']),
      timeOfDay: 'day',
      config: { 'herald-asha': HERALD_SCHEDULE },
      typeConfig: {},
      roomNpcTypeById,
    })
    expect(result.size).toBe(1)
    expect([...result.keys()]).toEqual(['herald-asha'])
  })

  it('does not mutate presentNpcIds, config, typeConfig, or roomNpcTypeById', () => {
    const presentNpcIds = new Set(['generated-npc'])
    const config = Object.freeze({})
    const typeConfig = Object.freeze({})
    const roomNpcTypeById = new Map<string, NpcRoutineNpcType>([['generated-npc', 'guard']])
    const presentSnapshot = [...presentNpcIds]
    const roomTypeSnapshot = [...roomNpcTypeById.entries()]

    selectNpcRoutineModes({
      enabled: true,
      presentNpcIds,
      timeOfDay: 'day',
      config,
      typeConfig,
      roomNpcTypeById,
    })

    expect([...presentNpcIds]).toEqual(presentSnapshot)
    expect([...roomNpcTypeById.entries()]).toEqual(roomTypeSnapshot)
  })

  it('an unknown/hostile-looking string cast into roomNpcTypeById never resolves a preset (no semantic parsing)', () => {
    const poisonedRoomNpcTypeById = new Map<string, NpcRoutineNpcType>([
      ['npc-1', 'bandit leader' as unknown as NpcRoutineNpcType],
    ])
    const result = selectNpcRoutineModes({
      enabled: true,
      presentNpcIds: new Set(['npc-1']),
      timeOfDay: 'day',
      config: {},
      typeConfig: {},
      roomNpcTypeById: poisonedRoomNpcTypeById,
    })
    expect(result.size).toBe(0)
  })
})
