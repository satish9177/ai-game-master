import { describe, expect, it } from 'vitest'
import { detectNpcPlayerAwareness, NPC_PLAYER_AWARENESS } from './npcPlayerAwareness'
import type { AwarenessXZ } from './npcPlayerAwareness'

function detect(npcPosition: AwarenessXZ, playerPosition: AwarenessXZ, sameRoom = true) {
  return detectNpcPlayerAwareness({ npcId: 'npc-1', npcPosition, playerPosition, sameRoom })
}

describe('detectNpcPlayerAwareness', () => {
  it('is unaware when far away in the same room', () => {
    const result = detect({ x: 0, z: 0 }, { x: 20, z: 0 })

    expect(result.level).toBe('unaware')
    expect(result.reason).toBe('proximity')
    expect(result.distance).toBe(20)
  })

  it('is nearby at an interior distance within the nearby radius', () => {
    const result = detect({ x: 0, z: 0 }, { x: 4, z: 0 })

    expect(result.level).toBe('nearby')
    expect(result.reason).toBe('proximity')
    expect(result.distance).toBe(4)
  })

  it('is aware at an interior distance within the aware radius', () => {
    const result = detect({ x: 0, z: 0 }, { x: 2, z: 0 })

    expect(result.level).toBe('aware')
    expect(result.reason).toBe('proximity')
    expect(result.distance).toBe(2)
  })

  it('is alerted at an interior distance within the alerted radius', () => {
    const result = detect({ x: 0, z: 0 }, { x: 1, z: 0 })

    expect(result.level).toBe('alerted')
    expect(result.reason).toBe('proximity')
    expect(result.distance).toBe(1)
  })

  it('resolves exact thresholds inclusively to the tighter tier', () => {
    expect(detect({ x: 0, z: 0 }, { x: NPC_PLAYER_AWARENESS.ALERTED_RADIUS, z: 0 }).level)
      .toBe('alerted')
    expect(detect({ x: 0, z: 0 }, { x: NPC_PLAYER_AWARENESS.AWARE_RADIUS, z: 0 }).level)
      .toBe('aware')
    expect(detect({ x: 0, z: 0 }, { x: NPC_PLAYER_AWARENESS.NEARBY_RADIUS, z: 0 }).level)
      .toBe('nearby')
  })

  it('picks the tightest tier just past each boundary', () => {
    expect(detect({ x: 0, z: 0 }, { x: NPC_PLAYER_AWARENESS.ALERTED_RADIUS + 0.001, z: 0 }).level)
      .toBe('aware')
    expect(detect({ x: 0, z: 0 }, { x: NPC_PLAYER_AWARENESS.AWARE_RADIUS + 0.001, z: 0 }).level)
      .toBe('nearby')
    expect(detect({ x: 0, z: 0 }, { x: NPC_PLAYER_AWARENESS.NEARBY_RADIUS + 0.001, z: 0 }).level)
      .toBe('unaware')
  })

  it('returns unaware, null distance, and different-room reason when not in the same room', () => {
    const result = detect({ x: 0, z: 0 }, { x: 0.1, z: 0 }, false)

    expect(result).toEqual({
      npcId: 'npc-1',
      level: 'unaware',
      distance: null,
      reason: 'different-room',
    })
  })

  it('returns unaware, null distance, and missing-position reason for a missing player position', () => {
    const result = detect({ x: 0, z: 0 }, { x: Number.NaN, z: 0 })

    expect(result).toEqual({
      npcId: 'npc-1',
      level: 'unaware',
      distance: null,
      reason: 'missing-position',
    })
  })

  it('returns unaware, null distance, and missing-position reason for a missing NPC position', () => {
    const result = detect({ x: Number.NaN, z: 0 }, { x: 0, z: 0 })

    expect(result).toEqual({
      npcId: 'npc-1',
      level: 'unaware',
      distance: null,
      reason: 'missing-position',
    })
  })

  it('treats NaN and Infinity coordinates in either axis as missing-position', () => {
    expect(detect({ x: 0, z: Number.NaN }, { x: 0, z: 0 }).level).toBe('unaware')
    expect(detect({ x: 0, z: Number.NaN }, { x: 0, z: 0 }).reason).toBe('missing-position')
    expect(detect({ x: 0, z: 0 }, { x: Number.POSITIVE_INFINITY, z: 0 }).level).toBe('unaware')
    expect(detect({ x: 0, z: 0 }, { x: Number.POSITIVE_INFINITY, z: 0 }).reason)
      .toBe('missing-position')
    expect(detect({ x: 0, z: 0 }, { x: 0, z: Number.NEGATIVE_INFINITY }).reason)
      .toBe('missing-position')
  })

  it('is deterministic for identical inputs', () => {
    const npcPosition = { x: 1.25, z: -3.5 }
    const playerPosition = { x: 2, z: -1 }

    expect(detect(npcPosition, playerPosition)).toEqual(detect(npcPosition, playerPosition))
  })

  it('does not mutate the input position objects', () => {
    const npcPosition = { x: 1, z: 1 }
    const playerPosition = { x: 3, z: 1 }
    const npcBefore = JSON.stringify(npcPosition)
    const playerBefore = JSON.stringify(playerPosition)

    detect(npcPosition, playerPosition)

    expect(JSON.stringify(npcPosition)).toBe(npcBefore)
    expect(JSON.stringify(playerPosition)).toBe(playerBefore)
  })

  it('exports constants matching the locked radii', () => {
    expect(NPC_PLAYER_AWARENESS.ALERTED_RADIUS).toBe(1.5)
    expect(NPC_PLAYER_AWARENESS.AWARE_RADIUS).toBe(3.0)
    expect(NPC_PLAYER_AWARENESS.NEARBY_RADIUS).toBe(5.0)
  })

  it('orders the radii from tightest to widest', () => {
    expect(NPC_PLAYER_AWARENESS.ALERTED_RADIUS).toBeLessThan(NPC_PLAYER_AWARENESS.AWARE_RADIUS)
    expect(NPC_PLAYER_AWARENESS.AWARE_RADIUS).toBeLessThan(NPC_PLAYER_AWARENESS.NEARBY_RADIUS)
  })
})
