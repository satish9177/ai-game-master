import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildPlayerMarker } from './playerMarker'

/**
 * No-WebGL test: the marker reads as a planted figure — a body, a facing nose,
 * and a grounding ring — and the body casts a shadow for isometric depth.
 */
describe('buildPlayerMarker', () => {
  it('builds a body, a facing nose, and a grounding ring', () => {
    const g = buildPlayerMarker()
    const meshes = g.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
    expect(meshes.length).toBeGreaterThanOrEqual(3)
    expect(g.children.some((c) => c.name === 'ground-ring')).toBe(true)
  })

  it('casts a shadow so the marker grounds onto the floor', () => {
    const g = buildPlayerMarker()
    let casts = false
    g.traverse((c) => {
      const mesh = c as THREE.Mesh
      if (mesh.isMesh && mesh.castShadow) casts = true
    })
    expect(casts).toBe(true)
  })
})
