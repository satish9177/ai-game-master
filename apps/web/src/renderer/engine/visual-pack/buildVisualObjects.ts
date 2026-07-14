import * as THREE from 'three'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import type { RoomObject } from '../../../domain/roomSpec'
import {
  projectObjectPresentationState,
  type ObjectPresentationStateMap,
} from '../../../domain/visuals/objectPresentationState'
import type { ObjectPresentationState } from '../../../domain/visuals/contracts'
import {
  affordanceForInteractableObject,
  type Affordance,
} from '../../../domain/ports/interaction'
import { isReturnExitObject } from '../../../domain/generatedReturnExit'
import { buildGroundRing } from '../builders/indicators'
import { disposeObject } from '../disposables'
import { canReachWithinBounds, CollisionWorld2D, findNearestFreePoint, type StaticCollider2D, type WalkableBounds2D } from '../controls/CollisionWorld2D'
import type {
  HumanoidCharacterFactory,
  HumanoidCharacterInstance,
} from '../characters/HumanoidCharacterFactory'
import type { Logger } from '../../../platform/logger/Logger'
import { VisualAssetLoadError, type VisualAssetLease } from './VisualAssetCache'
import type {
  VisualFamilyId,
  VisualPackRegistry,
  VisualResolution,
  VisualResolutionRequest,
} from './contracts'
import {
  BALANCED_RENDER_BUDGET,
  planRenderBudget,
  type RenderBudget,
  type RenderBudgetCandidate,
  type RenderBudgetPlan,
  type RenderPlanItem,
  type TextureSetByteCatalog,
} from './renderBudget'
import { resolveVisualAssetCandidates } from './resolveVisualAsset'
import { ruinedKingdomPack } from './ruinedKingdomPack'

const DEFAULT_TEXTURE_SET_BYTES: TextureSetByteCatalog = {
  'rks-shared-atlas': 16 * 1024 * 1024,
}

const INTERACTION_RING_COLOR: Record<Affordance, string> = {
  inspect: '#f4c96b',
  talk: '#77d6a8',
  exit: '#7cc8d8',
  approach: '#d98262',
  take: '#e8cf6a',
  use: '#a993d6',
}

export type VisualAssetProvider = Readonly<{
  acquire: (assetId: string) => Promise<VisualAssetLease>
}>

export type BuildVisualObjectsOptions = Readonly<{
  assets: VisualAssetProvider
  registry?: VisualPackRegistry
  presentationStates?: ObjectPresentationStateMap
  characterFactory?: HumanoidCharacterFactory
  renderBudget?: RenderBudget
  textureSetBytes?: TextureSetByteCatalog
  allowDebug?: boolean
  /** Optional bounded fallback diagnostics only; never affects control flow. */
  logger?: Logger
}>

export type BuiltVisualObjects = Readonly<{
  group: THREE.Group
  renderPlan: RenderBudgetPlan
  collisionWorld: CollisionWorld2D
  characters: ReadonlyMap<string, HumanoidCharacterInstance>
  dispose: () => void
  reachability: RoomReachability
  updateCollisionPresentationStates?: (states: ObjectPresentationStateMap) => void
}>

export type RoomReachability = Readonly<{
  targetCount: number
  reachableTargetCount: number
  repairedColliderCount: number
  spawnRepaired: boolean
  /** Record keys whose collider reachability-repair removed; never re-added by live updates. */
  repairedColliderKeys: ReadonlySet<string>
}>
export class VisualPackUnavailableError extends Error {
  readonly code = 'visual-pack-unavailable'

  constructor() {
    super('The visual pack is unavailable.')
    this.name = 'VisualPackUnavailableError'
  }
}

type ObjectRecord = Readonly<{
  object: RoomObject
  index: number
  key: string
  state: ObjectPresentationState
  request: VisualResolutionRequest
  candidates: readonly VisualResolution[]
}>

/**
 * Trusted visual-pack scene construction. Every RoomSpec selector has already
 * passed Zod; this layer can resolve only registry-owned descriptors and URLs.
 */
