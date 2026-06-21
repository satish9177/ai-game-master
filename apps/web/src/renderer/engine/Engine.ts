import * as THREE from 'three'
import type { LoadedRoom } from '../../roomspec/schema'
import { Disposables, disposeObject } from './disposables'
import { buildShell } from './builders/shell'
import { MovementControls } from './controls/movement'
import type { Bounds } from './controls/movement'
import { LookControls } from './controls/lookControls'

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

  constructor(container: HTMLElement) {
    this.container = container

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x14121a, 1)
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8))

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
    this.scene.add(buildShell(room))
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
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.resizeObserver.disconnect()
    this.movement?.dispose()
    this.look?.dispose()
    this.movement = null
    this.look = null
    this.bounds = null

    disposeObject(this.scene)
    this.scene.clear()
    this.disposables.dispose()

    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.parentNode?.removeChild(this.renderer.domElement)

    this.room = null
  }
}
