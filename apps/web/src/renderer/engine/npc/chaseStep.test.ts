import { describe, expect, it } from 'vitest'
import {
  distanceXZ,
  isWanderPositionAllowed,
  isWanderSegmentAllowed,
  NPC_WANDER,
} from '../../../domain/npcMovementContract'
import type { NpcWanderField, WanderXZ } from '../../../domain/npcMovementContract'
import { chaseStep, CONTACT_STANDOFF } from './chaseStep'

function openField(): NpcWanderField {
  return {
    roomId: 'chase-step-room',
    npcId: 'npc',
    home: { x: 0, z: 0 },
    bounds: { halfX: 8, halfZ: 8 },
    exclusions: [],
  }
}

function distance(a: WanderXZ, b: WanderXZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function runSequence(
  field: NpcWanderField,
  position: WanderXZ,
  playerTarget: WanderXZ,
  dts: readonly number[],
): WanderXZ[] {
  let current = { x: position.x, z: position.z }
  return dts.map((dtS) => {
    current = chaseStep({ field, position: current, playerTarget, dtS }).position
    return current
  })
}

describe('chaseStep', () => {
  it('is deterministic for the same field, position, target, and dt sequence', () => {
    const field = openField()
    const dts = [0.1, 0.2, 0.35, 1.2, 0.016, 0.5, 2.1, 0.3, 4]

    expect(runSequence(field, { x: 0, z: 0 }, { x: 2, z: 1 }, dts))
      .toEqual(runSequence(field, { x: 0, z: 0 }, { x: 2, z: 1 }, dts))
  })

  it('caps movement distance by max speed per update', () => {
    const field = openField()
    const position = { x: 0, z: 0 }
    const dtS = 0.25

    const next = chaseStep({ field, position, playerTarget: { x: 2, z: 0 }, dtS })

    expect(distance(position, next.position)).toBeLessThanOrEqual((NPC_WANDER.MAX_SPEED * dtS) + 1e-12)
  })

  it('stops within contact standoff and does not overshoot the player', () => {
    const field = openField()
    const playerTarget = { x: 1, z: 0 }

    const alreadyClose = chaseStep({
      field,
      position: { x: CONTACT_STANDOFF, z: 0 },
      playerTarget,
      dtS: 1,
    })
    const arrivedAtStandoff = chaseStep({
      field,
      position: { x: 0, z: 0 },
      playerTarget,
      dtS: 100,
    })

    expect(alreadyClose.position).toEqual({ x: CONTACT_STANDOFF, z: 0 })
    expect(arrivedAtStandoff.position).toEqual({ x: 1 - CONTACT_STANDOFF, z: 0 })
    expect(distanceXZ(arrivedAtStandoff.position, playerTarget)).toBeCloseTo(CONTACT_STANDOFF, 10)
  })

  it('holds position when the candidate position would be illegal', () => {
    const field = openField()
    const position = { x: 0, z: 0 }

    const next = chaseStep({ field, position, playerTarget: { x: 10, z: 0 }, dtS: 100 })

    expect(next.position).toEqual(position)
  })

  it('holds position when the segment to the candidate is blocked', () => {
    const field: NpcWanderField = {
      ...openField(),
      exclusions: [{ x: 0.6, z: 0, radius: 0.3, reason: 'footprint' }],
    }
    const position = { x: 0, z: 0 }
    const playerTarget = { x: 2, z: 0 }
    expect(isWanderPositionAllowed(field, position)).toBe(true)

    const next = chaseStep({ field, position, playerTarget, dtS: 1 })

    expect(next.position).toEqual(position)
    expect(isWanderSegmentAllowed(field, position, { x: NPC_WANDER.MAX_SPEED, z: 0 })).toBe(false)
  })

  it('keeps chase leashed by the existing wander home radius', () => {
    const field = openField()
    let position: WanderXZ = { x: 0, z: 0 }
    const playerTarget = { x: 10, z: 0 }

    for (let index = 0; index < 20; index += 1) {
      const next = chaseStep({ field, position, playerTarget, dtS: 0.25 }).position

      expect(isWanderPositionAllowed(field, next)).toBe(true)
      expect(distance(position, next)).toBeLessThanOrEqual((NPC_WANDER.MAX_SPEED * 0.25) + 1e-12)
      position = next
    }

    expect(position.x).toBeLessThanOrEqual(NPC_WANDER.MAX_RADIUS_FROM_HOME)
    expect(position.x).toBeGreaterThan(NPC_WANDER.MAX_RADIUS_FROM_HOME - (NPC_WANDER.MAX_SPEED * 0.25) - 1e-12)

    const heldAtLeash = chaseStep({ field, position, playerTarget, dtS: 0.25 })
    expect(heldAtLeash.position).toEqual(position)
  })

  it('fails closed for non-finite current or target positions', () => {
    const field = openField()
    const position = { x: 0, z: 0 }

    expect(chaseStep({ field, position: { x: Number.NaN, z: 0 }, playerTarget: { x: 1, z: 0 }, dtS: 1 }).position)
      .toEqual({ x: Number.NaN, z: 0 })
    expect(chaseStep({ field, position, playerTarget: { x: Number.POSITIVE_INFINITY, z: 0 }, dtS: 1 }).position)
      .toEqual(position)
  })

  it('treats non-finite or negative dtS as zero movement', () => {
    const field = openField()
    const position = { x: 0, z: 0 }
    const playerTarget = { x: 2, z: 0 }

    const withNaN = chaseStep({ field, position, playerTarget, dtS: NaN })
    const withNegative = chaseStep({ field, position, playerTarget, dtS: -5 })
    const withZero = chaseStep({ field, position, playerTarget, dtS: 0 })

    expect(withNaN).toEqual(withZero)
    expect(withNegative).toEqual(withZero)
    expect(withZero.position).toEqual(position)
  })

  it('does not mutate input objects', () => {
    const field = openField()
    const position = { x: 0, z: 0 }
    const playerTarget = { x: 2, z: 0 }
    const fieldBefore = JSON.stringify(field)
    const positionBefore = JSON.stringify(position)
    const targetBefore = JSON.stringify(playerTarget)

    const next = chaseStep({ field, position, playerTarget, dtS: 0.2 })

    expect(JSON.stringify(field)).toBe(fieldBefore)
    expect(JSON.stringify(position)).toBe(positionBefore)
    expect(JSON.stringify(playerTarget)).toBe(targetBefore)
    expect(next.position).not.toBe(position)
    expect(next.position).not.toBe(playerTarget)
  })
})
