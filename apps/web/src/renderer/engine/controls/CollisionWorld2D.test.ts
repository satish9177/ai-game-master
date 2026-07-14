import { describe, expect, it } from 'vitest'
import { canReachWithinBounds, CollisionWorld2D, findNearestFreePoint, overlapsCircle } from './CollisionWorld2D'

describe('overlapsCircle', () => {
  it('supports circles and rotated boxes', () => {
    expect(overlapsCircle(
      { x: 0.9, z: 0 },
      0.2,
      { id: 'circle', kind: 'circle', center: { x: 0, z: 0 }, radius: 0.8 },
    )).toBe(true)

    expect(overlapsCircle(
      { x: 0.7, z: 0 },
      0.2,
      {
        id: 'box',
        kind: 'box',
        center: { x: 0, z: 0 },
        halfExtents: [1, 0.2],
        rotationY: Math.PI / 2,
      },
    )).toBe(false)
  })
})

describe('CollisionWorld2D', () => {
  it('slides along a wall instead of stopping all movement', () => {
    const world = new CollisionWorld2D()
    world.add({
      id: 'wall',
      kind: 'box',
      center: { x: 1, z: 0 },
      halfExtents: [0.1, 4],
      rotationY: 0,
    })

    const result = world.moveCircle(
      { x: 0, z: 0 },
      { x: 2, z: 2 },
      0.3,
    )
    expect(result.collided).toBe(true)
    expect(result.position.x).toBeLessThan(0.61)
    expect(result.position.z).toBeGreaterThan(1)
  })

  it('substeps large movement so a player cannot tunnel through furniture', () => {
    const world = new CollisionWorld2D()
    world.add({
      id: 'table',
      kind: 'box',
      center: { x: 0, z: 0 },
      halfExtents: [1, 0.25],
      rotationY: 0,
    })
    const result = world.moveCircle({ x: 0, z: 3 }, { x: 0, z: -6 }, 0.3)
    expect(result.collided).toBe(true)
    expect(result.position.z).toBeGreaterThanOrEqual(0.54)
  })

  it('preserves an explicit gap between exit posts', () => {
    const world = new CollisionWorld2D()
    world.add({
      id: 'left-post',
      kind: 'box',
      center: { x: -1.8, z: 0 },
      halfExtents: [0.7, 0.3],
      rotationY: 0,
    })
    world.add({
      id: 'right-post',
      kind: 'box',
      center: { x: 1.8, z: 0 },
      halfExtents: [0.7, 0.3],
      rotationY: 0,
    })
    const result = world.moveCircle({ x: 0, z: 2 }, { x: 0, z: -4 }, 0.35)
    expect(result.collided).toBe(false)
    expect(result.position.z).toBeCloseTo(-2)
  })

  it('updates duplicate IDs, removes colliders, and clears spatial buckets', () => {
    const world = new CollisionWorld2D()
    world.add({ id: 'rock', kind: 'circle', center: { x: 0, z: 0 }, radius: 1 })
    world.add({ id: 'rock', kind: 'circle', center: { x: 5, z: 5 }, radius: 1 })
    expect(world.size).toBe(1)
    expect(world.collidesCircle({ x: 0, z: 0 }, 0.2)).toBe(false)
    expect(world.collidesCircle({ x: 5, z: 5 }, 0.2)).toBe(true)
    world.remove('rock')
    expect(world.size).toBe(0)
    world.clear()
    expect(world.collidesCircle({ x: 5, z: 5 }, 0.2)).toBe(false)
  })
})

describe('final collision-world reachability', () => {
  it('repairs an invalid spawn to the nearest clear point inside bounds', () => {
    const world = new CollisionWorld2D()
    world.add({ id: 'crate', kind: 'circle', center: { x: 0, z: 0 }, radius: 0.8 })
    const repaired = findNearestFreePoint(world, { x: 0, z: 0 }, {
      minX: -3, maxX: 3, minZ: -3, maxZ: 3,
    }, 0.32)
    expect(repaired).not.toBeNull()
    expect(world.collidesCircle(repaired!, 0.32)).toBe(false)
  })

  it('uses the player radius when checking a route to an interaction range', () => {
    const world = new CollisionWorld2D()
    world.add({
      id: 'wall', kind: 'box', center: { x: 0, z: 0 },
      halfExtents: [0.1, 3], rotationY: 0,
    })
    const bounds = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 }
    expect(canReachWithinBounds(world, { x: -1, z: 0 }, { x: 1, z: 0 }, 0.3, bounds, 0.32))
      .toBe(false)
    expect(canReachWithinBounds(world, { x: -1, z: 0 }, { x: -1, z: 1 }, 0.3, bounds, 0.32))
      .toBe(true)
  })
})
