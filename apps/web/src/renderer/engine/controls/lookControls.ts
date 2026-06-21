import * as THREE from 'three'

/**
 * Mouse drag-look (no pointer-lock). Holds yaw/pitch in radians and orients the
 * camera about its current position each frame. Drag right looks right, drag up
 * looks up; pitch is clamped to just under straight up/down.
 *
 * Convention: yaw forward = (sin yaw, cos yaw), matching MovementControls.
 */
export class LookControls {
  private yaw: number
  private pitch = 0
  private enabled = true
  private dragging = false
  private lastX = 0
  private lastY = 0
  private readonly element: HTMLElement
  private readonly scratch = new THREE.Vector3()
  private readonly sensitivity = 0.0025 // radians per pixel
  private readonly maxPitch = Math.PI / 2 - 0.05

  constructor(element: HTMLElement, initialYaw: number) {
    this.element = element
    this.yaw = initialYaw
    element.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
  }

  get yawAngle(): number {
    return this.yaw
  }

  /** Gates drag-look (e.g. while a dialogue panel is open); ends any drag. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.dragging = false
  }

  /** Orients the camera from the current yaw/pitch about its position. */
  applyTo(camera: THREE.PerspectiveCamera): void {
    const cp = Math.cos(this.pitch)
    this.scratch.set(
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp,
    )
    camera.lookAt(
      camera.position.x + this.scratch.x,
      camera.position.y + this.scratch.y,
      camera.position.z + this.scratch.z,
    )
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return
    this.dragging = true
    this.lastX = e.clientX
    this.lastY = e.clientY
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.yaw -= dx * this.sensitivity
    this.pitch -= dy * this.sensitivity
    this.pitch = Math.max(-this.maxPitch, Math.min(this.maxPitch, this.pitch))
  }

  private readonly onPointerUp = (): void => {
    this.dragging = false
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
  }
}
