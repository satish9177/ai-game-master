import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildBarrel, buildBarricade, buildCrate, buildDebris } from './postApocProps'
import type { RoomObject } from '../../../domain/roomSpec'

/**
 * Geometry-only tests (no WebGL). The post-apoc props must rest on the floor
 * (base at y=0), be deterministic, and honor the one-material-per-mesh disposal
 * invariant (so disposeObject never double-frees a shared material).
 */

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

const crate = (size: [number, number, number] = [1, 1, 1]): ObjectOf<'crate'> =>
  ({ type: 'crate', position: [0, 0, 0], rotationY: 0, scale: 1, size, color: '#7a5a32' })

const barrel = (): ObjectOf<'barrel'> =>
  ({ type: 'barrel', position: [0, 0, 0], rotationY: 0, scale: 1, radius: 0.35, height: 0.95, color: '#46603a' })

const debris = (): ObjectOf<'debris'> =>
  ({ type: 'debris', position: [0, 0, 0], rotationY: 0, scale: 1, size: [2, 0.8, 2], color: '#6b6358' })

const barricade = (style: 'planks' | 'sandbags'): ObjectOf<'barricade'> =>
  ({ type: 'barricade', position: [0, 0, 0], rotationY: 0, scale: 1, length: 3, height: 1.2, style, color: '#5a4a32' })

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh)
  })
  return out
}

const builders: [string, () => THREE.Object3D][] = [
  ['crate', () => buildCrate(crate())],
  ['barrel', () => buildBarrel(barrel())],
  ['debris', () => buildDebris(debris())],
  ['barricade(planks)', () => buildBarricade(barricade('planks'))],
  ['barricade(sandbags)', () => buildBarricade(barricade('sandbags'))],
]

describe('post-apoc prop builders', () => {
  it.each(builders)('%s builds at least one mesh resting on the floor', (_name, build) => {
    const parts = meshes(build())
    expect(parts.length).toBeGreaterThan(0)
    for (const mesh of parts) {
      // Every part's center sits on or above the floor plane.
      expect(mesh.position.y).toBeGreaterThanOrEqual(0)
    }
  })

  it.each(builders)('%s gives every mesh its own geometry and material', (_name, build) => {
    const parts = meshes(build())
    const geometries = new Set(parts.map((m) => m.geometry))
    const materials = new Set(parts.map((m) => m.material))
    expect(geometries.size).toBe(parts.length)
    expect(materials.size).toBe(parts.length)
  })

  it('builds the crate deterministically (same spec, identical layout)', () => {
    const positions = (o: THREE.Object3D) => meshes(o).map((m) => m.position.toArray())
    expect(positions(buildCrate(crate()))).toEqual(positions(buildCrate(crate())))
  })

  it('scales debris chunks with the requested size', () => {
    const small = new THREE.Box3().setFromObject(buildDebris({ ...debris(), size: [2, 0.8, 2] }))
    const large = new THREE.Box3().setFromObject(buildDebris({ ...debris(), size: [4, 1.6, 4] }))
    expect(large.max.y).toBeGreaterThan(small.max.y)
  })

  it('renders the two barricade styles with different geometry', () => {
    const planks = meshes(buildBarricade(barricade('planks')))
    const sandbags = meshes(buildBarricade(barricade('sandbags')))
    expect(planks.length).not.toBe(sandbags.length)
  })
})
