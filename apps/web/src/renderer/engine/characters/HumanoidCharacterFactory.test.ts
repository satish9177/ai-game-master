import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { describe, expect, it, vi } from 'vitest'
import type { HumanoidAppearance } from '../../../domain/visuals/contracts'
import {
  isRenderValidSkinnedMesh,
  VisualAssetCache,
  type VisualBundleLoader,
} from '../visual-pack/VisualAssetCache'
import { ruinedKingdomPack } from '../visual-pack/ruinedKingdomPack'
import {
  HumanoidCharacterFactory,
  resolveHumanoidPreset,
  selectHumanoidParts,
} from './HumanoidCharacterFactory'

describe('HumanoidCharacterFactory', () => {
  it('uses one skeleton-safe cloning path with independent bones and mixers', async () => {
    const source = humanoidSource()
    const cache = new VisualAssetCache(ruinedKingdomPack, loaderReturning(gltfWith(source)))
    const factory = new HumanoidCharacterFactory(ruinedKingdomPack, cache)

    const first = await factory.create({
      roomId: 'room',
      stableId: 'guard-a',
      role: 'npc',
      npcType: 'guard',
    })
    const second = await factory.create({
      roomId: 'room',
      stableId: 'guard-b',
      role: 'npc',
      npcType: 'guard',
    })

    const firstBone = first.root.getObjectByName('rig-bone')
    const secondBone = second.root.getObjectByName('rig-bone')
    expect(firstBone).toBeInstanceOf(THREE.Bone)
    expect(secondBone).toBeInstanceOf(THREE.Bone)
    expect(firstBone).not.toBe(secondBone)
    expect(first.animations.animationMixer).not.toBe(second.animations.animationMixer)
    expect(cache.stats()).toMatchObject({ bundles: 2, activeLeases: 4 })

    first.dispose()
    second.dispose()
    expect(cache.stats().activeLeases).toBe(0)
  })

  it('returns visible, finite, valid rigged meshes for both player and NPC roles', async () => {
    const cache = new VisualAssetCache(
      ruinedKingdomPack,
      loaderReturning(gltfWith(humanoidSource())),
    )
    const factory = new HumanoidCharacterFactory(ruinedKingdomPack, cache)
    const player = await factory.create({
      roomId: 'room',
      stableId: 'player',
      role: 'player',
    })
    const npc = await factory.create({
      roomId: 'room',
      stableId: 'npc',
      role: 'npc',
      npcType: 'guard',
    })

    for (const character of [player, npc]) {
      character.root.updateWorldMatrix(true, true)
      const meshes: THREE.Mesh[] = []
      character.root.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (mesh.isMesh) meshes.push(mesh)
      })
      const visibleMeshes = meshes.filter((mesh) => isVisibleThroughAncestors(mesh))
      const box = new THREE.Box3().setFromObject(character.root)
      const size = box.getSize(new THREE.Vector3())
      const sphere = box.getBoundingSphere(new THREE.Sphere())

      expect(meshes.length).toBeGreaterThan(0)
      expect(visibleMeshes.length).toBeGreaterThan(0)
      expect(size.toArray().every(Number.isFinite)).toBe(true)
      expect(size.length()).toBeGreaterThan(0)
      expect(Number.isFinite(sphere.radius)).toBe(true)
      expect(sphere.radius).toBeGreaterThan(0)
      for (const mesh of visibleMeshes) {
        const worldScale = mesh.getWorldScale(new THREE.Vector3())
        expect(worldScale.toArray().every((value) => Number.isFinite(value) && value !== 0)).toBe(true)
        expect(mesh.material).toBeTruthy()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        expect(materials.every((material) => material.opacity > 0)).toBe(true)
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          expect(isRenderValidSkinnedMesh(mesh as THREE.SkinnedMesh)).toBe(true)
        }
      }
    }

    const npcMesh = firstVisibleMesh(npc.root)
    const npcMaterial = Array.isArray(npcMesh.material) ? npcMesh.material[0]! : npcMesh.material
    const npcMaterialDispose = vi.spyOn(npcMaterial, 'dispose')
    player.dispose()
    expect(npcMaterialDispose).not.toHaveBeenCalled()
    expect(firstVisibleMesh(npc.root).visible).toBe(true)
    npc.dispose()
    expect(npcMaterialDispose).toHaveBeenCalledTimes(1)
  })

  it('selects modular parts deterministically from room, stable id, and preset', () => {
    const definition = ruinedKingdomPack.humanoidPresets.merchant
    const appearance: HumanoidAppearance = {
      preset: 'merchant',
      presentation: 'feminine',
      palette: 'merchant',
      accessories: 'merchant',
    }
    const first = selectHumanoidParts('room:npc', 'merchant', appearance, definition)
    const second = selectHumanoidParts('room:npc', 'merchant', appearance, definition)
    const other = selectHumanoidParts('room:other', 'merchant', appearance, definition)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      preset: 'merchant',
      presentation: 'feminine',
      palette: 'merchant',
      accessories: 'merchant',
    })
    expect(first.bodyId).toMatch(/^body-feminine-/)
    expect(Object.values(first).join('|')).not.toBe(Object.values(other).join('|'))
  })

  it('maps closed presentation ids onto the curated humanoid GLB body groups', async () => {
    const cache = new VisualAssetCache(
      ruinedKingdomPack,
      loaderReturning(gltfWith(humanoidSource())),
    )
    const character = await new HumanoidCharacterFactory(ruinedKingdomPack, cache).create({
      roomId: 'room',
      stableId: 'merchant',
      role: 'npc',
      appearance: { preset: 'merchant', presentation: 'feminine' },
    })

    expect(character.selection.bodyId).toMatch(/^body-feminine-/)
    expect(character.root.getObjectByName('body-a')?.visible).toBe(false)
    expect(character.root.getObjectByName('body-b')?.visible).toBe(true)
    expect(character.root.getObjectByName('body-c')?.visible).toBe(false)

    character.dispose()
  })
  it('turns the visual child toward travel without mutating the logical root', async () => {
    const cache = new VisualAssetCache(
      ruinedKingdomPack,
      loaderReturning(gltfWith(humanoidSource())),
    )
    const character = await new HumanoidCharacterFactory(ruinedKingdomPack, cache).create({
      roomId: 'room',
      stableId: 'npc',
      role: 'npc',
    })
    character.root.rotation.y = 0.4
    character.updateFacing(1, 0)

    expect(character.root.rotation.y).toBeCloseTo(0.4)
    expect(character.visualRoot.rotation.y).toBeCloseTo(Math.PI / 2)
  })

  it('maps existing closed NPC roles and trusted player/zombie roles to presets', () => {
    expect(resolveHumanoidPreset({
      roomId: 'r',
      stableId: 'player',
      role: 'player',
    })).toBe('wanderer')
    expect(resolveHumanoidPreset({
      roomId: 'r',
      stableId: 'guard',
      role: 'npc',
      npcType: 'guard',
    })).toBe('guard')
    expect(resolveHumanoidPreset({
      roomId: 'r',
      stableId: 'zombie',
      role: 'zombie',
    })).toBe('zombie')
  })

  it('allows only a closed appearance preset to override the role default', () => {
    expect(resolveHumanoidPreset({
      roomId: 'r',
      stableId: 'raider',
      role: 'npc',
      appearance: { preset: 'raider' },
    })).toBe('raider')
  })
})