export async function buildVisualObjects(
  room: LoadedRoom,
  options: BuildVisualObjectsOptions,
): Promise<BuiltVisualObjects> {
  const registry = options.registry ?? ruinedKingdomPack
  const presentationStates = options.presentationStates ?? new Map()
  const records = room.objects.map((object, index) => {
    const key = object.id ?? object.type + '#' + index
    const state = object.id === undefined
      ? projectObjectPresentationState(object)
      : presentationStates.get(object.id) ?? projectObjectPresentationState(object)
    const request = visualRequestForObject(object, room.environmentKind, state)
    return {
      object,
      index,
      key,
      state,
      request,
      candidates: resolveVisualAssetCandidates(registry, request),
    }
  })

  const budgetCandidates = records.map((record) => toBudgetCandidate(record, registry, room))
  const renderPlan = planRenderBudget(
    budgetCandidates,
    options.textureSetBytes ?? DEFAULT_TEXTURE_SET_BYTES,
    options.renderBudget ?? BALANCED_RENDER_BUDGET,
  )
  const planById = new Map(renderPlan.items.map((item) => [item.id, item]))
  const group = new THREE.Group()
  group.name = 'visual-pack-objects'
  const leases: VisualAssetLease[] = []
  const reusableLeases = new Map<string, VisualAssetLease>()
  const characters = new Map<string, HumanoidCharacterInstance>()
  const failedAssetIds = new Set<string>()
  const failedAssetCodes = new Map<string, string>()
  const loggedFallbackAssetIds = new Set<string>()
  const batches = new Map<string, InstancedBatch>()
  let disposed = false

  try {
    for (const record of records) {
      const planItem = planById.get(record.key)
      if (!planItem) throw new VisualPackUnavailableError()

      const character = await tryBuildCharacter(record, room, planItem, options.characterFactory)
      if (character) {
        tagVisualNode(character.root, record)
        applyObjectPresentationStateToNode(character.root, record.state)
        applyObjectTransform(character.root, record.object)
        character.animations.setSuspended(planItem.animationSuspended)
        group.add(character.root)
        characters.set(record.key, character)
        addInteractionIndicator(group, record)
        continue
      }

      const orderedAssetIds = assetLoadOrder(record, planItem, registry)
      let lease: VisualAssetLease | null = null
      for (const assetId of orderedAssetIds) {
        if (failedAssetIds.has(assetId)) continue
        try {
          const reusable = registry.assets[assetId]?.instancing === 'allowed'
          const prototype = reusable ? reusableLeases.get(assetId) : undefined
          if (prototype) {
            lease = cloneReusableLease(prototype)
          } else {
            const acquired = await options.assets.acquire(assetId)
            leases.push(acquired)
            if (reusable) {
              reusableLeases.set(assetId, acquired)
              lease = cloneReusableLease(acquired)
            } else {
              lease = acquired
            }
          }
          break
        } catch (error) {
          failedAssetIds.add(assetId)
          failedAssetCodes.set(assetId, error instanceof VisualAssetLoadError ? error.code : 'unknown')
        }
      }

      const preferredAssetId = orderedAssetIds[0]
      if (
        lease
        && preferredAssetId !== undefined
        && lease.assetId !== preferredAssetId
        && failedAssetCodes.has(preferredAssetId)
        && !loggedFallbackAssetIds.has(preferredAssetId)
      ) {
        loggedFallbackAssetIds.add(preferredAssetId)
        options.logger?.warn('visual pack asset fallback', {
          code: failedAssetCodes.get(preferredAssetId),
          assetId: preferredAssetId,
          resolution: planItem.resolution,
        })
      }

      if (!lease) {
        if (options.allowDebug !== true) throw new VisualPackUnavailableError()
        const debug = buildDevelopmentDebugVisual()
        tagVisualNode(debug, record)
        applyObjectTransform(debug, record.object)
        group.add(debug)
        addInteractionIndicator(group, record)
        continue
      }

      tagVisualNode(lease.instance, record)
      applyObjectPresentationStateToNode(lease.instance, record.state)
      applyObjectTransform(lease.instance, record.object)
      applyResourcePlan(lease.instance, planItem)
      addTrustedLocalLight(lease.instance, record.object, planItem)

      if (canInstance(record, lease, planItem)) {
        addToBatches(batches, lease, record, planItem)
      } else {
        group.add(lease.instance)
      }
      addInteractionIndicator(group, record)
    }

    for (const batch of batches.values()) group.add(buildInstancedMesh(batch))
  } catch (error) {
    for (const character of characters.values()) character.dispose()
    for (const lease of leases) lease.release()
    disposeObject(group)
    group.clear()
    throw error
  }

  const collisionWorld = buildCollisionWorld(
    records,
    options.renderBudget?.staticCollisionBodies
      ?? BALANCED_RENDER_BUDGET.staticCollisionBodies,
  )

  const reachability = repairRoomReachability(room, records, collisionWorld)
  return {
    group,
    renderPlan,
    collisionWorld,
    reachability,
    updateCollisionPresentationStates: (states) => updateCollisionPresentationStates(
      records, collisionWorld, states, reachability.repairedColliderKeys,
    ),
    characters,
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const character of characters.values()) character.dispose()
      for (const lease of leases) lease.release()
      characters.clear()
      disposeObject(group)
      group.clear()
    },
  }
}

function cloneReusableLease(prototype: VisualAssetLease): VisualAssetLease {
  return {
    assetId: prototype.assetId,
    descriptor: prototype.descriptor,
    instance: prototype.instance.clone(true),
    animations: prototype.animations,
    release: () => {},
  }
}

