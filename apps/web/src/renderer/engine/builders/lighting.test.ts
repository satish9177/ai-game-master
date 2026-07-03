import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildLighting } from './lighting'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'

/**
 * No-WebGL test: builds the lighting group and inspects the lights. Ambient and
 * hemisphere come from the RoomSpec; the directional key light is renderer-
 * internal and casts shadows with a frustum fitted to the room dimensions.
 */

type Lighting = LoadedRoom['lighting']
type Dimensions = LoadedRoom['shell']['dimensions']

const DIMS: Dimensions = { width: 14, depth: 20, height: 6 }

function lighting(withHemisphere: boolean): Lighting {
  return {
    ambient: { color: '#404858', intensity: 0.85 },
    hemisphere: withHemisphere
      ? { sky: '#8090a0', ground: '#30281f', intensity: 0.5 }
      : undefined,
  } as Lighting
}

function directionalOf(group: THREE.Group): THREE.DirectionalLight {
  const sun = group.children.find(
    (c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight,
  )
  if (!sun) throw new Error('no directional key light')
  return sun
}

describe('buildLighting', () => {
  it('builds ambient and hemisphere from the spec when the hemisphere is present', () => {
    const g = buildLighting(lighting(true), DIMS)
    expect(g.children.some((c) => c instanceof THREE.AmbientLight)).toBe(true)
    expect(g.children.some((c) => c instanceof THREE.HemisphereLight)).toBe(true)
  })

  it('omits the hemisphere light when the spec omits it', () => {
    const g = buildLighting(lighting(false), DIMS)
    expect(g.children.some((c) => c instanceof THREE.AmbientLight)).toBe(true)
    expect(g.children.some((c) => c instanceof THREE.HemisphereLight)).toBe(false)
  })

  it('adds a renderer-internal directional key light that casts shadows', () => {
    const sun = directionalOf(buildLighting(lighting(true), DIMS))
    expect(sun.castShadow).toBe(true)
    expect(sun.intensity).toBeCloseTo(2.35)
    expect(sun.color.getHexString()).toBe('fff6e8')
    // The light's target must be in the group so its aim applies.
    const g = buildLighting(lighting(true), DIMS)
    expect(g.children.includes(directionalOf(g).target)).toBe(true)
  })

  it('fits the shadow frustum to the room so the whole room is covered', () => {
    const sun = directionalOf(buildLighting(lighting(true), DIMS))
    const radius = 0.5 * Math.hypot(DIMS.width, DIMS.depth, DIMS.height)
    const cam = sun.shadow.camera
    expect(cam.right).toBeGreaterThanOrEqual(radius)
    expect(cam.top).toBeGreaterThanOrEqual(radius)
    expect(cam.left).toBeLessThanOrEqual(-radius)
    expect(cam.bottom).toBeLessThanOrEqual(-radius)
    expect(cam.far).toBeGreaterThan(cam.near)
  })

  it('grows the shadow frustum with the room (fitted, not a fixed size)', () => {
    const small = directionalOf(buildLighting(lighting(true), DIMS))
    const large = directionalOf(
      buildLighting(lighting(true), { width: 28, depth: 40, height: 12 }),
    )
    expect(large.shadow.camera.right).toBeGreaterThan(small.shadow.camera.right)
  })
})
