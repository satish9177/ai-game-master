import { describe, expect, it } from 'vitest'
import {
  ISOMETRIC,
  clampToBounds,
  isometricCameraPose,
  isometricOffsetDirection,
  orthographicFrustum,
  screenRelativeMove,
} from './isometric'
import type { Bounds, GroundVec, Vec3 } from './isometric'

const len2 = (v: GroundVec): number => Math.hypot(v.x, v.z)
const len3 = (v: Vec3): number => Math.hypot(v.x, v.y, v.z)
const normalize2 = (v: GroundVec): GroundVec => {
  const l = len2(v)
  return { x: v.x / l, z: v.z / l }
}

const W = { forward: 1, strafe: 0 }
const S = { forward: -1, strafe: 0 }
const D = { forward: 0, strafe: 1 }
const A = { forward: 0, strafe: -1 }

describe('isometricOffsetDirection', () => {
  it('is a unit vector', () => {
    expect(len3(isometricOffsetDirection())).toBeCloseTo(1)
  })

  it('points above the ground — the camera is elevated', () => {
    expect(isometricOffsetDirection().y).toBeGreaterThan(0)
  })

  it('uses the true-isometric elevation atan(1/√2): vertical/horizontal = 1/√2', () => {
    const d = isometricOffsetDirection()
    const horizontal = Math.hypot(d.x, d.z)
    expect(d.y / horizontal).toBeCloseTo(Math.SQRT1_2) // tan(elevation) = 1/√2
    expect(ISOMETRIC.elevationRad).toBeCloseTo(Math.atan(1 / Math.SQRT2))
  })

  it('at the default 45° azimuth the three components are equal (1/√3)', () => {
    const d = isometricOffsetDirection()
    const third = 1 / Math.sqrt(3)
    expect(d.x).toBeCloseTo(third)
    expect(d.y).toBeCloseTo(third)
    expect(d.z).toBeCloseTo(third)
  })

  it('at 0° azimuth the camera sits toward +Z (south) and looks north', () => {
    const d = isometricOffsetDirection(0)
    expect(d.x).toBeCloseTo(0)
    expect(d.z).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    expect(isometricOffsetDirection()).toEqual(isometricOffsetDirection())
  })
})

describe('isometricCameraPose', () => {
  it('places the camera at target + offsetDirection · distance', () => {
    const dir = isometricOffsetDirection()
    const pose = isometricCameraPose({ x: 0, y: 0, z: 0 })
    expect(pose.position.x).toBeCloseTo(dir.x * ISOMETRIC.distance)
    expect(pose.position.y).toBeCloseTo(dir.y * ISOMETRIC.distance)
    expect(pose.position.z).toBeCloseTo(dir.z * ISOMETRIC.distance)
  })

  it('keeps the target as the look-at point', () => {
    const pose = isometricCameraPose({ x: 3, y: 1, z: -2 })
    expect(pose.target).toEqual({ x: 3, y: 1, z: -2 })
  })

  it('sits above the target', () => {
    const pose = isometricCameraPose({ x: 1, y: 0, z: 1 })
    expect(pose.position.y).toBeGreaterThan(pose.target.y)
  })

  it('looks at the target along the offset direction', () => {
    const target = { x: 2, y: 0, z: -3 }
    const pose = isometricCameraPose(target)
    const dir = isometricOffsetDirection()
    const back = len3({
      x: pose.position.x - target.x,
      y: pose.position.y - target.y,
      z: pose.position.z - target.z,
    })
    expect((pose.position.x - target.x) / back).toBeCloseTo(dir.x)
    expect((pose.position.y - target.y) / back).toBeCloseTo(dir.y)
    expect((pose.position.z - target.z) / back).toBeCloseTo(dir.z)
  })

  it('follows the target: translating it translates the camera equally', () => {
    const a = isometricCameraPose({ x: 0, y: 0, z: 0 }).position
    const b = isometricCameraPose({ x: 5, y: 0, z: -7 }).position
    expect(b.x - a.x).toBeCloseTo(5)
    expect(b.y - a.y).toBeCloseTo(0)
    expect(b.z - a.z).toBeCloseTo(-7)
  })

  it('is deterministic', () => {
    expect(isometricCameraPose({ x: 1, y: 2, z: 3 })).toEqual(
      isometricCameraPose({ x: 1, y: 2, z: 3 }),
    )
  })

  it('does not mutate the input target', () => {
    const target = Object.freeze({ x: 1, y: 2, z: 3 })
    expect(() => isometricCameraPose(target)).not.toThrow()
    expect(target).toEqual({ x: 1, y: 2, z: 3 })
  })
})

