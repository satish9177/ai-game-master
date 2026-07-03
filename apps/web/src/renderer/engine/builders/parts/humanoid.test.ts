import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildHumanoid } from './humanoid'

/**
 * Geometry-only tests for the shared humanoid kit. Defaults reproduce the robed
 * NPC (with a turban); the zombie-style options drop the headwear and reach the
 * arms forward. One material per mesh keeps disposeObject safe.
 */

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh)
  })
  return out
}

function standardMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  if (Array.isArray(mesh.material) || !(mesh.material instanceof THREE.MeshStandardMaterial)) {
    throw new Error('expected humanoid standard material')
  }
  return mesh.material
}

describe('buildHumanoid', () => {
  it('assembles a full figure including a head, with unique materials per mesh', () => {
    const parts = meshes(buildHumanoid({ robeColor: '#3a6ea5' }))
    expect(parts.length).toBeGreaterThanOrEqual(12)
    const head = parts.find((m) => m.geometry instanceof THREE.SphereGeometry && m.position.y > 1.4)
    expect(head).toBeDefined()
    expect(new Set(parts.map((m) => m.material)).size).toBe(parts.length)
    expect(standardMaterial(parts[0]!).roughness).toBeCloseTo(0.78)
    expect(standardMaterial(parts[0]!).metalness).toBeCloseTo(0.02)
  })

  it('adds an optional front accent for NPC silhouette readability', () => {
    const parts = meshes(buildHumanoid({ robeColor: '#3a6ea5', accentColor: '#f0c96b' }))
    const accent = parts.find((mesh) => standardMaterial(mesh).color.getHexString() === 'f0c96b')

    expect(accent).toBeDefined()
    expect(accent?.position.toArray()).toEqual([-0.12, 0.86, 0.25])
  })

  it('omits the headwear mesh when the head is bare', () => {
    const turbaned = meshes(buildHumanoid({ robeColor: '#3a6ea5', headwear: 'turban' }))
    const bare = meshes(buildHumanoid({ robeColor: '#3a6ea5', headwear: 'bare' }))
    expect(bare.length).toBe(turbaned.length - 1)
  })

  it('reaches the arms forward in the reach pose', () => {
    const rest = meshes(buildHumanoid({ robeColor: '#5c6b46', arms: 'rest' }))
    const reach = meshes(buildHumanoid({ robeColor: '#5c6b46', arms: 'reach' }))
    expect(rest.every((m) => m.rotation.x === 0)).toBe(true)
    expect(reach.some((m) => m.rotation.x !== 0)).toBe(true)
  })
})
