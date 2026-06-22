import type * as THREE from 'three'
import type { Vec3 } from './isometric'

/**
 * The engine's camera abstraction: something that owns a Three.js camera, frames
 * a moving world-space target each frame, reframes on viewport resize, and tears
 * down cleanly. The Engine renders through `camera` and never sets the projection
 * or pose itself, so swapping the isometric controller for a free-fly or
 * first-person one later is a local change behind this seam.
 *
 * Pure camera math lives in `./isometric`; implementations are thin adapters
 * that apply that math to a concrete `THREE.Camera`.
 */
export interface CameraController {
  /** The camera the engine renders with. Owned by the controller. */
  readonly camera: THREE.Camera
  /** Frame `target`, holding the controller's fixed angle/zoom. Called per frame. */
  follow(target: Vec3): void
  /** Reframe for a new viewport aspect ratio (width / height). */
  resize(aspect: number): void
  /** Release any held resources (the camera itself holds none). */
  dispose(): void
}