export function visualRequestForObject(
  object: RoomObject,
  environmentKind: LoadedRoom['environmentKind'],
  state: ObjectPresentationState = projectObjectPresentationState(object),
): VisualResolutionRequest {
  const resolved = semanticIdentity(object)
  return {
    semanticKey: resolved.semanticKey,
    family: resolved.family,
    ...(environmentKind === undefined ? {} : { environmentKind }),
    condition: state.condition,
    interactionState: state.interactionState,
  }
}

function semanticIdentity(object: RoomObject): {
  semanticKey: string
  family: VisualFamilyId
} {
  switch (object.type) {
    case 'throne':
      return legacyIdentity(object, 'anchor')
    case 'pillar':
    case 'arch':
    case 'barricade':
      return object.type === 'barricade'
        ? { semanticKey: 'object.barricade.' + object.style, family: 'architecture' }
        : legacyIdentity(object, 'architecture')
    case 'rug':
    case 'table':
      return legacyIdentity(object, 'furniture')
    case 'torch':
    case 'candle':
      return legacyIdentity(object, 'lighting')
    case 'scroll':
    case 'book':
    case 'paper':
    case 'map':
      return legacyIdentity(object, 'document')
    case 'chest':
    case 'crate':
    case 'barrel':
      return legacyIdentity(object, 'container')
    case 'corpse':
    case 'debris':
      return legacyIdentity(object, 'clutter')
    case 'altar':
    case 'statue':
    case 'artifact':
      return legacyIdentity(object, 'anchor')
    case 'machine':
      return legacyIdentity(object, 'device')
    case 'npc':
      return {
        semanticKey: 'humanoid.' + (object.appearance?.preset ?? npcPreset(object.npcType)),
        family: 'humanoid',
      }
    case 'zombie':
      return {
        semanticKey: 'humanoid.' + (object.appearance?.preset ?? 'zombie'),
        family: 'humanoid',
      }
    case 'prop':
      return { semanticKey: 'object.prop.' + object.shape, family: 'clutter' }
    case 'architecture':
      return { semanticKey: 'architecture.' + object.kind, family: 'architecture' }
    case 'furniture':
      return { semanticKey: 'furniture.' + object.kind, family: 'furniture' }
    case 'clutter':
      return { semanticKey: 'clutter.' + object.kind, family: 'clutter' }
    case 'vegetation':
      return { semanticKey: 'vegetation.' + object.kind, family: 'vegetation' }
    case 'light-fixture':
      return { semanticKey: 'lighting.' + object.kind, family: 'lighting' }
    default:
      return assertNever(object)
  }
}

function legacyIdentity(
  object: RoomObject,
  family: VisualFamilyId,
): { semanticKey: string; family: VisualFamilyId } {
  const variant = 'variant' in object ? object.variant : undefined
  return {
    semanticKey: 'object.' + object.type + (variant ? '.' + variant : ''),
    family,
  }
}

function npcPreset(npcType: Extract<RoomObject, { type: 'npc' }>['npcType']): string {
  return npcType === undefined || npcType === 'static_npc' ? 'human-commoner' : npcType
}

function toBudgetCandidate(
  record: ObjectRecord,
  registry: VisualPackRegistry,
  room: LoadedRoom,
): RenderBudgetCandidate {
  const exact = record.candidates[0]
  if (!exact) throw new VisualPackUnavailableError()
  const lodCosts = exact.descriptor.lodAssetIds.flatMap((id) => {
    const descriptor = registry.assets[id]
    return descriptor ? [descriptor.cost] : []
  })
  const neutral = registry.assets[registry.neutralDefaults[record.request.family]]
  const [x, , z] = record.object.position
  const [spawnX, , spawnZ] = room.spawn.position
  const interactive = interactionFor(record.object) !== undefined
  const essential = interactionFor(record.object)?.exit !== undefined
    || record.request.family === 'humanoid'
    || record.request.family === 'anchor'

  return {
    id: record.key,
    priority: essential ? 'essential' : interactive ? 'interactive' : 'decorative',
    distanceSquared: ((x - spawnX) ** 2) + ((z - spawnZ) ** 2),
    exactCost: exact.descriptor.cost,
    ...(lodCosts.length === 0 ? {} : { lodCosts }),
    ...(record.request.family === 'humanoid' && registry.assets['humanoid.static-lod']
      ? { staticHumanoidCost: registry.assets['humanoid.static-lod']!.cost }
      : {}),
    ...(neutral === undefined || !isCheaperCost(neutral.cost, exact.descriptor.cost)
      ? {}
      : { productionFallbackCost: neutral.cost }),
    ...(!interactive && exact.descriptor.instancing === 'allowed'
      ? { instanceGroup: exact.assetId + ':' + record.state.condition + ':' + record.state.interactionState }
      : {}),
    canSuspendAnimation: record.request.family === 'humanoid',
    canUseEmissiveOnly: record.request.family === 'lighting',
    canDisableParticles: true,
    canUseOpaqueFallback: true,
    canDisableShadows: !essential,
  }
}

