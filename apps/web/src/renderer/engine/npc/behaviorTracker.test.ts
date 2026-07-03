import { describe, expect, it } from 'vitest'
import { IDLE_INTENSITY_BY_STATE } from '../../../domain/ports/npcBehavior'
import type { NpcBehaviorState } from '../../../domain/ports/npcBehavior'
import { NpcBehaviorTracker } from './behaviorTracker'

describe('NpcBehaviorTracker', () => {
  it('returns idle for unknown ids', () => {
    const tracker = new NpcBehaviorTracker()

    expect(tracker.stateOf('missing')).toBe('idle')
  })

  it('marks only the selected NPC as talking', () => {
    const tracker = new NpcBehaviorTracker()

    tracker.setTalking('a')

    expect(tracker.stateOf('a')).toBe('talking')
    expect(tracker.stateOf('b')).toBe('idle')
  })

  it('replaces the previous talking NPC', () => {
    const tracker = new NpcBehaviorTracker()

    tracker.setTalking('a')
    tracker.setTalking('b')

    expect(tracker.stateOf('a')).toBe('idle')
    expect(tracker.stateOf('b')).toBe('talking')
  })

  it('clears talking state', () => {
    const tracker = new NpcBehaviorTracker()

    tracker.setTalking('a')
    tracker.setTalking(null)

    expect(tracker.stateOf('a')).toBe('idle')
  })

  it('marks an NPC as wandering', () => {
    const tracker = new NpcBehaviorTracker()

    tracker.setWandering('a', true)

    expect(tracker.stateOf('a')).toBe('wandering')
  })

  it('lets talking win over wandering', () => {
    const tracker = new NpcBehaviorTracker()

    tracker.setWandering('a', true)
    tracker.setTalking('a')

    expect(tracker.stateOf('a')).toBe('talking')
  })

  it('reveals wandering again after talking is cleared', () => {
    const tracker = new NpcBehaviorTracker()

    tracker.setWandering('a', true)
    tracker.setTalking('a')
    tracker.setTalking(null)

    expect(tracker.stateOf('a')).toBe('wandering')
  })

  it('clears wandering state for an NPC', () => {
    const tracker = new NpcBehaviorTracker()

    tracker.setWandering('a', true)
    tracker.setWandering('a', false)

    expect(tracker.stateOf('a')).toBe('idle')
  })

  it('resets talking and wandering state', () => {
    const tracker = new NpcBehaviorTracker()

    tracker.setWandering('a', true)
    tracker.setTalking('b')
    tracker.clear()

    expect(tracker.stateOf('a')).toBe('idle')
    expect(tracker.stateOf('b')).toBe('idle')
  })
})

describe('IDLE_INTENSITY_BY_STATE', () => {
  it('covers all NPC behavior states with expected values', () => {
    const states: readonly NpcBehaviorState[] = ['idle', 'talking', 'wandering']

    expect(Object.keys(IDLE_INTENSITY_BY_STATE).sort()).toEqual([...states].sort())
    expect(IDLE_INTENSITY_BY_STATE.idle).toBe(1)
    expect(IDLE_INTENSITY_BY_STATE.talking).toBe(0)
    expect(IDLE_INTENSITY_BY_STATE.wandering).toBe(0.5)
    expect(IDLE_INTENSITY_BY_STATE.wandering).toBeGreaterThan(IDLE_INTENSITY_BY_STATE.talking)
    expect(IDLE_INTENSITY_BY_STATE.wandering).toBeLessThan(IDLE_INTENSITY_BY_STATE.idle)
  })
})
