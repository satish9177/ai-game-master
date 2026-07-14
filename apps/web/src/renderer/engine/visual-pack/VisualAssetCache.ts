import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { VisualAssetDescriptor, VisualPackRegistry } from './contracts'
import type { Logger } from '../../../platform/logger/Logger'

export type VisualAssetLease = Readonly<{
  assetId: string
  descriptor: VisualAssetDescriptor
  instance: THREE.Object3D
  animations: readonly THREE.AnimationClip[]
  release: () => void
}>

export type VisualAssetCacheStats = Readonly<{
  bundles: number
  loadedBundles: number
  pendingBundles: number
  activeLeases: number
}>

export type VisualAssetLoadErrorCode =
  | 'cache-disposed'
  | 'unknown-asset'
  | 'bundle-load-failed'
  | 'asset-node-missing'
  | 'asset-clone-failed'
  | 'invalid-unbound-skinned-mesh'

export class VisualAssetLoadError extends Error {
  readonly code: VisualAssetLoadErrorCode

  constructor(code: VisualAssetLoadErrorCode) {
    super('visual asset unavailable: ' + code)
    this.name = 'VisualAssetLoadError'
    this.code = code
  }
}

export type VisualBundleLoader = Pick<GLTFLoader, 'loadAsync'>

/**
 * The production pack requires Meshopt for its self-contained reviewed GLBs.
 * Three ships this decoder as an embedded module, so this adds no runtime URL
 * or dependency beyond the pinned renderer package.
 */
export function createVisualPackGltfLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
}

type BundleRecord = {
  promise: Promise<GLTF>
  loaded?: GLTF
  leases: number
  generation: number
}

/**
 * Pack-lifetime cache. Room instances borrow cloned object graphs while shared
 * geometries, materials, textures, and clips remain owned by this cache.
 */
export class VisualAssetCache {
  private readonly records = new Map<string, BundleRecord>()
  private readonly reportedSkinningDiagnostics = new Set<string>()
  private disposed = false
  private generation = 0

  private readonly registry: VisualPackRegistry
  private readonly loader: VisualBundleLoader
  private readonly logger: Pick<Logger, 'warn'> | undefined
  constructor(
    registry: VisualPackRegistry,
    loader: VisualBundleLoader = createVisualPackGltfLoader(),
    logger?: Pick<Logger, 'warn'>,
  ) {
    this.registry = registry
    this.loader = loader
    this.logger = logger
  }

  async acquire(assetId: string): Promise<VisualAssetLease> {
    if (this.disposed) throw new VisualAssetLoadError('cache-disposed')
    const descriptor = this.registry.assets[assetId]
    if (!descriptor) throw new VisualAssetLoadError('unknown-asset')

    const record = this.getOrLoadBundle(descriptor.bundleId)
    const gltf = await record.promise
    if (this.disposed || record.generation !== this.generation) {
      throw new VisualAssetLoadError('cache-disposed')
    }

    const reviewedNode = findReviewedNode(gltf.scene, descriptor.nodeName)
    if (!reviewedNode) throw new VisualAssetLoadError('asset-node-missing')
    const source = this.prepareRenderableSubtree(assetId, descriptor, reviewedNode)

    let instance: THREE.Object3D
    try {
      instance = cloneVisualAsset(source)
    } catch {
      throw new VisualAssetLoadError('asset-clone-failed')
    }
    instance = this.prepareRenderableSubtree(assetId, descriptor, instance)

    markCacheOwnedResources(instance)
    record.leases += 1
    let released = false

    return {
      assetId,
      descriptor,
      instance,
      animations: gltf.animations,
      release: () => {
        if (released) return
        released = true
        record.leases = Math.max(0, record.leases - 1)
      },
    }
  }

  stats(): VisualAssetCacheStats {
    let loadedBundles = 0
    let pendingBundles = 0
    let activeLeases = 0
    for (const record of this.records.values()) {
      if (record.loaded) loadedBundles += 1
      else pendingBundles += 1
      activeLeases += record.leases
    }
    return {
      bundles: this.records.size,
      loadedBundles,
      pendingBundles,
      activeLeases,
    }
  }

  teardown(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    for (const record of this.records.values()) {
      if (record.loaded) disposeBundle(record.loaded.scene)
    }
    this.records.clear()
    this.reportedSkinningDiagnostics.clear()
  }

  private prepareRenderableSubtree(
    assetId: string,
    descriptor: VisualAssetDescriptor,
    root: THREE.Object3D,
  ): THREE.Object3D {
    const invalidMeshes = findInvalidSkinnedMeshes(root)
    if (invalidMeshes.length === 0) return root

    if (requiresAnimatedSkinning(descriptor)) {
      this.warnInvalidSkinning(assetId, descriptor.nodeName, 'rejected-animated')
      throw new VisualAssetLoadError('invalid-unbound-skinned-mesh')
    }

    let sanitizedRoot = root
    for (const invalidMesh of invalidMeshes) {
      const replacement = convertToStaticMesh(invalidMesh)
      if (invalidMesh === sanitizedRoot) sanitizedRoot = replacement
    }
    this.warnInvalidSkinning(assetId, descriptor.nodeName, 'converted-static')
    return sanitizedRoot
  }

  private warnInvalidSkinning(
    assetId: string,
    nodeName: string,
    action: 'converted-static' | 'rejected-animated',
  ): void {
    const diagnosticKey = assetId + ':' + action
    if (this.reportedSkinningDiagnostics.has(diagnosticKey)) return
    this.reportedSkinningDiagnostics.add(diagnosticKey)
    this.logger?.warn('visual pack invalid skinning', {
      assetId,
      nodeName,
      code: 'invalid-unbound-skinned-mesh',
      action,
    })
  }