function isCheaperCost(candidate: VisualResolution['descriptor']['cost'], current: VisualResolution['descriptor']['cost']): boolean {
  return candidate.triangles < current.triangles
    || candidate.drawCalls < current.drawCalls
    || candidate.skinnedCharacters < current.skinnedCharacters
    || candidate.animationMixers < current.animationMixers
    || candidate.localLights < current.localLights
    || candidate.shadowLights < current.shadowLights
    || candidate.particleEmitters < current.particleEmitters
    || candidate.transparentDraws < current.transparentDraws
    || candidate.shadowCasters < current.shadowCasters
    || candidate.collisionBodies < current.collisionBodies
}

async function tryBuildCharacter(
  record: ObjectRecord,
  room: LoadedRoom,
  plan: RenderPlanItem,
  factory: HumanoidCharacterFactory | undefined,
): Promise<HumanoidCharacterInstance | null> {
  if (
    factory === undefined
    || (record.object.type !== 'npc' && record.object.type !== 'zombie')
    || plan.resolution === 'static-humanoid'
    || plan.resolution === 'production-fallback'
  ) {
    return null
  }

  try {
    return await factory.create({
      roomId: room.id,
      stableId: record.key,
      role: record.object.type === 'zombie' ? 'zombie' : 'npc',
      appearance: record.object.appearance,
      ...(record.object.type === 'npc' && record.object.npcType !== undefined
        ? { npcType: record.object.npcType }
        : {}),
    })
  } catch {
    return null
  }
}

function assetLoadOrder(
  record: ObjectRecord,
  plan: RenderPlanItem,
  registry: VisualPackRegistry,
): string[] {
  const preferred: string[] = []
  const exact = record.candidates[0]

  if (plan.resolution === 'production-fallback') {
    preferred.push(registry.neutralDefaults[record.request.family])
  } else if (plan.resolution === 'static-humanoid' && registry.assets['humanoid.static-lod']) {
    preferred.push('humanoid.static-lod')
  } else if (plan.resolution === 'lod' && exact) {
    const lodId = exact.descriptor.lodAssetIds[plan.lodIndex ?? 0]
    if (lodId) preferred.push(lodId)
  } else if (exact) {
    preferred.push(exact.assetId)
  }

  for (const candidate of record.candidates) preferred.push(candidate.assetId)
  return [...new Set(preferred)]
}

export function updateBuiltObjectPresentationStates(
  root: THREE.Object3D,
  states: ObjectPresentationStateMap,
): void {
  root.traverse((node) => {
    const objectId = node.userData.objectId as string | undefined
    if (objectId !== undefined) {
      const state = states.get(objectId)
      if (state) applyObjectPresentationStateToNode(node, state)
    }

    const indicatorId = node.userData.forObjectId as string | undefined
    if (indicatorId === undefined) return
    const indicatorState = states.get(indicatorId)
    if (!indicatorState) return
    const mesh = node as THREE.Mesh
    const material = mesh.material
    if (!(material instanceof THREE.MeshStandardMaterial)) return
    material.opacity = indicatorState.resolved ? 0.3 : 0.86
    material.emissiveIntensity = indicatorState.resolved ? 0.22 : 1.1
    material.needsUpdate = true
  })
}

function applyObjectPresentationStateToNode(
  root: THREE.Object3D,
  state: ObjectPresentationState,
): void {
  root.userData.visualCondition = state.condition
  root.userData.visualResolutionState = state.interactionState
  const opened = state.interactionState === 'open' || state.interactionState === 'looted'

  root.traverse((node) => {
    const separator = node.name.lastIndexOf(':')
    const partName = separator === -1 ? node.name : node.name.slice(separator + 1)

    switch (partName) {
      case 'state-lid':
        node.rotation.x = opened ? -1.15 : 0
        break
      case 'state-door':
        node.rotation.y = opened ? -1.25 : 0
        break
      case 'state-lock':
        node.visible = state.interactionState === 'locked'
        break
      case 'state-contents':
        node.visible = state.interactionState === 'open'
        break
      case 'state-looted':
        node.visible = state.interactionState === 'looted'
        break
      case 'state-read':
        node.visible = state.interactionState === 'read'
        break
      case 'state-activated':
        node.visible = state.interactionState === 'activated'
        break
      case 'condition-weathered':
      case 'condition-damaged':
      case 'condition-burned':
      case 'condition-overgrown':
        node.visible = partName === 'condition-' + state.condition
        break
    }
  })
}

