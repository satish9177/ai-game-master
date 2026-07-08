import buildRoutineDialogueContextSource from './buildRoutineDialogueContext.ts?raw'
import { describe, expect, it } from 'vitest'
import { buildRoutineDialogueContext } from './buildRoutineDialogueContext'
import type { NpcRoutineMode } from '../npcRoutine'
import type { TimeOfDay } from '../world/worldClock'

describe('buildRoutineDialogueContext', () => {
  it.each([
    ['idle', 'standing by'],
    ['patrol', 'patrolling'],
    ['rest', 'resting'],
    ['passive', 'keeping a quiet watch'],
  ] satisfies Array<[NpcRoutineMode, string]>)('maps mode %s to activity %s', (mode, activity) => {
    expect(buildRoutineDialogueContext({ mode, timeOfDay: 'day' })).toEqual({
      mode,
      activity,
      timeOfDay: 'day',
    })
  })

  it.each(['dawn', 'day', 'dusk', 'night'] satisfies TimeOfDay[])(
    'passes through timeOfDay %s unchanged',
    (timeOfDay) => {
      expect(buildRoutineDialogueContext({ mode: 'patrol', timeOfDay })).toEqual({
        mode: 'patrol',
        activity: 'patrolling',
        timeOfDay,
      })
    },
  )

  it.each([null, undefined])('returns null when mode is %s', (mode) => {
    expect(buildRoutineDialogueContext({ mode, timeOfDay: 'day' })).toBeNull()
  })

  it.each([null, undefined])('returns null when timeOfDay is %s', (timeOfDay) => {
    expect(buildRoutineDialogueContext({ mode: 'idle', timeOfDay })).toBeNull()
  })

  it('returns null when both mode and timeOfDay are absent', () => {
    expect(buildRoutineDialogueContext({ mode: undefined, timeOfDay: undefined })).toBeNull()
  })

  it('result includes only mode, activity, and timeOfDay keys', () => {
    const result = buildRoutineDialogueContext({ mode: 'rest', timeOfDay: 'night' })
    expect(Object.keys(result!).sort()).toEqual(['activity', 'mode', 'timeOfDay'])
  })

  it('is deterministic and returns a fresh object each call, without mutating inputs', () => {
    const args = { mode: 'passive' as const, timeOfDay: 'dusk' as const }
    const before = structuredClone(args)

    const first = buildRoutineDialogueContext(args)
    const second = buildRoutineDialogueContext(args)

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(args).toEqual(before)
  })

  it('has no import surface onto provider/prompt/LLM/persistence/world-event/memory/fact modules', () => {
    const specifiers = [...buildRoutineDialogueContextSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1]!,
    )
    expect(specifiers.length).toBeGreaterThan(0) // guard against a vacuous pass
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/^(\.\.\/npcRoutine|\.\.\/world\/worldClock|\.\/contracts)$/)
    }
  })

  it('has no reference to provider/prompt/LLM/persistence/WorldState/WorldEvent/WorldCommand/memory/fact modules', () => {
    const forbidden = [
      'provider',
      'prompt',
      'llm',
      'persistence',
      'WorldState',
      'WorldEvent',
      'WorldCommand',
      'memory',
      'fact',
      'sqlite',
    ]
    for (const term of forbidden) {
      expect(buildRoutineDialogueContextSource.toLowerCase()).not.toContain(term.toLowerCase())
    }
  })

  it('has no parameter or field named name/persona/dialogue/room/prompt/npcId/provider, and no generated-text handling', () => {
    const start = buildRoutineDialogueContextSource.indexOf('buildRoutineDialogueContext(')
    expect(start).toBeGreaterThanOrEqual(0) // guard against a vacuous pass
    const paramsStart = start + 'buildRoutineDialogueContext('.length
    const end = buildRoutineDialogueContextSource.indexOf(': RoutineDialogueContext | null {', paramsStart)
    expect(end).toBeGreaterThan(paramsStart) // guard against a vacuous pass
    const signature = buildRoutineDialogueContextSource.slice(paramsStart, end)

    expect(signature).not.toMatch(/name|persona|dialogue|room|prompt|npcId|provider|generated/i)
    expect(signature).toContain('mode')
    expect(signature).toContain('timeOfDay')
  })

  it('has no console/logger calls and no timers', () => {
    expect(buildRoutineDialogueContextSource).not.toMatch(/console\./)
    expect(buildRoutineDialogueContextSource).not.toMatch(/logger\./i)
    for (const term of ['setInterval', 'setTimeout', 'Date.now', 'requestAnimationFrame', 'setImmediate']) {
      expect(buildRoutineDialogueContextSource).not.toContain(term)
    }
  })
})
