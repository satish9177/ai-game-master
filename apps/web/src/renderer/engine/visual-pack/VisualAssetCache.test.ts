/// <reference types="node" />
import * as THREE from 'three'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it, vi } from 'vitest'
import {
  isRenderValidSkinnedMesh,
  createVisualPackGltfLoader,
  createVisualPackKtx2Loader,
  VISUAL_PACK_BASIS_TRANSCODER_PATH,
  VisualAssetCache,
  VisualAssetLoadError,
  type VisualBundleLoader,
} from './VisualAssetCache'
import { ruinedKingdomPack } from './ruinedKingdomPack'
import { HumanoidCharacterFactory } from '../characters/HumanoidCharacterFactory'
import { disposeObject } from '../disposables'

const ASSET_ID = ruinedKingdomPack.familyDefaults.furniture
const DESCRIPTOR = ruinedKingdomPack.assets[ASSET_ID]!

describe('VisualAssetCache', () => {
  it('deduplicates bundle loads and returns independent graphs with shared resources', async () => {
    const geometry = new THREE.BoxGeometry()
    const material = new THREE.MeshStandardMaterial()
    const source = new THREE.Mesh(geometry, material)
    source.name = DESCRIPTOR.nodeName
    const loader = loaderReturning(gltfWith(source))
    const cache = new VisualAssetCache(ruinedKingdomPack, loader)

    const [first, second] = await Promise.all([
      cache.acquire(ASSET_ID),
      cache.acquire(ASSET_ID),
    ])

    expect(loader.loadAsync).toHaveBeenCalledTimes(1)
    expect(first.instance).not.toBe(second.instance)
    expect((first.instance as THREE.Mesh).geometry).toBe(geometry)
    expect((second.instance as THREE.Mesh).material).toBe(material)
    expect(cache.stats().activeLeases).toBe(2)

    first.release()
    first.release()
    second.release()
    expect(cache.stats().activeLeases).toBe(0)
  })

  it('acquires reviewed GLTF nodes after GLTFLoader sanitizes their runtime names', async () => {
    const source = new THREE.Group()
    source.name = THREE.PropertyBinding.sanitizeNodeName(DESCRIPTOR.nodeName)
    source.userData.name = DESCRIPTOR.nodeName
    const cache = new VisualAssetCache(ruinedKingdomPack, loaderReturning(gltfWith(source)))

    const lease = await cache.acquire(ASSET_ID)

    expect(lease.instance.name).toBe(source.name)
    expect(cache.stats().activeLeases).toBe(1)
    lease.release()
  })

  it('owns and disposes shared GPU resources exactly once at final teardown', async () => {
    const texture = new THREE.Texture()
    const geometry = new THREE.BoxGeometry()
    const material = new THREE.MeshStandardMaterial({ map: texture })
    const source = new THREE.Mesh(geometry, material)
    source.name = DESCRIPTOR.nodeName
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')
    const textureDispose = vi.spyOn(texture, 'dispose')
    const cache = new VisualAssetCache(ruinedKingdomPack, loaderReturning(gltfWith(source)))

    const lease = await cache.acquire(ASSET_ID)
    disposeObject(lease.instance)
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
    expect(textureDispose).not.toHaveBeenCalled()
    lease.release()
    cache.teardown()
    cache.teardown()

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(textureDispose).toHaveBeenCalledTimes(1)
  })

  it('uses fixed failure codes and permits a deterministic retry after rejection', async () => {
    const source = new THREE.Object3D()
    source.name = DESCRIPTOR.nodeName
    const loadAsync = vi.fn()
      .mockRejectedValueOnce(new Error('SECRET URL and provider response'))
      .mockResolvedValueOnce(gltfWith(source))
    const cache = new VisualAssetCache(
      ruinedKingdomPack,
      { loadAsync } as unknown as VisualBundleLoader,
    )

    await expect(cache.acquire(ASSET_ID)).rejects.toMatchObject({
      code: 'bundle-load-failed',
      message: 'visual asset unavailable: bundle-load-failed',
    })
    const lease = await cache.acquire(ASSET_ID)
    expect(loadAsync).toHaveBeenCalledTimes(2)
    lease.release()
  })

  it('rejects missing reviewed node names without exposing bundle details', async () => {
    const cache = new VisualAssetCache(
      ruinedKingdomPack,
      loaderReturning(gltfWith(new THREE.Group())),
    )
    await expect(cache.acquire(ASSET_ID)).rejects.toEqual(
      new VisualAssetLoadError('asset-node-missing'),
    )
  })

  it('rejects acquisitions after teardown and clears cache diagnostics', async () => {
    const source = new THREE.Object3D()
    source.name = DESCRIPTOR.nodeName
    const cache = new VisualAssetCache(ruinedKingdomPack, loaderReturning(gltfWith(source)))
    const lease = await cache.acquire(ASSET_ID)
    lease.release()
    cache.teardown()

    expect(cache.stats()).toEqual({
      bundles: 0,
      loadedBundles: 0,
      pendingBundles: 0,
      activeLeases: 0,
    })
    await expect(cache.acquire(ASSET_ID)).rejects.toMatchObject({ code: 'cache-disposed' })
  })
  it('acquires representative committed GLB descriptors and embedded PBR textures through GLTFLoader', async () => {
    const cache = new VisualAssetCache(ruinedKingdomPack, loaderFromCommittedBundles())
    const assetIds = [
      'architecture.village.wall-straight',
      'furniture.table',
      'object.altar.altar',
      'neutral.furniture',
      'neutral.lighting',
      'object.crate.crate',
      'object.scroll.rolled',
      'lod.architecture.crypt.doorway.1',
      'lod.vegetation.tree.1',
    ] as const

    const leases = await Promise.all(assetIds.map((assetId) => cache.acquire(assetId)))
    for (const lease of leases) {
      let pbrMeshCount = 0
      let texturedPbrMeshCount = 0
      lease.instance.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
          pbrMeshCount += 1
          if (mesh.material.map !== null) texturedPbrMeshCount += 1
        }
      })
      expect(pbrMeshCount).toBeGreaterThan(0)
      if (lease.assetId === 'architecture.village.wall-straight') {
        expect(texturedPbrMeshCount).toBeGreaterThan(0)
      }
      lease.release()
    }
    cache.teardown()
  })

  it('configures the bundled Meshopt decoder for required production geometry', async () => {
    installNodeImageBitmapLoaderShim()
    const bytes = await readFile(resolve(
      process.cwd(),
      'public/visual-packs/ruined-kingdom-survival/props/furniture.glb',
    ))

    const gltf = await createNodeGltfLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    )

    let reviewedRootFound = false
    gltf.scene.traverse((node) => {
      if (node.userData.name === 'furniture.table') reviewedRootFound = true
    })
    expect(reviewedRootFound).toBe(true)
  })

  it('configures one GLTFLoader with both Meshopt and the locally bundled KTX2 transcoder', () => {
    const ktx2Loader = createVisualPackKtx2Loader()
    const loader = createVisualPackGltfLoader(ktx2Loader)
    const configured = loader as unknown as {
      ktx2Loader?: unknown
      meshoptDecoder?: unknown
    }
    expect((ktx2Loader as unknown as { transcoderPath: string }).transcoderPath)
      .toBe(VISUAL_PACK_BASIS_TRANSCODER_PATH)
    expect(configured.ktx2Loader).toBe(ktx2Loader)
    expect(configured.meshoptDecoder).toBeDefined()
    ktx2Loader.dispose()
  })
  it('loads distinct Slice 2A assets with component-only states and shared bundle prototypes', async () => {
    const loader = loaderFromCommittedBundles()
    const cache = new VisualAssetCache(ruinedKingdomPack, loader)
    const approvedBundleIds = new Set(['furniture', 'containers', 'lighting'])
    const approvedAssetIds = Object.entries(ruinedKingdomPack.assets)
      .filter(([, descriptor]) => approvedBundleIds.has(descriptor.bundleId))
      .map(([assetId]) => assetId)
    const leases = await Promise.all(approvedAssetIds.map((assetId) => cache.acquire(assetId)))
    const byId = new Map(leases.map((lease) => [lease.assetId, lease.instance]))

    expect(loader.loadAsync).toHaveBeenCalledTimes(3)
    expect(approvedAssetIds.length).toBeGreaterThan(60)
    expectDistinctVisuals(byId, [
      'object.table.table',
      'object.table.desk',
      'object.table.workbench',
      'object.table.counter',
    ])
    expectDistinctVisuals(byId, [
      'object.chest.treasure-chest',
      'object.chest.lockbox',
      'object.chest.coffer',
      'object.chest.strongbox',
      'object.chest.footlocker',
    ])
    expectDistinctVisuals(byId, [
      'object.torch.wall-torch',
      'lighting.lantern',
      'lighting.brazier',
      'lighting.chandelier',
      'object.candle.single',
      'lighting.campfire',
    ])
    expect(visualSignature(byId.get('object.throne.royal')!)).not.toBe(
      visualSignature(byId.get('object.altar.altar')!),
    )

    for (const assetId of [
      'furniture.cabinet',
      'furniture.wardrobe',
      'object.chest.treasure-chest',
      'object.chest.lockbox',
      'object.chest.coffer',
      'object.chest.strongbox',
      'object.chest.footlocker',
    ]) {
      const root = byId.get(assetId)!
      const base = findReviewedPart(root, 'visual-base')
      const moving = findReviewedPart(root, 'state-lid')
      const contents = findReviewedPart(root, 'state-contents')
      const looted = findReviewedPart(root, 'state-looted')
      const lock = findReviewedPart(root, 'state-lock')
      expect(base).toBeDefined()
      expect(moving).toBeDefined()
      expect(contents).toBeDefined()
      expect(looted).toBeDefined()
      expect(lock).toBeDefined()
      expect(visualSignature(moving!)).not.toBe(visualSignature(base!))
      expect(triangleCount(moving!)).toBeLessThan(triangleCount(root))
      expect(triangleCount(contents!)).toBeLessThan(triangleCount(root))
    }

    for (const assetId of [
      'object.table.workbench',
      'object.chest.treasure-chest',
      'lighting.brazier',
    ]) {
      const root = byId.get(assetId)!
      const base = findReviewedPart(root, 'visual-base')!
      for (const condition of ['damaged', 'burned', 'overgrown']) {
        const component = findReviewedPart(root, 'condition-' + condition)!
        expect(component).toBeDefined()
        expect(visualSignature(component)).not.toBe(visualSignature(base))
        expect(triangleCount(component)).toBeLessThan(triangleCount(root))
      }
    }

    for (const assetId of [
      'object.table.table',
      'object.chest.treasure-chest',
      'object.torch.wall-torch',
    ]) {
      expect(hasTextureBackedPbrMaterial(byId.get(assetId)!)).toBe(true)
    }
    for (const assetId of [
      'object.torch.wall-torch',
      'lighting.lantern',
      'lighting.brazier',
      'lighting.chandelier',
      'object.candle.single',
      'lighting.campfire',
    ]) {
      expect(hasEmissivePbrMaterial(byId.get(assetId)!)).toBe(true)
    }

    for (const lease of leases) lease.release()
    cache.teardown()
  })

  it('acquires the committed humanoid core as a valid animated skeleton', async () => {
    const cache = new VisualAssetCache(ruinedKingdomPack, loaderFromCommittedHumanoidStructure())

    const lease = await cache.acquire('humanoid.guard')
    let skinnedMeshCount = 0
    lease.instance.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      skinnedMeshCount += 1
      expect(isRenderValidSkinnedMesh(mesh)).toBe(true)
    })

    expect(lease.instance.name).toBe('HumanoidRoot')
    expect(lease.instance.getObjectByName('root')).toBeInstanceOf(THREE.Bone)
    expect(lease.instance.getObjectByName('pelvis')).toBeInstanceOf(THREE.Bone)
    expect(skinnedMeshCount).toBeGreaterThan(0)
    lease.release()
    cache.teardown()
  })

  it('builds visible player and NPC instances from the committed rig and clips', async () => {
    const cache = new VisualAssetCache(ruinedKingdomPack, loaderFromCommittedHumanoidStructure())
    const factory = new HumanoidCharacterFactory(ruinedKingdomPack, cache)
    const characters = await Promise.all([
      factory.create({ roomId: 'room', stableId: 'player', role: 'player' }),
      factory.create({ roomId: 'room', stableId: 'guard', role: 'npc', npcType: 'guard' }),
    ])

    for (const character of characters) {
      let visibleSkinnedMeshCount = 0
      character.root.traverse((node) => {
        const mesh = node as THREE.SkinnedMesh
        if (!mesh.isSkinnedMesh || !visibleThroughAncestors(mesh)) return
        visibleSkinnedMeshCount += 1
        expect(isRenderValidSkinnedMesh(mesh)).toBe(true)
      })
      const bounds = new THREE.Box3().setFromObject(character.root)
      const size = bounds.getSize(new THREE.Vector3())
      expect(visibleSkinnedMeshCount).toBeGreaterThan(0)
      expect(size.toArray().every(Number.isFinite)).toBe(true)
      expect(size.length()).toBeGreaterThan(0)
      character.dispose()
    }
    cache.teardown()
  })

  it('converts an unbound static SkinnedMesh to Mesh and preserves render properties', async () => {
    const geometry = new THREE.BoxGeometry()
    const material = new THREE.MeshStandardMaterial({ color: '#785f48' })
    const source = new THREE.SkinnedMesh(geometry, material)
    source.name = DESCRIPTOR.nodeName
    source.position.set(1, 2, 3)
    source.rotation.set(0.1, 0.2, 0.3)
    source.scale.set(2, 3, 4)
    source.visible = false
    source.castShadow = true
    source.receiveShadow = true
    source.renderOrder = 7
    source.userData = { provenance: 'reviewed-static' }
    source.morphTargetInfluences = [0.35]
    source.morphTargetDictionary = { damaged: 0 }
    const cache = new VisualAssetCache(
      ruinedKingdomPack,
      loaderReturning(gltfWith(source)),
    )

    const lease = await cache.acquire(ASSET_ID)
    const converted = lease.instance as THREE.Mesh

    expect(converted).toBeInstanceOf(THREE.Mesh)
    expect((converted as THREE.SkinnedMesh).isSkinnedMesh).not.toBe(true)
    expect(converted.geometry).toBe(geometry)
    expect(converted.material).toBe(material)
    expect(converted.name).toBe(DESCRIPTOR.nodeName)
    expect(converted.position.toArray()).toEqual([1, 2, 3])
    expect(converted.rotation.x).toBeCloseTo(0.1)
    expect(converted.rotation.y).toBeCloseTo(0.2)
    expect(converted.rotation.z).toBeCloseTo(0.3)
    expect(converted.scale.toArray()).toEqual([2, 3, 4])
    expect(converted.visible).toBe(false)
    expect(converted.castShadow).toBe(true)
    expect(converted.receiveShadow).toBe(true)
    expect(converted.renderOrder).toBe(7)
    expect(converted.userData).toEqual({
      provenance: 'reviewed-static',
      visualPackSharedResource: true,
    })
    expect(converted.morphTargetInfluences).toEqual([0.35])
    expect(converted.morphTargetDictionary).toEqual({ damaged: 0 })
    lease.release()
    cache.teardown()
  })

  it('keeps a valid bound SkinnedMesh skinned and clones its skeleton safely', async () => {
    const source = validSkinnedMesh()
    source.name = ruinedKingdomPack.assets['humanoid.guard']!.nodeName
    const cache = new VisualAssetCache(
      ruinedKingdomPack,
      loaderReturning(gltfWith(source)),
    )

    const lease = await cache.acquire('humanoid.guard')
    const clone = lease.instance as THREE.SkinnedMesh

    expect(clone.isSkinnedMesh).toBe(true)
    expect(isRenderValidSkinnedMesh(clone)).toBe(true)
    expect(clone.skeleton).not.toBe(source.skeleton)
    expect(clone.skeleton.bones[0]).not.toBe(source.skeleton.bones[0])
    lease.release()
    cache.teardown()
  })

  it('rejects invalid animated skinning and emits one bounded fixed-code diagnostic', async () => {
    const assetId = 'humanoid.guard'
    const descriptor = ruinedKingdomPack.assets[assetId]!
    const source = new THREE.SkinnedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
    )
    source.name = descriptor.nodeName
    const warn = vi.fn()
    const cache = new VisualAssetCache(
      ruinedKingdomPack,
      loaderReturning(gltfWith(source)),
      { warn },
    )

    await expect(cache.acquire(assetId)).rejects.toEqual(
      new VisualAssetLoadError('invalid-unbound-skinned-mesh'),
    )
    await expect(cache.acquire(assetId)).rejects.toMatchObject({
      code: 'invalid-unbound-skinned-mesh',
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('visual pack invalid skinning', {
      assetId,
      nodeName: descriptor.nodeName,
      code: 'invalid-unbound-skinned-mesh',
      action: 'rejected-animated',
    })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('.glb')
    cache.teardown()
  })

  it('deduplicates the fixed static-conversion diagnostic', async () => {
    const source = new THREE.SkinnedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
    )
    source.name = DESCRIPTOR.nodeName
    const warn = vi.fn()
    const cache = new VisualAssetCache(
      ruinedKingdomPack,
      loaderReturning(gltfWith(source)),
      { warn },
    )

    const first = await cache.acquire(ASSET_ID)
    const second = await cache.acquire(ASSET_ID)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('visual pack invalid skinning', {
      assetId: ASSET_ID,
      nodeName: DESCRIPTOR.nodeName,
      code: 'invalid-unbound-skinned-mesh',
      action: 'converted-static',
    })
    expect(expectInvalidSkinnedMeshCount(first.instance)).toBe(0)
    expect(expectInvalidSkinnedMeshCount(second.instance)).toBe(0)
    first.release()
    second.release()
    cache.teardown()
  })

  it('sanitizes every committed static fallback, environment, and prop descriptor', async () => {
    const cache = new VisualAssetCache(ruinedKingdomPack, loaderFromCommittedBundles())
    const staticAssetIds = Object.entries(ruinedKingdomPack.assets)
      .filter(([, descriptor]) => descriptor.family !== 'humanoid')
      .map(([assetId]) => assetId)

    for (const assetId of staticAssetIds) {
      const lease = await cache.acquire(assetId)
      expect(expectInvalidSkinnedMeshCount(lease.instance)).toBe(0)
      lease.release()
    }
    cache.teardown()
  }, 20_000)

})