function applyObjectTransform(node: THREE.Object3D, object: RoomObject): void {
  const [x, y, z] = object.position
  node.position.set(x, y, z)
  node.rotation.y = THREE.MathUtils.degToRad(object.rotationY)
  if (
    object.type === 'architecture'
    || object.type === 'furniture'
    || object.type === 'clutter'
    || object.type === 'vegetation'
    || object.type === 'light-fixture'
  ) {
    node.scale.set(
      object.size[0] * object.scale,
      object.size[1] * object.scale,
      object.size[2] * object.scale,
    )
  } else {
    node.scale.setScalar(object.scale)
  }
}

function tagVisualNode(node: THREE.Object3D, record: ObjectRecord): void {
  node.userData.objectType = record.object.type
  node.userData.visualSemanticKey = record.request.semanticKey
  node.userData.visualResolutionState = record.state.interactionState
  if (record.object.id !== undefined) node.userData.objectId = record.object.id
}

function addTrustedLocalLight(
  root: THREE.Object3D,
  object: RoomObject,
  plan: RenderPlanItem,
): void {
  if (plan.emissiveOnly) return
  const lightSpec = object.type === 'torch' || object.type === 'light-fixture'
    ? object.light
    : undefined
  if (lightSpec === undefined || lightSpec.intensity <= 0 || lightSpec.distance <= 0) return

  const light = new THREE.PointLight(
    lightSpec.color,
    lightSpec.intensity,
    lightSpec.distance,
    2,
  )
  light.name = 'visual-pack-local-light'
  light.position.y = object.type === 'torch' ? 0 : 0.45
  light.castShadow = false
  root.add(light)
}
function applyResourcePlan(root: THREE.Object3D, plan: RenderPlanItem): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.isMesh) {
      mesh.castShadow = !plan.shadowsDisabled
      mesh.receiveShadow = true
    }
    const light = node as THREE.Light
    if (light.isLight && plan.emissiveOnly) light.visible = false
    if (node.userData.particleEmitter === true && plan.particlesDisabled) node.visible = false
  })
}

type InstancedBatch = {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  matrices: THREE.Matrix4[]
  castShadow: boolean
  receiveShadow: boolean
  semanticKey: string
}

function canInstance(
  record: ObjectRecord,
  lease: VisualAssetLease,
  plan: RenderPlanItem,
): boolean {
  return plan.instanceGroup !== undefined
    && lease.descriptor.instancing === 'allowed'
    && interactionFor(record.object) === undefined
    && !containsNonInstancableNode(lease.instance)
    && !(record.object.type === 'architecture' && (record.object.kind === 'wall-straight' || record.object.kind === 'wall-ruined'))
}

function containsNonInstancableNode(root: THREE.Object3D): boolean {
  let invalid = false
  root.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh || (node as THREE.Light).isLight) invalid = true
  })
  return invalid
}

function addToBatches(
  batches: Map<string, InstancedBatch>,
  lease: VisualAssetLease,
  record: ObjectRecord,
  plan: RenderPlanItem,
): void {
  lease.instance.updateMatrixWorld(true)
  let meshIndex = 0
  lease.instance.traverseVisible((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const key = [
      plan.instanceGroup,
      meshIndex,
      mesh.geometry.uuid,
      mesh.material.uuid,
      mesh.castShadow ? 1 : 0,
    ].join('|')
    const batch = batches.get(key) ?? {
      geometry: mesh.geometry,
      material: mesh.material,
      matrices: [],
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      semanticKey: record.request.semanticKey,
    }
    batch.matrices.push(mesh.matrixWorld.clone())
    batches.set(key, batch)
    meshIndex += 1
  })
}

function buildInstancedMesh(batch: InstancedBatch): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length)
  batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
  mesh.instanceMatrix.needsUpdate = true
  mesh.castShadow = batch.castShadow
  mesh.receiveShadow = batch.receiveShadow
  mesh.name = 'visual-pack-instanced'
  mesh.userData.visualPackSharedResource = true
  mesh.userData.visualSemanticKey = batch.semanticKey
  return mesh
}

function addInteractionIndicator(group: THREE.Group, record: ObjectRecord): void {
  const affordance = affordanceForInteractableObject(record.object)
  if (!affordance) return
  const color = isReturnExitObject(record.object)
    ? '#d779b5'
    : INTERACTION_RING_COLOR[affordance]
  const ring = buildGroundRing({
    innerRadius: 0.62,
    outerRadius: 0.92,
    color,
    emissiveIntensity: record.state.resolved ? 0.22 : 1.1,
    opacity: record.state.resolved ? 0.3 : 0.86,
    floorY: 0.055,
    renderOrder: 12,
    toneMapped: false,
  })
  ring.name = 'interactable-indicator'
  ring.position.x = record.object.position[0]
  ring.position.z = record.object.position[2]
  if (record.object.id !== undefined) ring.userData.forObjectId = record.object.id
  group.add(ring)
}

