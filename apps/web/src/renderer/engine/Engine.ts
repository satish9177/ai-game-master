import * as THREE from 'three'
import type { LoadedRoom } from '../../roomspec/schema'
import { Disposables, disposeObject } from './disposables'
import { buildShell } from './builders/shell'
import { buildLighting } from './builders/lighting'
import { buildObjects } from './builders'
import { MovementControls } from './controls/movement'
import type { Bounds } from './controls/movement'
import { LookControls } from './controls/lookControls'

/** A nearby thing the player can interact with (sourced from RoomSpec). */
export type Interactable = {
  type: string
  label: string
  key: 'E' | 'F'
  prompt: string
  title?: string
  body?: string
  position: THREE.Vector3
}

/**
 * Owns the Three.js renderer, scene, camera, and render loop. Pure Three.js
 * with no React dependency so the React layer stays a thin host.
 *
 * Lifecycle contract: construct once with a container element, then call
 * dispose() exactly once. dispose() is total (RAF, listeners, GPU resources,
 * WebGL context, canvas) so repeated mount/unmount — including React
 * StrictMode's dev double-mount — never leaks a canvas or WebGL context.
 *
 * Conventions: Y-up, meters, -Z = north.
 */
export class Engine {
  private readonly container: HTMLElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly disposables = new Disposables()
  private readonly resizeObserver: ResizeObserver
  private readonly clock = new THREE.Clock()
  private rafId = 0
  private room: LoadedRoom | null = null
  private movement: MovementControls | null = null
  private look: LookControls | null = null
  private bounds: Bounds | null = null
  private readonly interactables: Interactable[] = []
  private activeInteractable: Interactable | null = null
  private readonly interactRange = 2.5 // meters (XZ) to register as "in range"
  private locked = false // true while a dialogue panel owns input

  /** Fired when the nearest in-range interactable changes (drives the HUD). */
  onActiveInteractionChange: ((active: Interactable | null) => void) | null = null
  /** Fired when the player presses the matching key to open an interaction. */
  onRequestOpenInteraction: ((target: Interactable) => void) | null = null

  constructor(container: HTMLElement) {
    this.container = container

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x14121a, 1)
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    // Lighting comes from the RoomSpec; added in setRoom() once we have a room.

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
    this.camera.position.set(0, 1.7, 8)
    this.camera.lookAt(0, 1.7, 0)

    this.resizeObserver = new ResizeObserver(this.handleResize)
    this.resizeObserver.observe(container)
    this.handleResize()

    this.rafId = requestAnimationFrame(this.renderLoop)
  }

  /** Receives the validated room, builds the shell, and places the camera. */
  setRoom(room: LoadedRoom): void {
    this.room = room
    this.scene.add(buildLighting(room.lighting))
    this.scene.add(buildShell(room))
    this.scene.add(buildObjects(room))
    this.placeCamera(room.spawn)

    const { width, depth } = room.shell.dimensions
    const margin = room.shell.wallThickness / 2 + 0.3 // keep off the walls
    this.bounds = {
      minX: -(width / 2 - margin),
      maxX: width / 2 - margin,
      minZ: -(depth / 2 - margin),
      maxZ: depth / 2 - margin,
    }
    this.movement = new MovementControls()
    this.look = new LookControls(
      this.renderer.domElement,
      THREE.MathUtils.degToRad(room.spawn.yaw),
    )

    // Collect interactables (objects carrying an `interaction`) for proximity.
    for (const o of room.objects) {
      if (!('interaction' in o)) continue
      this.interactables.push({
        type: o.type,
        label: 'name' in o ? o.name : o.type,
        key: o.interaction.key,
        prompt: o.interaction.prompt,
        title: o.interaction.title,
        body: o.interaction.body,
        position: new THREE.Vector3(o.position[0], o.position[1], o.position[2]),
      })
    }
    window.addEventListener('keydown', this.onInteractKey)

    // eslint-disable-next-line no-console -- TODO(logger): route via Logger adapter (ADR-0003)
    console.info(
      `[Engine] room received: "${room.name}" (${room.objects.length} objects, ${room.warnings.length} warnings)`,
    )
  }

  /**
   * Positions the camera at the spawn point. yaw is in degrees: the forward
   * direction is (sin yaw, 0, cos yaw), so yaw=0 faces south (+Z) and yaw=180
   * faces north (-Z).
   */
  private placeCamera(spawn: LoadedRoom['spawn']): void {
    const [x, y, z] = spawn.position
    const yawRad = THREE.MathUtils.degToRad(spawn.yaw)
    this.camera.position.set(x, y, z)
    this.camera.lookAt(x + Math.sin(yawRad), y, z + Math.cos(yawRad))
  }

  /** The room currently held by the engine, consumed by later commits. */
  get currentRoom(): LoadedRoom | null {
    return this.room
  }

  private readonly handleResize = (): void => {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  private readonly renderLoop = (): void => {
    this.rafId = requestAnimationFrame(this.renderLoop)
    const dt = Math.min(this.clock.getDelta(), 0.1) // cap to avoid post-idle jumps
    if (this.movement && this.look && this.bounds) {
      this.movement.update(this.camera, this.look.yawAngle, dt, this.bounds)
      this.look.applyTo(this.camera)
    }
    this.updateProximity()
    this.renderer.render(this.scene, this.camera)
  }

  /** Nearest interactable in range right now, or null. */
  get activeInteraction(): Interactable | null {
    return this.activeInteractable
  }

  /**
   * Locks/unlocks player input while a dialogue panel owns the screen. Movement
   * and drag-look are disabled, and the matching key can't re-open a panel.
   */
  setInteractionLock(locked: boolean): void {
    this.locked = locked
    this.movement?.setEnabled(!locked)
    this.look?.setEnabled(!locked)
  }

  /**
   * Each frame, pick the nearest interactable within range on the XZ plane.
   * Strict `<` so ties resolve to the first-listed object deterministically.
   * Notifies the UI only when the active interactable changes.
   */
  private updateProximity(): void {
    const { x, z } = this.camera.position
    let nearest: Interactable | null = null
    let best = this.interactRange
    for (const it of this.interactables) {
      const d = Math.hypot(x - it.position.x, z - it.position.z)
      if (d < best) {
        best = d
        nearest = it
      }
    }
    if (nearest !== this.activeInteractable) {
      this.activeInteractable = nearest
      this.onActiveInteractionChange?.(nearest)
    }
  }

  private readonly onInteractKey = (e: KeyboardEvent): void => {
    if (this.locked) return // a panel is open; ignore until it closes
    if (e.code !== 'KeyE' && e.code !== 'KeyF') return
    const active = this.activeInteractable
    if (!active) return
    const key = e.code === 'KeyE' ? 'E' : 'F'
    if (active.key !== key) return // wrong key for this interactable
    this.onRequestOpenInteraction?.(active)
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.resizeObserver.disconnect()
    window.removeEventListener('keydown', this.onInteractKey)
    this.movement?.dispose()
    this.look?.dispose()
    this.movement = null
    this.look = null
    this.bounds = null
    this.interactables.length = 0
    this.activeInteractable = null
    this.locked = false
    this.onActiveInteractionChange = null
    this.onRequestOpenInteraction = null

    disposeObject(this.scene)
    this.scene.clear()
    this.disposables.dispose()

    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.parentNode?.removeChild(this.renderer.domElement)

    this.room = null
  }
}
