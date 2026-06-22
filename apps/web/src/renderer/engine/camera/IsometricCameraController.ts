import * as THREE from 'three'
import type { CameraController } from './CameraController'
import { ISOMETRIC, isometricCameraPose, orthographicFrustum } from './isometric'
import type { Vec3 } from './isometric'

/**
 * A `CameraController` backed by an `OrthographicCamera` at the fixed
 * true-isometric angle. It follows a target from a constant offset and keeps
 * world units un-stretched on any viewport. All the geometry comes from the pure
 * `./isometric` helpers — this class only applies the results to the Three.js
 * camera, so it can be reasoned about (and the math tested) without a GPU.
 *
 * Orthographic, so distance does not change apparent size; v0 has no zoom, so the
 * frustum is fixed except for aspect (handled in `resize`).
 */
export class IsometricCameraController implements CameraController {
  readonly camera: THREE.OrthographicCamera

  constructor(aspect = 1) {
    const f = orthographicFrustum(aspect)
    this.camera = new THREE.OrthographicCamera(
      f.left,
      f.right,
      f.top,
      f.bottom,
      ISOMETRIC.near,
      ISOMETRIC.far,
    )
  }

  /** Place the camera at the isometric pose for `target` and look at `target`. */
  follow(target: Vec3): void {
    const pose = isometricCameraPose(target)
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z)
    this.camera.lookAt(pose.target.x, pose.target.y, pose.target.z)
  }

  /** Recompute the orthographic frustum for a new aspect ratio. */
  resize(aspect: number): void {
    const f = orthographicFrustum(aspect)
    this.camera.left = f.left
    this.camera.right = f.right
    this.camera.top = f.top
    this.camera.bottom = f.bottom
    this.camera.updateProjectionMatrix()
  }

  /** An orthographic camera holds no GPU resources; nothing to free. Present for
   * the controller contract and future controllers that may own resources. */
  dispose(): void {}
}