function buildDevelopmentDebugVisual(): THREE.Object3D {
  const group = new THREE.Group()
  group.name = 'development-debug-visual'
  const material = new THREE.MeshBasicMaterial({ color: '#ff2fa8', wireframe: true })
  const outer = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), material)
  outer.position.y = 0.42
  group.add(outer)
  return group
}

function buildCollisionWorld(
  records: readonly ObjectRecord[],
  maximumBodies: number,
): CollisionWorld2D {
  const world = new CollisionWorld2D()
  const candidates = records
    .map((record) => ({
      record,
      descriptor: record.candidates[0]?.descriptor,
      priority: collisionPriority(record),
    }))
    .filter((entry) => entry.descriptor !== undefined
      && entry.descriptor.collision.kind !== 'none'
      && entry.descriptor.collision.blocksPlayer)
    .sort((a, b) => b.priority - a.priority || a.record.index - b.record.index)

  let bodyCount = 0
  for (const candidate of candidates) {
    const descriptor = candidate.descriptor
    if (!descriptor || descriptor.collision.kind === 'none') continue
    const colliders = collidersFor(candidate.record, descriptor.collision)
    if (bodyCount + colliders.length > maximumBodies) continue
    for (const collider of colliders) world.add(collider)
    bodyCount += colliders.length
  }
  return world
}

function collisionPriority(record: ObjectRecord): number {
  const interaction = interactionFor(record.object)
  if (interaction?.exit !== undefined) return 4
  if (interaction !== undefined) return 3
  if (record.request.family === 'architecture' || record.request.family === 'furniture') return 2
  return 1
}

function collidersFor(
  record: ObjectRecord,
  profile: Exclude<VisualResolution['descriptor']['collision'], { kind: 'none' }>,
): StaticCollider2D[] {
  const object = record.object
  const center = { x: object.position[0], z: object.position[2] }
  const rotationY = THREE.MathUtils.degToRad(object.rotationY)
  // objectFootprintScale reflects RoomSpec `size`/`radius` only for the object
  // kinds applyObjectTransform actually scales the mesh by (see there); every
  // other kind renders its fixed art footprint under `object.scale` alone, so
  // its collider must follow that same single scale factor, not a second,
  // render-invisible multiply by size/radius.
  const footprint = rendersWithSizeScale(object) ? objectFootprintScale(object) : UNIT_FOOTPRINT

  if (profile.kind === 'circle') {
    return [{
      id: record.key,
      kind: 'circle',
      center,
      radius: profile.radius * Math.max(footprint.x, footprint.z) * object.scale,
    }]
  }

  if (
    (object.type === 'arch' || (object.type === 'architecture' && object.kind === 'gate'))
    && record.state.interactionState !== 'locked'
    && record.state.interactionState !== 'closed'
  ) {
    const width = object.type === 'arch' ? object.width : object.size[0]
    const postHalfWidth = Math.max(0.12, width * 0.08) * object.scale
    const depth = (object.type === 'arch' ? 0.3 : object.size[2]) * object.scale
    return [-1, 1].map((direction) => {
      const localX = direction * (width * object.scale / 2)
      const x = center.x + (localX * Math.cos(rotationY))
      const z = center.z - (localX * Math.sin(rotationY))
      return {
        id: record.key + ':post:' + direction,
        kind: 'box' as const,
        center: { x, z },
        halfExtents: [postHalfWidth, depth / 2] as const,
        rotationY,
      }
    })
  }

  return [{
    id: record.key,
    kind: 'box',
    center,
    halfExtents: [
      profile.halfExtents[0] * footprint.x * object.scale,
      profile.halfExtents[1] * footprint.z * object.scale,
    ],
    rotationY,
  }]
}

const UNIT_FOOTPRINT = { x: 1, z: 1 }

/** Mirrors applyObjectTransform: only these kinds scale their mesh by `size`. */
function rendersWithSizeScale(object: RoomObject): boolean {
  return object.type === 'architecture'
    || object.type === 'furniture'
    || object.type === 'clutter'
    || object.type === 'vegetation'
    || object.type === 'light-fixture'
}

function objectFootprintScale(object: RoomObject): { x: number; z: number } {
  if ('size' in object) {
    if (object.size.length === 3) return { x: object.size[0], z: object.size[2] }
    return { x: object.size[0], z: object.size[1] }
  }
  if ('radius' in object) return { x: object.radius * 2, z: object.radius * 2 }
  return { x: 1, z: 1 }
}

function interactionFor(
  object: RoomObject,
): Extract<RoomObject, { interaction?: unknown }>['interaction'] | undefined {
  return 'interaction' in object ? object.interaction : undefined
}

function assertNever(value: never): never {
  throw new Error('unhandled RoomObject visual type: ' + String(value))
}

