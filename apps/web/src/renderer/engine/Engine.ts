import * as THREE from 'three'
import type { LoadedRoom } from '../../domain/loadRoomSpec'
import { Disposables, disposeObject } from './disposables'
import { buildShell } from './builders/shell'
import type { WallSide } from './builders/shell'
import { buildLighting } from './builders/lighting'
import { buildObjects } from './builders'
import { MovementControls } from './controls/movement'
import type { Bounds } from './controls/movement'
import { IsometricCameraController } from './camera/IsometricCameraController'
import type { CameraController } from './camera/CameraController'
import { isometricOffsetDirection } from './camera/isometric'
import { buildPlayerMarker } from './playerMarker'
import type { Logger } from '../../platform/logger/Logger'
import { buildInteractables, type Interactable } from '../../domain/ports/interaction'

export type SetRoomOptions = {
  resolvedObjectIds?: ReadonlySet<string>
}

/**
 * Owns the Three.js renderer, scene, camera, and render loop. Pure Three.js
 * with no React dependency so the React layer stays a thin host.
 *
 * View model: a `player` object on the floor is what movement drives and
 * proximity reads; the camera is a separate `CameraController` that follows the
 * player from a fixed isometric angle. The two are decoupled — input never moves
 * the camera directly. (`lookControls.ts` stays for a future free-camera mode but
 * is not wired here.)
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
  private readonly logger: Logger
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly cameraController: CameraController
  private readonly player: THREE.Object3D
  private readonly disposables = new Disposables()
  private readonly resizeObserver: ResizeObserver
  private readonly clock = new THREE.Clock()
  private rafId = 0
  private room: LoadedRoom | null = null
  private movement: MovementControls | null = null
  private bounds: Bounds | null = null
  private readonly interactables: Interactable[] = []
  private activeInteractable: Interactable | null = null
  private readonly interactRange = 2.5 // meters (XZ) to register as "in range"
  private locked = false // true while a dialogue panel owns input

  /** Fired when the nearest in-range interactable changes (drives the HUD). */
  onActiveInteractionChange: ((active: Interactable | null) => void) | null = null
  /** Fired when the player presses the matching key to open an interaction. */
  onRequestOpenInteraction: ((target: Interactable) => void) | null = null

  constructor(container: HTMLElement, logger: Logger) {
    this.container = container
    this.logger = logger

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x14121a, 1)
    // Soft shadows from the renderer-internal key light give the isometric scene
    // depth/form. The shadow map dies with this engine's WebGL context on dispose.
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    // Lighting comes from the RoomSpec; added in setRoom() once we have a room.

    // The camera follows the player from a fixed isometric angle; both exist
    // before any room loads so the first frame is already well-framed.
    this.cameraController = new IsometricCameraController()
    this.player = buildPlayerMarker()
    this.scene.add(this.player)

    this.resizeObserver = new ResizeObserver(this.handleResize)
    this.resizeObserver.observe(container)
    this.handleResize()

    this.rafId = requestAnimationFrame(this.renderLoop)
  }

  /** Receives the validated room, builds the shell, and places the player. */
  setRoom(room: LoadedRoom, options: SetRoomOptions = {}): void {
    this.room = room
    this.scene.add(buildLighting(room.lighting, room.shell.dimensions))
    this.scene.add(buildShell(room, { cutawaySides: this.cutawaySides() }))
    this.scene.add(buildObjects(room, this.logger, options.resolvedObjectIds))
    this.placePlayer(room.spawn)

    const { width, depth } = room.shell.dimensions
    const margin = room.shell.wallThickness / 2 + 0.3 // keep off the walls
    this.bounds = {
      minX: -(width / 2 - margin),
      maxX: width / 2 - margin,
      minZ: -(depth / 2 - margin),
      maxZ: depth / 2 - margin,
    }
    this.movement = new MovementControls()

    this.interactables.push(...buildInteractables(room, options.resolvedObjectIds))
    window.addEventListener('keydown', this.onInteractKey)

    this.logger.info('room received', {
      roomId: room.id,
      objectCount: room.objects.length,
      warningCount: room.warnings.length,
    })
  }

  /**
   * Places the player marker at the spawn point on the floor and snaps the
   * camera to frame it. yaw is in degrees: the marker faces (sin yaw, 0, cos yaw),
   * so yaw=0 faces south (+Z) and yaw=180 faces north (-Z). The marker's height is
   * its own (base on the floor); the spawn Y (an eye height) is not used here.
   */
  private placePlayer(spawn: LoadedRoom['spawn']): void {
    const [x, , z] = spawn.position
    this.player.position.set(x, 0, z)
    this.player.rotation.y = THREE.MathUtils.degToRad(spawn.yaw)
    this.cameraController.follow(this.player.position)
  }

  /**
   * The walls between the camera and the room interior, derived from the camera's
   * own target→camera offset: the camera sits toward +X/+Z, so the east and south
   * walls are nearest and get cut to a curb (the dollhouse open side). Derived
   * rather than hardcoded so it stays correct if the isometric angle changes.
   */
  private cutawaySides(): WallSide[] {
    const dir = isometricOffsetDirection() // unit vector from target toward camera
    const sides: WallSide[] = []
    if (dir.z > 0) sides.push('south')
    else if (dir.z < 0) sides.push('north')
    if (dir.x > 0) sides.push('east')
    else if (dir.x < 0) sides.push('west')
    return sides
  }

  /** The room currently held by the engine, consumed by later commits. */
  get currentRoom(): LoadedRoom | null {
    return this.room
  }

  private readonly handleResize = (): void => {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.cameraController.resize(w / h)
    this.renderer.setSize(w, h)
  }

  private readonly renderLoop = (): void => {
    this.rafId = requestAnimationFrame(this.renderLoop)
    const dt = Math.min(this.clock.getDelta(), 0.1) // cap to avoid post-idle jumps
    if (this.movement && this.bounds) {
      this.movement.update(this.player, dt, this.bounds)
    }
    this.cameraController.follow(this.player.position)
    this.updateProximity()
    this.renderer.render(this.scene, this.cameraController.camera)
  }

  /** Nearest interactable in range right now, or null. */
  get activeInteraction(): Interactable | null {
    return this.activeInteractable
  }

  /**
   * Locks/unlocks player input while a dialogue panel owns the screen. Movement
   * is disabled, and the matching key can't re-open a panel.
   */
  setInteractionLock(locked: boolean): void {
    this.locked = locked
    this.movement?.setEnabled(!locked)
  }

  /**
   * Each frame, pick the nearest interactable within range on the XZ plane.
   * Strict `<` so ties resolve to the first-listed object deterministically.
   * Notifies the UI only when the active interactable changes.
   */
  private updateProximity(): void {
    const { x, z } = this.player.position
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
    this.movement = null
    this.bounds = null
    this.interactables.length = 0
    this.activeInteractable = null
    this.locked = false
    this.onActiveInteractionChange = null
    this.onRequestOpenInteraction = null

    disposeObject(this.scene) // frees the player marker's geometry/materials too
    this.scene.clear()
    this.disposables.dispose()
    this.cameraController.dispose()

    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.parentNode?.removeChild(this.renderer.domElement)

    this.room = null
  }
}