describe('screenRelativeMove', () => {
  it('returns no movement when there is no input', () => {
    expect(screenRelativeMove({ forward: 0, strafe: 0 })).toEqual({ x: 0, z: 0 })
  })

  it('W goes up-screen (into the scene); at 45° that is (-1/√2, -1/√2)', () => {
    const v = screenRelativeMove(W)
    expect(len2(v)).toBeCloseTo(1)
    expect(v.x).toBeCloseTo(-Math.SQRT1_2)
    expect(v.z).toBeCloseTo(-Math.SQRT1_2)
  })

  it('S is the exact opposite of W (down-screen)', () => {
    const w = screenRelativeMove(W)
    const s = screenRelativeMove(S)
    expect(s.x).toBeCloseTo(-w.x)
    expect(s.z).toBeCloseTo(-w.z)
  })

  it('D goes screen-right; at 45° that is (1/√2, -1/√2)', () => {
    const v = screenRelativeMove(D)
    expect(len2(v)).toBeCloseTo(1)
    expect(v.x).toBeCloseTo(Math.SQRT1_2)
    expect(v.z).toBeCloseTo(-Math.SQRT1_2)
  })

  it('A is the exact opposite of D (screen-left)', () => {
    const d = screenRelativeMove(D)
    const a = screenRelativeMove(A)
    expect(a.x).toBeCloseTo(-d.x)
    expect(a.z).toBeCloseTo(-d.z)
  })

  it('up-screen and screen-right are perpendicular', () => {
    const w = screenRelativeMove(W)
    const d = screenRelativeMove(D)
    expect(w.x * d.x + w.z * d.z).toBeCloseTo(0)
  })

  it('normalizes diagonals so they are not faster than a single axis', () => {
    expect(len2(screenRelativeMove({ forward: 1, strafe: 1 }))).toBeCloseTo(1)
    expect(len2(screenRelativeMove({ forward: 1, strafe: -1 }))).toBeCloseTo(1)
    // At 45° azimuth the screen diagonals collapse onto the world axes.
    const wd = screenRelativeMove({ forward: 1, strafe: 1 })
    expect(wd.x).toBeCloseTo(0)
    expect(wd.z).toBeCloseTo(-1) // W+D → straight north
    const wa = screenRelativeMove({ forward: 1, strafe: -1 })
    expect(wa.x).toBeCloseTo(-1) // W+A → straight west
    expect(wa.z).toBeCloseTo(0)
  })

  it('ties to the camera: W points from the camera toward the target on the ground', () => {
    const target = { x: 3, y: 0, z: -2 }
    const pose = isometricCameraPose(target)
    const groundTowardTarget = normalize2({
      x: target.x - pose.position.x,
      z: target.z - pose.position.z,
    })
    const w = screenRelativeMove(W)
    expect(w.x).toBeCloseTo(groundTowardTarget.x)
    expect(w.z).toBeCloseTo(groundTowardTarget.z)
  })

  it('respects a non-default azimuth (0° → axis-aligned screen)', () => {
    const w0 = screenRelativeMove(W, 0)
    expect(w0.x).toBeCloseTo(0) // W → straight north (-Z)
    expect(w0.z).toBeCloseTo(-1)
    const d0 = screenRelativeMove(D, 0)
    expect(d0.x).toBeCloseTo(1) // D → straight east (+X)
    expect(d0.z).toBeCloseTo(0)
  })

  it('does not mutate the input', () => {
    const input = Object.freeze({ forward: 1, strafe: 1 })
    expect(() => screenRelativeMove(input)).not.toThrow()
    expect(input).toEqual({ forward: 1, strafe: 1 })
  })
})

describe('clampToBounds', () => {
  const bounds: Bounds = { minX: -5, maxX: 5, minZ: -10, maxZ: 10 }

  it('leaves an inside position unchanged but returns a fresh object', () => {
    const pos = { x: 1, z: 2 }
    const out = clampToBounds(pos, bounds)
    expect(out).toEqual({ x: 1, z: 2 })
    expect(out).not.toBe(pos)
  })

  it('clamps past the maximum on both axes', () => {
    expect(clampToBounds({ x: 99, z: 99 }, bounds)).toEqual({ x: 5, z: 10 })
  })

  it('clamps past the minimum on both axes', () => {
    expect(clampToBounds({ x: -99, z: -99 }, bounds)).toEqual({ x: -5, z: -10 })
  })

  it('leaves a position exactly on the boundary unchanged', () => {
    expect(clampToBounds({ x: 5, z: -10 }, bounds)).toEqual({ x: 5, z: -10 })
  })

  it('does not mutate the input', () => {
    const pos = Object.freeze({ x: 99, z: -99 })
    expect(() => clampToBounds(pos, bounds)).not.toThrow()
    expect(pos).toEqual({ x: 99, z: -99 })
  })
})

describe('orthographicFrustum', () => {
  it('is square at aspect 1', () => {
    const f = orthographicFrustum(1)
    expect(f.right).toBeCloseTo(f.top)
    expect(f.right).toBeCloseTo(ISOMETRIC.viewSize / 2)
  })

  it('widens horizontally with the aspect ratio', () => {
    const f = orthographicFrustum(2)
    expect(f.right).toBeCloseTo(2 * f.top)
  })

  it('is symmetric about the origin', () => {
    const f = orthographicFrustum(1.5)
    expect(f.left).toBeCloseTo(-f.right)
    expect(f.bottom).toBeCloseTo(-f.top)
  })

  it('frames ISOMETRIC.viewSize world-meters vertically by default', () => {
    expect(orthographicFrustum(1).top).toBeCloseTo(ISOMETRIC.viewSize / 2)
  })
})