function gltfWith(node: THREE.Object3D): GLTF {
  const scene = new THREE.Group()
  scene.add(node)
  return {
    scene,
    scenes: [scene],
    animations: [],
    cameras: [],
    asset: { version: '2.0' },
    parser: {} as GLTF['parser'],
    userData: {},
  }
}

function loaderReturning(gltf: GLTF): VisualBundleLoader & { loadAsync: ReturnType<typeof vi.fn> } {
  const loadAsync = vi.fn().mockResolvedValue(gltf)
  return { loadAsync } as unknown as VisualBundleLoader & {
    loadAsync: ReturnType<typeof vi.fn>
  }
}

function expectDistinctVisuals(
  byId: ReadonlyMap<string, THREE.Object3D>,
  assetIds: readonly string[],
): void {
  const signatures = assetIds.map((assetId) => visualSignature(byId.get(assetId)!))
  expect(new Set(signatures).size).toBe(assetIds.length)
}

function visualSignature(root: THREE.Object3D): string {
  const values: number[] = []
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    values.push(
      node.position.x,
      node.position.y,
      node.position.z,
      node.quaternion.x,
      node.quaternion.y,
      node.quaternion.z,
      node.quaternion.w,
      node.scale.x,
      node.scale.y,
      node.scale.z,
    )
    const position = mesh.geometry.getAttribute('position')
    values.push(position.count, mesh.geometry.index?.count ?? 0)
    for (let index = 0; index < position.array.length; index += 1) {
      values.push(Number(position.array[index]))
    }
  })
  let hash = 0x811c9dc5
  for (const value of values) {
    hash ^= Math.round(value * 10_000)
    hash = Math.imul(hash, 0x01000193)
  }
  return values.length + ':' + (hash >>> 0).toString(16)
}

