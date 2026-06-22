import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { IsometricCameraController } from './IsometricCameraController'
import { ISOMETRIC, isometricCameraPose, orthographicFrustum } from './isometric'

/**
 * The controller is a thin adapter over the pure `./isometric` math (covered in
 * isometric.test.ts), so these tests only guard the wiring: that it builds an
 * orthographic camera with the right planes, applies the pose, and reframes on
 * resize. No WebGL — only a camera and vectors, which run under plain Node.
 */
describe('IsometricCameraController', () => {
  it('owns an orthographic camera with the isometric near/far planes', () => {
    const c = new IsometricCameraController()
    expect(c.camera).toBeInstanceOf(THREE.OrthographicCamera)
    const cam = c.camera as THREE.OrthographicCamera
    expect(cam.near).toBeCloseTo(ISOMETRIC.near)
    expect(cam.far).toBeCloseTo(ISOMETRIC.far)
  })

  it('frames the configured view size for the initial aspect', () => {
    const cam = new IsometricCameraController(2).camera as THREE.OrthographicCamera
    const f = orthographicFrustum(2)
    expect(cam.left).toBeCloseTo(f.left)
    expect(cam.right).toBeCloseTo(f.right)
    expect(cam.top).toBeCloseTo(f.top)
    expect(cam.bottom).toBeCloseTo(f.bottom)
  })

  it('recomputes the frustum on resize', () => {
    const c = new IsometricCameraController(1)
    c.resize(3)
    const cam = c.camera as THREE.OrthographicCamera
    const f = orthographicFrustum(3)
    expect(cam.left).toBeCloseTo(f.left)
    expect(cam.right).toBeCloseTo(f.right)
    expect(cam.top).toBeCloseTo(f.top)
    expect(cam.bottom).toBeCloseTo(f.bottom)
  })

  it('positions the camera at the pure isometric pose when following a target', () => {
    const c = new IsometricCameraController()
    const target = { x: 2, y: 0, z: -3 }
    c.follow(target)
    const pose = isometricCameraPose(target)
    expect(c.camera.position.x).toBeCloseTo(pose.position.x)
    expect(c.camera.position.y).toBeCloseTo(pose.position.y)
    expect(c.camera.position.z).toBeCloseTo(pose.position.z)
  })

  it('looks toward the target it follows', () => {
    const c = new IsometricCameraController()
    const target = new THREE.Vector3(1, 0, 1)
    c.follow(target)
    const forward = c.camera.getWorldDirection(new THREE.Vector3())
    const expected = target.clone().sub(c.camera.position).normalize()
    expect(forward.x).toBeCloseTo(expected.x)
    expect(forward.y).toBeCloseTo(expected.y)
    expect(forward.z).toBeCloseTo(expected.z)
  })

  it('follows: translating the target translates the camera equally', () => {
    const c = new IsometricCameraController()
    c.follow({ x: 0, y: 0, z: 0 })
    const a = c.camera.position.clone()
    c.follow({ x: 5, y: 0, z: -7 })
    const b = c.camera.position.clone()
    expect(b.x - a.x).toBeCloseTo(5)
    expect(b.y - a.y).toBeCloseTo(0)
    expect(b.z - a.z).toBeCloseTo(-7)
  })
})
