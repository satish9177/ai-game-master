import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildLighting, gradeLightingColor } from './lighting'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import lightingSource from './lighting.ts?raw'
import engineSource from '../Engine.ts?raw'

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

function ambientOf(group: THREE.Group): THREE.AmbientLight {
  const ambient = group.children.find(
    (c): c is THREE.AmbientLight => c instanceof THREE.AmbientLight,
  )
  if (!ambient) throw new Error('no ambient light')
  return ambient
}

function hemisphereOf(group: THREE.Group): THREE.HemisphereLight {
  const hemisphere = group.children.find(
    (c): c is THREE.HemisphereLight => c instanceof THREE.HemisphereLight,
  )
  if (!hemisphere) throw new Error('no hemisphere light')
  return hemisphere
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

  it('applies a deterministic warm fantasy-keep lighting grade without changing intensities', () => {
    const group = buildLighting(lighting(true), DIMS, 'fantasy-keep')
    const ambient = ambientOf(group)
    const hemisphere = hemisphereOf(group)
    const sun = directionalOf(group)

    expect(ambient.color.getHexString()).toBe(
      gradeLightingColor('#404858', 'fantasy-keep', 'ambient').slice(1),
    )
    expect(hemisphere.color.getHexString()).toBe(
      gradeLightingColor('#8090a0', 'fantasy-keep', 'hemisphereSky').slice(1),
    )
    expect(hemisphere.groundColor.getHexString()).toBe(
      gradeLightingColor('#30281f', 'fantasy-keep', 'hemisphereGround').slice(1),
    )
    expect(sun.color.getHexString()).toBe(
      gradeLightingColor('#fff6e8', 'fantasy-keep', 'key').slice(1),
    )
    expect(ambient.intensity).toBeCloseTo(0.85)
    expect(hemisphere.intensity).toBeCloseTo(0.5)
    expect(sun.intensity).toBeCloseTo(2.35)
  })

  it('applies a deterministic cold post-apoc lighting grade without changing intensities', () => {
    const group = buildLighting(lighting(true), DIMS, 'post-apoc')
    const ambient = ambientOf(group)
    const hemisphere = hemisphereOf(group)
    const sun = directionalOf(group)

    expect(ambient.color.getHexString()).toBe(
      gradeLightingColor('#404858', 'post-apoc', 'ambient').slice(1),
    )
    expect(hemisphere.color.getHexString()).toBe(
      gradeLightingColor('#8090a0', 'post-apoc', 'hemisphereSky').slice(1),
    )
    expect(hemisphere.groundColor.getHexString()).toBe(
      gradeLightingColor('#30281f', 'post-apoc', 'hemisphereGround').slice(1),
    )
    expect(sun.color.getHexString()).toBe(
      gradeLightingColor('#fff6e8', 'post-apoc', 'key').slice(1),
    )
    expect(ambient.intensity).toBeCloseTo(0.85)
    expect(hemisphere.intensity).toBeCloseTo(0.5)
    expect(sun.intensity).toBeCloseTo(2.35)
  })

  it('preserves existing neutral lighting exactly for null theme', () => {
    const group = buildLighting(lighting(true), DIMS, null)
    const ambient = ambientOf(group)
    const hemisphere = hemisphereOf(group)
    const sun = directionalOf(group)

    expect(ambient.color.getHexString()).toBe('404858')
    expect(hemisphere.color.getHexString()).toBe('8090a0')
    expect(hemisphere.groundColor.getHexString()).toBe('30281f')
    expect(sun.color.getHexString()).toBe('fff6e8')
  })

  it('grades lighting colors as a pure deterministic helper', () => {
    expect(gradeLightingColor('#404858', 'fantasy-keep', 'ambient')).toBe(
      gradeLightingColor('#404858', 'fantasy-keep', 'ambient'),
    )
    expect(gradeLightingColor('#404858', 'post-apoc', 'ambient')).toBe(
      gradeLightingColor('#404858', 'post-apoc', 'ambient'),
    )
    expect(gradeLightingColor('#404858', null, 'ambient')).toBe('#404858')
  })

  it('does not import forbidden App, provider, memory, persistence, dialogue, or FTS modules', () => {
    const imports = `${lightingSource}\n${engineSource}`
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .join('\n')

    expect(imports).not.toContain('App')
    expect(imports).not.toContain('provider')
    expect(imports).not.toContain('memory')
    expect(imports).not.toContain('persistence')
    expect(imports).not.toContain('dialogue')
    expect(imports).not.toContain('fts')
    expect(imports).not.toContain('FTS')
  })
})