function findReviewedPart(
  root: THREE.Object3D,
  suffix: string,
): THREE.Object3D | undefined {
  let match: THREE.Object3D | undefined
  root.traverse((node) => {
    const reviewedName = typeof node.userData.name === 'string'
      ? node.userData.name
      : node.name
    if (!match && reviewedName.endsWith(':' + suffix)) match = node
  })
  return match
}

function triangleCount(root: THREE.Object3D): number {
  let count = 0
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    count += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3
  })
  return count
}

function hasTextureBackedPbrMaterial(root: THREE.Object3D): boolean {
  let found = false
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.some((material) => (
      material instanceof THREE.MeshStandardMaterial && material.map !== null
    ))) found = true
  })
  return found
}

function hasEmissivePbrMaterial(root: THREE.Object3D): boolean {
  let found = false
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.some((material) => (
      material instanceof THREE.MeshStandardMaterial
      && material.emissive.getHex() !== 0
      && material.emissiveIntensity > 0
    ))) found = true
  })
  return found
}

function createNodeGltfLoader() {
  const loader = createVisualPackGltfLoader()
  loader.setKTX2Loader({
    load(_url: string, onLoad: (texture: THREE.Texture) => void) {
      onLoad(new THREE.Texture())
    },
  } as unknown as Parameters<typeof loader.setKTX2Loader>[0])
  return loader
}
function loaderFromCommittedBundles(): VisualBundleLoader & {
  loadAsync: ReturnType<typeof vi.fn>
} {
  installNodeImageBitmapLoaderShim()
  const parser = createNodeGltfLoader()
  const loadAsync = vi.fn(async (bundleUrl: string): Promise<GLTF> => {
      const bytes = await readFile(resolve(process.cwd(), 'public' + bundleUrl))
      return parser.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
  })
  return { loadAsync } as VisualBundleLoader & {
    loadAsync: ReturnType<typeof vi.fn>
  }
}

