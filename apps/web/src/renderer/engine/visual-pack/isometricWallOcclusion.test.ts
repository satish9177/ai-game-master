import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { updateIsometricWallOcclusion } from './isometricWallOcclusion'

describe('updateIsometricWallOcclusion', () => {
  it('fades only foreground walls and restores one owned material clone', () => {
    const scene = new THREE.Group()
    const focus = new THREE.Object3D()
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(8, 8, 8)
    const original = new THREE.MeshStandardMaterial({ opacity: 1 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original)
    const foreground = new THREE.Group()
    foreground.userData.objectType = 'architecture'
    foreground.userData.visualSemanticKey = 'architecture.wall-straight'
    foreground.position.set(2, 0, 2)
    foreground.add(mesh)
    const rear = new THREE.Group()
    rear.userData.objectType = 'architecture'
    rear.userData.visualSemanticKey = 'architecture.wall-straight'
    rear.position.set(-2, 0, -2)
    scene.add(foreground, rear)

    updateIsometricWallOcclusion(scene, focus, camera)
    const faded = mesh.material as THREE.MeshStandardMaterial
    expect(faded).not.toBe(original)
    expect(faded.opacity).toBeCloseTo(0.18)
    expect(faded.transparent).toBe(true)

    foreground.position.set(-2, 0, -2)
    updateIsometricWallOcclusion(scene, focus, camera)
    expect(mesh.material).toBe(faded)
    expect(faded.opacity).toBe(1)
    expect(faded.transparent).toBe(false)
    expect(mesh.userData.visualPackOwnedMaterial).toBe(true)
  })
})