/**
 * Only gates/arches change collider geometry with interaction state (open vs.
 * closed/locked posts); every other kind's `collidersFor` output is state-
 * independent, so rebuilding it here is redundant churn at best.
 */
function isInteractionDependentCollider(object: RoomObject): boolean {
  return object.type === 'arch' || (object.type === 'architecture' && object.kind === 'gate')
}

function updateCollisionPresentationStates(
  records: readonly ObjectRecord[],
  world: CollisionWorld2D,
  states: ObjectPresentationStateMap,
  repairedColliderKeys: ReadonlySet<string>,
): void {
  for (const record of records) {
    if (record.object.id === undefined) continue
    if (repairedColliderKeys.has(record.key)) continue
    if (!isInteractionDependentCollider(record.object)) continue
    const state = states.get(record.object.id)
    if (!state) continue
    const profile = record.candidates[0]?.descriptor.collision
    if (!profile || profile.kind === 'none' || !profile.blocksPlayer) continue
    removeRecordColliders(world, record)
    for (const collider of collidersFor({ ...record, state }, profile)) world.add(collider)
  }
}

function removeRecordColliders(world: CollisionWorld2D, record: ObjectRecord): void {
  world.remove(record.key)
  world.remove(record.key + ':post:-1')
  world.remove(record.key + ':post:1')
}

const REACHABILITY_PLAYER_RADIUS = 0.32
const INTERACTION_REACHABILITY_RADIUS = 2.5
/**
 * Bounds every trial phase to a fixed, small search so repair cost never
 * scales with room object count: O(k) single trials, then O(k^2) pair
 * trials, each trial costing one bounded flood-fill.
 */
const MAX_REACHABILITY_TRIAL_CANDIDATES = 48
/**
 * Hard ceiling on flood-fill trial evaluations across both phases. Candidate
 * count alone bounds the *search shape* but not wall-clock cost: a single
 * flood-fill trial is itself O(room area), so a large room's pair phase can
 * still run long without this. Real rooms resolve in a handful of trials;
 * this only ever caps pathologically dense rooms short of full repair.
 */
const MAX_REACHABILITY_TRIAL_EVALUATIONS = 20

/**
 * Deterministic, bounded reachability repair. Removal is monotonic (fewer
 * colliders can only reach as many or more targets), so a trial removal is
 * only ever kept when it produces a *strict* improvement — otherwise every
 * removable object in the room would qualify once any single target stayed
 * unreached, stripping collision unrelated to the actual blockage.
 *
 * Candidates are ranked by proximity to the nearest still-unreached target
 * (computed once, up front) and capped to a fixed count: the object actually
 * blocking a target is overwhelmingly likely to sit near it, and bounding the
 * search keeps repair cost independent of total room object count.
 *
 * Phase 1 tries each candidate alone, in that deterministic order. Phase 2
 * (only reached if targets remain unreached) tries small deterministic pairs
 * among the same bounded, still-removable candidates, since two colliders can
 * jointly close a corridor that neither blocks alone. Every rejected trial is
 * restored to the world exactly as found.
 */
