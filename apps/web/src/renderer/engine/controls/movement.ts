import type * as THREE from 'three'
import { clampToBounds, screenRelativeMove } from '../camera/isometric'
import type { Bounds } from '../camera/isometric'

export type { Bounds }

/**
 * Screen-relative ground movement for the isometric view. WASD / arrow keys move
 * the player on the XZ plane relative to the fixed camera azimuth: W / ArrowUp
 * goes up-screen (into the scene, away from the camera), S / ArrowDown toward the
 * camera, and A / D strafe screen-left / screen-right. Delta-time scaled so speed
 * is frame-rate independent, diagonals are normalized, and the result is clamped
 * to the room's axis-aligned box. The player's height (Y) is never changed; the
 * camera follows separately.
 *
 * The direction and clamp math is the pure, unit-tested `camera/isometric`
 * module — this class only owns keyboard state and applies the result to the
 * player object.
 */
export class MovementControls {
  private readonly keys = new Set<string>()
  private readonly speed = 4 // meters per second
  private enabled = true

  constructor() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  /** Gates movement (e.g. while a dialogue panel is open); clears held keys. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.keys.clear()
  }

  /** Advances `player` one frame from the held keys; mutates only its X/Z. */
  update(player: THREE.Object3D, dt: number, bounds: Bounds): void {
    if (!this.enabled) return
    let forward = 0
    let strafe = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) strafe += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) strafe -= 1
    if (forward === 0 && strafe === 0) return

    const dir = screenRelativeMove({ forward, strafe })
    const dist = this.speed * dt
    const next = clampToBounds(
      { x: player.position.x + dir.x * dist, z: player.position.z + dir.z * dist },
      bounds,
    )
    player.position.x = next.x
    player.position.z = next.z
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return
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
