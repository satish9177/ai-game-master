import npcRoutineTypeConfigSource from './npcRoutineTypeConfig.ts?raw'
import { describe, expect, it } from 'vitest'
import { NPC_TYPE_BY_ID, getRoutineNpcType } from './npcRoutineTypeConfig'

describe('NPC_TYPE_BY_ID', () => {
  it('contains only herald-asha for V0', () => {
    expect(Object.keys(NPC_TYPE_BY_ID)).toEqual(['herald-asha'])
  })

  it('maps herald-asha to guard', () => {
    expect(NPC_TYPE_BY_ID['herald-asha']).toBe('guard')
  })

  it('is frozen', () => {
    expect(Object.isFrozen(NPC_TYPE_BY_ID)).toBe(true)
  })
})

describe('getRoutineNpcType', () => {
  it('returns guard for herald-asha', () => {
    expect(getRoutineNpcType('herald-asha')).toBe('guard')
  })

  it('returns null for unknown/generated/content-looking ids', () => {
    expect(getRoutineNpcType('unknown-npc')).toBeNull()
    expect(getRoutineNpcType('generated-npc-42')).toBeNull()
    expect(getRoutineNpcType('the herald walks at dawn')).toBeNull()
    expect(getRoutineNpcType('<script>alert(1)</script>')).toBeNull()
    expect(getRoutineNpcType('')).toBeNull()
  })

  it('returns null for case variants (exact id lookup only)', () => {
    expect(getRoutineNpcType('Herald-Asha')).toBeNull()
    expect(getRoutineNpcType('HERALD-ASHA')).toBeNull()
    expect(getRoutineNpcType('Herald Asha')).toBeNull()
  })
})

describe('redteam npcRoutineTypeConfig - no unsafe import/side-effect surface', () => {
  function importSpecifiers(source: string): string[] {
    return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!)
  }

  it('imports only the pure npcRoutinePresets type, never provider/prompt/LLM/persistence/schema/world-event/memory/fact modules', () => {
    const specifiers = importSpecifiers(npcRoutineTypeConfigSource)
    expect(specifiers).toEqual(['./npcRoutinePresets'])
  })

  it('has no console/logger calls', () => {
    expect(npcRoutineTypeConfigSource).not.toMatch(/console\./)
    expect(npcRoutineTypeConfigSource).not.toMatch(/logger\./i)
  })

  it('has no timers or wall-clock/background-loop references', () => {
    const forbidden = ['setInterval', 'setTimeout', 'Date.now', 'requestAnimationFrame', 'setImmediate']
    for (const term of forbidden) {
      expect(npcRoutineTypeConfigSource).not.toContain(term)
    }
  })
})