function repairRoomReachability(
  room: LoadedRoom,
  records: readonly ObjectRecord[],
  world: CollisionWorld2D,
): RoomReachability {
  const bounds = roomWalkableBounds(room)
  const spawn = findNearestFreePoint(world, {
    x: room.spawn.position[0], z: room.spawn.position[2],
  }, bounds, REACHABILITY_PLAYER_RADIUS)
  const targets = reachabilityTargets(records)
  const score = () => spawn === null ? 0 : targets.filter((target) => canReachWithinBounds(
    world, spawn, target.point, target.radius, bounds, REACHABILITY_PLAYER_RADIUS,
  )).length
  let reachableTargetCount = score()
  const repairedColliderKeys = new Set<string>()
  let repairedColliderCount = 0

  if (spawn !== null && reachableTargetCount < targets.length) {
    // A record whose collider the render-budget cap already excluded from
    // `world` must never be trial-"restored": removeRecordColliders would be
    // a harmless no-op, but an unconditional world.add() on rejection would
    // newly add a collider that was never part of the built world, silently
    // exceeding the static-collision-body budget.
    const presentColliderIds = new Set(world.snapshot().map((collider) => collider.id))
    const unreachedTargets = targets.filter((target) => !canReachWithinBounds(
      world, spawn, target.point, target.radius, bounds, REACHABILITY_PLAYER_RADIUS,
    ))
    const removable = removableReachabilityCandidates(records)
      .filter((record) => presentColliderIds.has(record.key))
      .map((record) => ({
        record,
        distanceSquared: nearestTargetDistanceSquared(record, unreachedTargets),
      }))
      .sort((a, b) => a.distanceSquared - b.distanceSquared || a.record.index - b.record.index)
      .slice(0, MAX_REACHABILITY_TRIAL_CANDIDATES)
      .map((entry) => entry.record)

    let evaluationsRemaining = MAX_REACHABILITY_TRIAL_EVALUATIONS

    for (const record of removable) {
      if (reachableTargetCount === targets.length || evaluationsRemaining <= 0) break
      const profile = record.candidates[0]!.descriptor.collision as Exclude<
        VisualResolution['descriptor']['collision'], { kind: 'none' }
      >
      const colliders = collidersFor(record, profile)
      removeRecordColliders(world, record)
      evaluationsRemaining -= 1
      const nextScore = score()
      if (nextScore > reachableTargetCount) {
        reachableTargetCount = nextScore
        repairedColliderKeys.add(record.key)
        repairedColliderCount += colliders.length
      } else {
        for (const collider of colliders) world.add(collider)
      }
    }

    if (reachableTargetCount < targets.length && evaluationsRemaining > 0) {
      const remaining = removable.filter((record) => !repairedColliderKeys.has(record.key))

      for (
        let i = 0;
        i < remaining.length && reachableTargetCount < targets.length && evaluationsRemaining > 0;
        i += 1
      ) {
        const first = remaining[i]!
        if (repairedColliderKeys.has(first.key)) continue
        const firstProfile = first.candidates[0]!.descriptor.collision as Exclude<
          VisualResolution['descriptor']['collision'], { kind: 'none' }
        >

        for (
          let j = i + 1;
          j < remaining.length && reachableTargetCount < targets.length && evaluationsRemaining > 0;
          j += 1
        ) {
          const second = remaining[j]!
          if (repairedColliderKeys.has(second.key)) continue
          const secondProfile = second.candidates[0]!.descriptor.collision as Exclude<
            VisualResolution['descriptor']['collision'], { kind: 'none' }
          >

          const firstColliders = collidersFor(first, firstProfile)
          const secondColliders = collidersFor(second, secondProfile)
          removeRecordColliders(world, first)
          removeRecordColliders(world, second)
          evaluationsRemaining -= 1
          const nextScore = score()
          if (nextScore > reachableTargetCount) {
            reachableTargetCount = nextScore
            repairedColliderKeys.add(first.key)
            repairedColliderKeys.add(second.key)
            repairedColliderCount += firstColliders.length + secondColliders.length
            break
          }
          for (const collider of firstColliders) world.add(collider)
          for (const collider of secondColliders) world.add(collider)
        }
      }
    }
  }

  return {
    targetCount: targets.length,
    reachableTargetCount,
    repairedColliderCount,
    repairedColliderKeys,
    spawnRepaired: spawn !== null && (spawn.x !== room.spawn.position[0] || spawn.z !== room.spawn.position[2]),
  }
}

/** Deterministic (record-index order), pre-filtered to blocking removable colliders. */
function removableReachabilityCandidates(records: readonly ObjectRecord[]): ObjectRecord[] {
  return records.filter((record) => {
    if (!isRemovableReachabilityCollider(record)) return false
    const profile = record.candidates[0]?.descriptor.collision
    return profile !== undefined && profile.kind !== 'none' && profile.blocksPlayer
  })
}

function nearestTargetDistanceSquared(
  record: ObjectRecord,
  targets: readonly { point: { x: number; z: number }; radius: number }[],
): number {
  const [x, , z] = record.object.position
  let nearest = Infinity
  for (const target of targets) {
    const dx = x - target.point.x
    const dz = z - target.point.z
    const distanceSquared = (dx * dx) + (dz * dz)
    if (distanceSquared < nearest) nearest = distanceSquared
  }
  return nearest
}

function roomWalkableBounds(room: LoadedRoom): WalkableBounds2D {
  const margin = room.shell.wallThickness / 2 + REACHABILITY_PLAYER_RADIUS
  return {
    minX: -(room.shell.dimensions.width / 2 - margin),
    maxX: room.shell.dimensions.width / 2 - margin,
    minZ: -(room.shell.dimensions.depth / 2 - margin),
    maxZ: room.shell.dimensions.depth / 2 - margin,
  }
}

function reachabilityTargets(records: readonly ObjectRecord[]): { point: { x: number; z: number }; radius: number }[] {
  return [{ point: { x: 0, z: 0 }, radius: 0.5 }, ...records.flatMap((record) => (
    record.object.type === 'npc' || interactionFor(record.object) !== undefined
      ? [{ point: { x: record.object.position[0], z: record.object.position[2] }, radius: INTERACTION_REACHABILITY_RADIUS }]
      : []
  ))]
}

function isRemovableReachabilityCollider(record: ObjectRecord): boolean {
  return interactionFor(record.object) === undefined && record.request.family !== 'anchor' && record.request.family !== 'architecture'
}
