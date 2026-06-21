import type * as THREE from 'three'

/** Axis-aligned clamp region for the player on the XZ plane (meters). */
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * WASD movement on the XZ plane. Delta-time scaled so speed is frame-rate
 * independent, and clamped to an axis-aligned room box (no per-object
 * collision). Camera height (Y) is never changed.
 *
 * Convention: forward = (sin yaw, cos yaw); right = (-cos yaw, sin yaw), so at
 * yaw=180 (facing north / -Z) W walks north and D strafes east.
 */
export class MovementControls {
  private readonly keys = new Set<string>()
  private readonly speed = 4 // meters per second

  constructor() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  update(camera: THREE.PerspectiveCamera, yaw: number, dt: number, bounds: Bounds): void {
    let forward = 0
    let strafe = 0
    if (this.keys.has('KeyW')) forward += 1
    if (this.keys.has('KeyS')) forward -= 1
    if (this.keys.has('KeyD')) strafe += 1
    if (this.keys.has('KeyA')) strafe -= 1
    if (forward === 0 && strafe === 0) return

    const fx = Math.sin(yaw)
    const fz = Math.cos(yaw)
    const rx = -Math.cos(yaw)
    const rz = Math.sin(yaw)

    let dx = fx * forward + rx * strafe
    let dz = fz * forward + rz * strafe
    const len = Math.hypot(dx, dz)
    if (len > 0) {
      dx /= len // normalize so diagonals aren't faster
      dz /= len
    }

    const dist = this.speed * dt
    camera.position.x += dx * dist
    camera.position.z += dz * dist

    camera.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, camera.position.x))
    camera.position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, camera.position.z))
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code)
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.keys.clear()
  }
}
