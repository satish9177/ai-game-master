import * as THREE from 'three'
import type { LoadedRoom } from '../../roomspec/schema'
import { Disposables, disposeObject } from './disposables'

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
  private rafId = 0
  private room: LoadedRoom | null = null

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

  /** Receives the validated room. Geometry is built in a later commit. */
  setRoom(room: LoadedRoom): void {
    this.room = room
    console.info(
      `[Engine] room received: "${room.name}" (${room.objects.length} objects, ${room.warnings.length} warnings)`,
    )
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
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.resizeObserver.disconnect()

    disposeObject(this.scene)
    this.scene.clear()
    this.disposables.dispose()

    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.parentNode?.removeChild(this.renderer.domElement)

    this.room = null
  }
}
