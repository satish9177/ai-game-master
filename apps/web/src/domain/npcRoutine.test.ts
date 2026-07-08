import { describe, expect, it } from 'vitest'
import { routineModeToMotorPolicy, selectRoutineMode } from './npcRoutine'
import type { NpcRoutineMode, NpcRoutineSchedule } from './npcRoutine'

describe('npcRoutine closed modes', () => {
  it('has exactly the four closed modes idle/patrol/rest/passive', () => {
    const modes: readonly NpcRoutineMode[] = ['idle', 'patrol', 'rest', 'passive']
    for (const mode of modes) {
      expect(routineModeToMotorPolicy(mode)).toBeDefined()
    }
  })
})

describe('selectRoutineMode', () => {
  const fullSchedule: NpcRoutineSchedule = {
    dawn: 'idle',
    day: 'patrol',
    dusk: 'passive',
    night: 'rest',
  }

  it('returns the configured mode for each mapped bucket', () => {
    expect(selectRoutineMode(fullSchedule, 'dawn')).toBe('idle')
    expect(selectRoutineMode(fullSchedule, 'day')).toBe('patrol')
    expect(selectRoutineMode(fullSchedule, 'dusk')).toBe('passive')
    expect(selectRoutineMode(fullSchedule, 'night')).toBe('rest')
  })

  it('returns null when the bucket is missing from the schedule', () => {
    const partial: NpcRoutineSchedule = { day: 'patrol' }
    expect(selectRoutineMode(partial, 'night')).toBeNull()
  })

  it('returns null for an entirely empty schedule', () => {
    expect(selectRoutineMode({}, 'day')).toBeNull()
  })

  it('is deterministic across repeated calls', () => {
    const first = selectRoutineMode(fullSchedule, 'day')
    const second = selectRoutineMode(fullSchedule, 'day')
    expect(first).toBe(second)
    expect(first).toBe('patrol')
  })

  it('does not mutate the input schedule', () => {
    const schedule: NpcRoutineSchedule = { dawn: 'idle' }
    const before = { ...schedule }
    selectRoutineMode(schedule, 'dawn')
    selectRoutineMode(schedule, 'night')
    expect(schedule).toEqual(before)
  })
})

describe('routineModeToMotorPolicy', () => {
  it('maps exactly idle->idle, rest->idle, patrol->patrol, passive->wander', () => {
    expect(routineModeToMotorPolicy('idle')).toBe('idle')
    expect(routineModeToMotorPolicy('rest')).toBe('idle')
    expect(routineModeToMotorPolicy('patrol')).toBe('patrol')
    expect(routineModeToMotorPolicy('passive')).toBe('wander')
  })

  it('maps rest to the same motor policy as idle', () => {
    expect(routineModeToMotorPolicy('rest')).toBe(routineModeToMotorPolicy('idle'))
  })

  it('maps passive to wander only — no dialogue-blocking semantics implied', () => {
    const policy = routineModeToMotorPolicy('passive')
    expect(policy).toBe('wander')
    expect(policy).not.toBe('idle')
    expect(policy).not.toBe('patrol')
  })
})