  private getOrLoadBundle(bundleId: string): BundleRecord {
    const existing = this.records.get(bundleId)
    if (existing) return existing

    const url = this.registry.bundles[bundleId]
    if (!url) throw new VisualAssetLoadError('bundle-load-failed')

    const record: BundleRecord = {
      promise: Promise.resolve(undefined as never),
      leases: 0,
      generation: this.generation,
    }
    record.promise = this.loader.loadAsync(url).then((gltf) => {
      if (this.disposed || record.generation !== this.generation) {
        disposeBundle(gltf.scene)
        throw new VisualAssetLoadError('cache-disposed')
      }
      record.loaded = gltf
      return gltf
    }).catch((error: unknown) => {
      if (this.records.get(bundleId) === record) this.records.delete(bundleId)
      if (error instanceof VisualAssetLoadError) throw error
      throw new VisualAssetLoadError('bundle-load-failed')
    })

    this.records.set(bundleId, record)
    return record
  }
}

export function isVisualPackSharedResource(node: THREE.Object3D): boolean {
  return node.userData.visualPackSharedResource === true
}

function markCacheOwnedResources(root: THREE.Object3D): void {
  root.traverse((node) => {
    node.userData.visualPackSharedResource = true
  })
}

/**
 * GLTFLoader sanitizes node names for animation bindings (notably removing
 * dots), while preserving the reviewed glTF name in userData.name. Registry
 * descriptors intentionally retain the original reviewed name, so resolve it
 * before using the loader's deterministic sanitized equivalent.
 */
function findReviewedNode(
  scene: THREE.Object3D,
  reviewedNodeName: string,
): THREE.Object3D | undefined {
  const exactNameMatch = scene.getObjectByName(reviewedNodeName)
  if (exactNameMatch !== undefined) return exactNameMatch

  let originalNameMatch: THREE.Object3D | undefined
  scene.traverse((node) => {
    if (originalNameMatch === undefined && node.userData.name === reviewedNodeName) {
      originalNameMatch = node
    }
  })
  if (originalNameMatch !== undefined) return originalNameMatch

  return scene.getObjectByName(
    THREE.PropertyBinding.sanitizeNodeName(reviewedNodeName),
  )
}
function cloneVisualAsset(source: THREE.Object3D): THREE.Object3D {
  let hasSkinnedMesh = false
  source.traverse((node) => {
    const skinnedMesh = node as THREE.SkinnedMesh
    if (skinnedMesh.isSkinnedMesh) hasSkinnedMesh = true
  })

  return hasSkinnedMesh ? cloneSkeleton(source) : source.clone(true)
}

/**
 * Rendering and shadow passes dereference every referenced bone. A truthy
 * `skeleton` alone is therefore insufficient: the skin attributes, bone array,
 * inverse matrices, and referenced indices must all be internally usable.
 */
export function isRenderValidSkinnedMesh(mesh: THREE.SkinnedMesh): boolean {
  const skeleton = mesh.skeleton
  if (!skeleton || !Array.isArray(skeleton.bones) || skeleton.bones.length === 0) {
    return false
  }
  if (
    !Array.isArray(skeleton.boneInverses)
    || skeleton.boneInverses.length < skeleton.bones.length
    || !ArrayBuffer.isView(skeleton.boneMatrices)
    || skeleton.boneMatrices.length < skeleton.bones.length * 16
  ) {
    return false
  }
  if (skeleton.bones.some((bone) => !bone?.isBone || !bone.matrixWorld?.isMatrix4)) {
    return false
  }
  if (skeleton.boneInverses.some((inverse) => !inverse?.isMatrix4)) return false
  if (!mesh.bindMatrix?.isMatrix4 || !mesh.bindMatrixInverse?.isMatrix4) return false

  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  const position = mesh.geometry.getAttribute('position')
  if (
    !position
    || !skinIndex
    || !skinWeight
    || skinIndex.itemSize < 4
    || skinWeight.itemSize < 4
    || skinIndex.count !== skinWeight.count
    || skinIndex.count !== position.count
  ) {
    return false
  }

  for (let vertex = 0; vertex < skinIndex.count; vertex += 1) {
    for (let component = 0; component < 4; component += 1) {
      const boneIndex = skinIndex.getComponent(vertex, component)
      if (!Number.isInteger(boneIndex) || boneIndex < 0 || boneIndex >= skeleton.bones.length) {
        return false
      }
    }
  }
  return true
}

function findInvalidSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const invalid: THREE.SkinnedMesh[] = []
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh
    if (mesh.isSkinnedMesh && !isRenderValidSkinnedMesh(mesh)) invalid.push(mesh)
  })
  return invalid
}

function requiresAnimatedSkinning(descriptor: VisualAssetDescriptor): boolean {
  return descriptor.family === 'humanoid' && descriptor.instancing === 'forbidden'
}

function convertToStaticMesh(source: THREE.SkinnedMesh): THREE.Mesh {
  const replacement = new THREE.Mesh().copy(source, false)
  for (const child of [...source.children]) replacement.add(child)

  const parent = source.parent
  if (parent) {
    const index = parent.children.indexOf(source)
    if (index >= 0) {
      parent.children[index] = replacement
      replacement.parent = parent
      source.parent = null
    }
  }
  return replacement
}

function disposeBundle(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()

  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.geometry) geometries.add(mesh.geometry)
    const meshMaterials = mesh.material
      ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      : []
    for (const material of meshMaterials) {
      materials.add(material)
      const values = Object.values(material as unknown as Record<string, unknown>)
      for (const value of values) {
        if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) {
          textures.add(value as THREE.Texture)
        }
      }
    }
  })

  for (const geometry of geometries) geometry.dispose()
  for (const texture of textures) texture.dispose()
  for (const material of materials) material.dispose()
}