function installNodeImageBitmapLoaderShim(): void {
  if (typeof self === 'undefined') {
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: globalThis,
    })
  }
  if (typeof createImageBitmap === 'undefined') {
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: async () => ({
        close() {},
        height: 1,
        width: 1,
      }) as unknown as ImageBitmap,
    })
  }
}

function loaderFromCommittedHumanoidStructure(): VisualBundleLoader {
  const parser = createNodeGltfLoader()
  return {
    async loadAsync(bundleUrl: string): Promise<GLTF> {
      const bytes = await readFile(resolve(process.cwd(), 'public' + bundleUrl))
      const textureless = removeGlbTextures(bytes)
      return parser.parseAsync(
        textureless.buffer.slice(
          textureless.byteOffset,
          textureless.byteOffset + textureless.byteLength,
        ) as ArrayBuffer,
        '',
      )
    },
  } as VisualBundleLoader
}

function removeGlbTextures(source: Buffer): Buffer {
  const jsonLength = source.readUInt32LE(12)
  const binaryOffset = 20 + jsonLength
  const binaryLength = source.readUInt32LE(binaryOffset)
  const binaryType = source.readUInt32LE(binaryOffset + 4)
  const binary = source.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength)
  const json = JSON.parse(source.subarray(20, 20 + jsonLength).toString('utf8').trim()) as {
    images?: unknown
    textures?: unknown
    samplers?: unknown
    materials?: Array<Record<string, unknown> & {
      pbrMetallicRoughness?: Record<string, unknown>
    }>
  }
  delete json.images
  delete json.textures
  delete json.samplers
  for (const material of json.materials ?? []) {
    delete material.pbrMetallicRoughness?.baseColorTexture
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture
    delete material.normalTexture
    delete material.occlusionTexture
    delete material.emissiveTexture
  }

  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
  const paddedJsonLength = Math.ceil(jsonBytes.length / 4) * 4
  const output = Buffer.alloc(12 + 8 + paddedJsonLength + 8 + binaryLength, 0x20)
  output.writeUInt32LE(0x46546c67, 0)
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(output.length, 8)
  output.writeUInt32LE(paddedJsonLength, 12)
  output.writeUInt32LE(0x4e4f534a, 16)
  jsonBytes.copy(output, 20)
  const outputBinaryOffset = 20 + paddedJsonLength
  output.writeUInt32LE(binaryLength, outputBinaryOffset)
  output.writeUInt32LE(binaryType, outputBinaryOffset + 4)
  binary.copy(output, outputBinaryOffset + 8)
  return output
}

function validSkinnedMesh(): THREE.SkinnedMesh {
  const geometry = new THREE.BoxGeometry()
  const vertexCount = geometry.getAttribute('position').count
  const skinIndices = new Uint16Array(vertexCount * 4)
  const skinWeights = new Float32Array(vertexCount * 4)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    skinWeights[vertex * 4] = 1
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))

  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial())
  const bone = new THREE.Bone()
  mesh.add(bone)
  mesh.bind(new THREE.Skeleton([bone]))
  return mesh
}

function expectInvalidSkinnedMeshCount(root: THREE.Object3D): number {
  let count = 0
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh
    if (mesh.isSkinnedMesh && !isRenderValidSkinnedMesh(mesh)) count += 1
  })
  return count
}

function visibleThroughAncestors(node: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = node
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}