function humanoidSource(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'HumanoidRoot'
  const bone = new THREE.Bone()
  bone.name = 'rig-bone'
  root.add(bone)

  const parts = new Map<string, THREE.Group>()
  for (const name of [
    'body-a',
    'body-b',
    'body-c',
    'body-masculine-a',
    'body-masculine-b',
    'body-feminine-a',
    'body-feminine-b',
    'body-neutral-a',
    'body-neutral-b',
    'head-a',
    'head-b',
    'head-c',
    'head-d',
    'hair-none',
    'hair-short',
    'hair-long',
    'hair-tied',
    'outfit-tunic',
    'outfit-robe',
    'outfit-survivor',
    'armour-none',
    'armour-leather',
    'armour-mail',
  ]) {
    const part = new THREE.Group()
    part.name = name
    root.add(part)
    parts.set(name, part)
  }

  for (const bodyName of ['body-a', 'body-b', 'body-c']) {
    const mesh = skinnedBody(bone)
    mesh.name = bodyName + '-mesh'
    parts.get(bodyName)!.add(mesh)
  }
  return root
}

function skinnedBody(bone: THREE.Bone): THREE.SkinnedMesh {
  const geometry = new THREE.BoxGeometry(0.5, 1.8, 0.3).translate(0, 0.9, 0)
  const vertexCount = geometry.getAttribute('position').count
  const skinIndices = new Uint16Array(vertexCount * 4)
  const skinWeights = new Float32Array(vertexCount * 4)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) skinWeights[vertex * 4] = 1
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff' })
  material.name = 'TintableCloth'
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.userData.tintable = true
  mesh.bind(new THREE.Skeleton([bone]))
  return mesh
}

function isVisibleThroughAncestors(node: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = node
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

function firstVisibleMesh(root: THREE.Object3D): THREE.Mesh {
  let result: THREE.Mesh | undefined
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (result === undefined && mesh.isMesh && isVisibleThroughAncestors(mesh)) result = mesh
  })
  return result!
}

function gltfWith(node: THREE.Object3D): GLTF {
  const scene = new THREE.Group()
  scene.add(node)
  const animationRoot = new THREE.Group()
  animationRoot.name = 'AnimationRoot'
  scene.add(animationRoot)
  return {
    scene,
    scenes: [scene],
    animations: [new THREE.AnimationClip('Idle', 1, [])],
    cameras: [],
    asset: { version: '2.0' },
    parser: {} as GLTF['parser'],
    userData: {},
  }
}

function loaderReturning(gltf: GLTF): VisualBundleLoader {
  return { loadAsync: async () => gltf } as unknown as VisualBundleLoader
}
