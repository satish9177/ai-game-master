import { describe, expect, it } from 'vitest'
import type { NpcPlayerAwarenessLevel, NpcPlayerAwarenessState } from '../../../domain/npcPlayerAwareness'
import { NpcAwarenessTracker } from './awarenessTracker'

function state(npcId: string, level: NpcPlayerAwarenessLevel): NpcPlayerAwarenessState {
  return { npcId, level, distance: 0, reason: 'proximity' }
}

describe('NpcAwarenessTracker', () => {
  it('returns unaware for unknown ids', () => {
    const tracker = new NpcAwarenessTracker()

    expect(tracker.levelOf('missing')).toBe('unaware')
  })

  it('stores the awareness level per NPC', () => {
    const tracker = new NpcAwarenessTracker()

    tracker.update(state('a', 'aware'))
    tracker.update(state('b', 'nearby'))

    expect(tracker.levelOf('a')).toBe('aware')
    expect(tracker.levelOf('b')).toBe('nearby')
  })

  it('tracks each NPC independently', () => {
    const tracker = new NpcAwarenessTracker()

    tracker.update(state('a', 'alerted'))
    tracker.update(state('b', 'unaware'))

    expect(tracker.levelOf('a')).toBe('alerted')
    expect(tracker.levelOf('b')).toBe('unaware')
  })

  it('reports a change when a tracked NPC first moves away from the unaware default', () => {
    const tracker = new NpcAwarenessTracker()

    const change = tracker.update(state('a', 'nearby'))

    expect(change).toEqual({ npcId: 'a', level: 'nearby', previousLevel: 'unaware' })
  })

  it('reports no change when the tier is unchanged across repeated ticks', () => {
    const tracker = new NpcAwarenessTracker()

    tracker.update(state('a', 'aware'))
    const change = tracker.update(state('a', 'aware'))

    expect(change).toBeNull()
  })

  it('reports a change when the tier transitions to a tighter tier', () => {
    const tracker = new NpcAwarenessTracker()

    tracker.update(state('a', 'nearby'))
    const change = tracker.update(state('a', 'alerted'))

    expect(change).toEqual({ npcId: 'a', level: 'alerted', previousLevel: 'nearby' })
  })

  it('reports a change when the tier transitions to a looser tier', () => {
    const tracker = new NpcAwarenessTracker()

    tracker.update(state('a', 'alerted'))
    const change = tracker.update(state('a', 'nearby'))

    expect(change).toEqual({ npcId: 'a', level: 'nearby', previousLevel: 'alerted' })
  })

  it('reports no change on the first tick when the level settles at unaware', () => {
    const tracker = new NpcAwarenessTracker()

    const change = tracker.update(state('a', 'unaware'))

    expect(change).toBeNull()
  })

  it('clears all tracked state back to the unaware default', () => {
    const tracker = new NpcAwarenessTracker()

    tracker.update(state('a', 'alerted'))
    tracker.update(state('b', 'nearby'))

    tracker.clear()

    expect(tracker.levelOf('a')).toBe('unaware')
    expect(tracker.levelOf('b')).toBe('unaware')
  })

  it('reports a change after clear() for a previously non-unaware NPC', () => {
    const tracker = new NpcAwarenessTracker()

    tracker.update(state('a', 'alerted'))
    tracker.clear()
    const change = tracker.update(state('a', 'alerted'))

    expect(change).toEqual({ npcId: 'a', level: 'alerted', previousLevel: 'unaware' })
  })

  it('does not mutate its own map identity across reads', () => {
    const tracker = new NpcAwarenessTracker()

    tracker.update(state('a', 'aware'))
    const first = tracker.levelOf('a')
    const second = tracker.levelOf('a')

    expect(first).toBe(second)
  })
})
