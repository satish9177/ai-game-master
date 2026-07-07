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
import { deriveRoomVisualTheme } from '../../domain/roomVisualTheme'
import { IdleAnimator, idlePhase } from './animation/idleAnimation'
import { IDLE_INTENSITY_BY_STATE } from '../../domain/ports/npcBehavior'
import { NpcBehaviorTracker } from './npc/behaviorTracker'
import { WanderMotor } from './npc/WanderMotor'
import { NpcAwarenessTracker } from './npc/awarenessTracker'
import type { NpcAwarenessChange } from './npc/awarenessTracker'
import { detectNpcPlayerAwareness } from '../../domain/npcPlayerAwareness'
import { buildNpcWanderField } from '../../domain/npcMovementContract'
import { buildNpcPatrolRoute } from '../../domain/npcPatrolContract'
import { stableHash32 } from '../../domain/stableHash'

export type SetRoomOptions = {
  resolvedObjectIds?: ReadonlySet<string>
  /**
   * Internal fixture/test seam only (see ADR-0080). NOT user-facing: it is not
   * RoomSpec/schema/save-game data and is never wired through RoomViewer/App
   * composition. Real gameplay never sets this, so every real NPC stays on the
   * existing wander/idle path; only ids in this set may receive a generated
   * `policy: 'patrol'` route, and only when one validates.
   */
  patrolOptInNpcIds?: ReadonlySet<string>
  /**
   * Internal fixture/test seam only (see ADR-0084). NOT user-facing: it is not
   * RoomSpec/schema/save-game data and is never wired through RoomViewer/App
   * composition. Real gameplay never sets this, so every real NPC stays on the
   * existing wander/patrol/idle path; only ids in this set may chase, and only
   * while the existing same-room awareness tier is aware/alerted.
   */
  chaseOptInNpcIds?: ReadonlySet<string>
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
  private readonly idleAnimator = new IdleAnimator()
  private readonly npcBehavior = new NpcBehaviorTracker()
  private readonly wanderMotor = new WanderMotor()
  private readonly wanderNpcIds: string[] = []
  private readonly npcAwareness = new NpcAwarenessTracker()
  private readonly awarenessNodes = new Map<string, THREE.Object3D>()
  private activeInteractable: Interactable | null = null
  private readonly interactRange = 2.5 // meters (XZ) to register as "in range"
  private locked = false // true while a dialogue panel owns input

  /** Fired when the nearest in-range interactable changes (drives the HUD). */
  onActiveInteractionChange: ((active: Interactable | null) => void) | null = null
  /** Fired when the player presses the matching key to open an interaction. */
  onRequestOpenInteraction: ((target: Interactable) => void) | null = null
  /**
   * Fired when any same-room NPC's proximity tier transitions. Advisory only —
   * no consumer is wired in v0 (see ADR-0083); movement/dialogue/relationships
   * are unaffected regardless of whether a listener is attached.
   */
  onNpcAwarenessChange: ((changes: readonly NpcAwarenessChange[]) => void) | null = null

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
    this.npcBehavior.clear()
    this.wanderMotor.clear()
    this.wanderNpcIds.length = 0
    this.npcAwareness.clear()
    this.awarenessNodes.clear()
    this.room = room
    const visualTheme = deriveRoomVisualTheme(room)
    this.scene.add(buildLighting(room.lighting, room.shell.dimensions, visualTheme))
    this.scene.add(buildShell(room, { cutawaySides: this.cutawaySides(), visualTheme }))
    const objects = buildObjects(room, this.logger, options.resolvedObjectIds, visualTheme)
    this.scene.add(objects)
    registerIdleNpcs(this.idleAnimator, this.npcBehavior, room, objects)
    registerAwarenessNodes(this.awarenessNodes, objects)
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
    this.wanderNpcIds.push(...registerWanderNpcs(
      this.wanderMotor,
      room,
      objects,
      this.interactables,
      options.patrolOptInNpcIds,
      options.chaseOptInNpcIds,
    ))
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
    this.updateNpcWander(dt)
    this.updateAwareness()
    this.idleAnimator.update(dt)
    this.cameraController.follow(this.player.position)
    this.updateProximity()
    this.renderer.render(this.scene, this.cameraController.camera)
  }

  private updateNpcWander(dt: number): void {
    const playerPosition = { x: this.player.position.x, z: this.player.position.z }
    this.wanderMotor.update(dt, {
      interactionLocked: this.locked,
      isNpcTalking: (npcId) => this.npcBehavior.stateOf(npcId) === 'talking',
      playerPosition,
      isChaseActive: (npcId) => {
        const level = this.npcAwareness.levelOf(npcId)
        return level === 'aware' || level === 'alerted'
      },
    })

    for (const npcId of this.wanderNpcIds) {
      this.npcBehavior.setWandering(npcId, this.wanderMotor.isWalking(npcId))
    }
  }

  /**
   * Reads the current player/NPC XZ positions and feeds them through the pure
   * same-room detector into the ephemeral tracker. Read-only advisory output:
   * it stores a tier per NPC and optionally notifies listeners, and does
   * nothing else. Covers every same-room NPC node (moving and static), not
   * only `WanderMotor` entries (see ADR-0083).
   */
  private updateAwareness(): void {
    const { x, z } = this.player.position
    const changes: NpcAwarenessChange[] = []

    for (const [npcId, node] of this.awarenessNodes) {
      const result = detectNpcPlayerAwareness({
        npcId,
        npcPosition: { x: node.position.x, z: node.position.z },
        playerPosition: { x, z },
        sameRoom: true,
      })
      const change = this.npcAwareness.update(result)
      if (change !== null) changes.push(change)
    }

    if (changes.length > 0) {
      this.onNpcAwarenessChange?.(changes)
    }
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

  /** Presentation-only NPC dialogue state; does not affect gameplay truth. */
  setTalkingNpc(npcId: string | null): void {
    this.npcBehavior.setTalking(npcId)
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
    this.idleAnimator.clear()
    this.npcBehavior.clear()
    this.wanderMotor.clear()
    this.wanderNpcIds.length = 0
    this.npcAwareness.clear()
    this.awarenessNodes.clear()
    this.activeInteractable = null
    this.locked = false
    this.onActiveInteractionChange = null
    this.onRequestOpenInteraction = null
    this.onNpcAwarenessChange = null

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

/**
 * Registers each top-level NPC node — tagged `userData.objectType === 'npc'`
 * by the builder registry — with the idle animator. Rings, helper nodes, and
 * mystery markers are untagged and skipped. `clear()` runs first so a room
 * replacement never retains a stale node from the previous room.
 *
 * Fallback key: prefers `userData.objectId` (the source object id). When
 * absent, indexes into only the *tagged* top-level nodes, which line up 1:1
 * with `room.objects` order (rings/markers interleave in `group.children`
 * but carry no tag), so the fallback stays deterministic across reloads.
 */
function registerIdleNpcs(
  idleAnimator: IdleAnimator,
  behavior: NpcBehaviorTracker,
  room: LoadedRoom,
  group: THREE.Group,
): void {
  idleAnimator.clear()
  const objectNodes = group.children.filter((node) => node.userData.objectType !== undefined)
  objectNodes.forEach((node, index) => {
    if (node.userData.objectType !== 'npc') return
    const objectId = node.userData.objectId as string | undefined
    const key = objectId ?? `npc#${index}`
    idleAnimator.register({
      node,
      phase: idlePhase(room.id, key),
      baseY: node.position.y,
      baseRotY: node.rotation.y,
      intensity: () => IDLE_INTENSITY_BY_STATE[behavior.stateOf(key)],
    })
  })
}

/**
 * Retains an `npcId -> node` entry for every top-level NPC-tagged node in the
 * room, moving and static alike (mirrors `registerIdleNpcs`'s node
 * identification exactly, including the same `npc#index` fallback key for an
 * id-less NPC, so the two registries agree on identity). `clear()` runs first
 * so a room replacement never retains a stale node from the previous room.
 */
function registerAwarenessNodes(
  nodes: Map<string, THREE.Object3D>,
  group: THREE.Group,
): void {
  nodes.clear()
  const objectNodes = group.children.filter((node) => node.userData.objectType !== undefined)
  objectNodes.forEach((node, index) => {
    if (node.userData.objectType !== 'npc') return
    const objectId = node.userData.objectId as string | undefined
    const key = objectId ?? `npc#${index}`
    nodes.set(key, node)
  })
}

function registerWanderNpcs(
  wanderMotor: WanderMotor,
  room: LoadedRoom,
  group: THREE.Group,
  interactables: readonly Interactable[],
  patrolOptInNpcIds?: ReadonlySet<string>,
  chaseOptInNpcIds?: ReadonlySet<string>,
): string[] {
  const npcIds: string[] = []

  for (const node of group.children) {
    if (node.userData.objectType !== 'npc') continue
    const objectId = node.userData.objectId as string | undefined
    if (objectId === undefined) continue

    const field = buildNpcWanderField(room, objectId)
    if (field === null) continue

    const ring = group.children.find((candidate) => candidate.userData.forObjectId === objectId)
    const interactable = interactables.find((candidate) => candidate.id === objectId)
    const seed = `${room.id}:${objectId}`
    const base = {
      npcId: objectId,
      node,
      field,
      seed,
      chaseEligible: chaseOptInNpcIds?.has(objectId) === true,
      ...(ring !== undefined ? { ring } : {}),
      ...(interactable !== undefined ? { interactable } : {}),
    }

    const route = patrolOptInNpcIds?.has(objectId) === true
      ? buildNpcPatrolRoute(field, stableHash32(seed))
      : null

    wanderMotor.register(
      route !== null
        ? { ...base, policy: 'patrol', route }
        : { ...base, home: field.home },
    )
    npcIds.push(objectId)
  }

  return npcIds
}
