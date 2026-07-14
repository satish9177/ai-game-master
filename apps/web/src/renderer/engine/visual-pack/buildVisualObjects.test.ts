import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { loadRoomSpec } from '../../../domain/loadRoomSpec'
import { projectRoomObjectPresentationStates } from '../../../domain/visuals/objectPresentationState'
import { ruinedKingdomShowcases } from '../../../domain/examples/ruinedKingdomShowcases'
import type { Logger } from '../../../platform/logger/Logger'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  isRenderValidSkinnedMesh,
  VisualAssetCache,
  type VisualAssetLease,
} from './VisualAssetCache'
import {
  buildVisualObjects,
  VisualPackUnavailableError,
  updateBuiltObjectPresentationStates,
  visualRequestForObject,
  type VisualAssetProvider,
} from './buildVisualObjects'
import type { RenderBudget } from './renderBudget'
import { BALANCED_RENDER_BUDGET } from './renderBudget'
import { ruinedKingdomPack } from './ruinedKingdomPack'

describe('visualRequestForObject', () => {
  it('maps legacy variants and new semantic families without accepting asset paths', () => {
    const room = loadRoomSpec(roomEnvelope([
      { type: 'chest', variant: 'footlocker', position: [0, 0, 0] },
      { type: 'architecture', kind: 'wall-ruined', position: [1, 0, 0] },
      {
        type: 'npc',
        name: 'Guard',
        npcType: 'guard',
        position: [2, 0, 0],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ]))
    const states = room.objects.map((object) => visualRequestForObject(
      object,
      room.environmentKind,
    ))

    expect(states).toEqual([
      expect.objectContaining({
        semanticKey: 'object.chest.footlocker',
        family: 'container',
        environmentKind: 'ruins',
      }),
      expect.objectContaining({
        semanticKey: 'architecture.wall-ruined',
        family: 'architecture',
      }),
      expect.objectContaining({
        semanticKey: 'humanoid.guard',
        family: 'humanoid',
      }),
    ])
    expect(JSON.stringify(states)).not.toContain('.glb')
    expect(JSON.stringify(states)).not.toContain('/visual-packs/')
  })
})

describe('buildVisualObjects', () => {
  it('retains and instances hundreds of inexpensive static semantic objects', async () => {
    const objects = Array.from({ length: 500 }, (_, index) => ({
      id: 'rubble-' + index,
      type: 'clutter',
      kind: 'small-rubble',
      position: [(index % 25) - 12, 0, Math.floor(index / 25) - 10],
    }))
    const room = loadRoomSpec(roomEnvelope(objects))
    const assets = new FakeAssets()
    const built = await buildVisualObjects(room, { assets })

    const instances = built.group.children.filter(
      (node): node is THREE.InstancedMesh => (node as THREE.InstancedMesh).isInstancedMesh,
    )
    expect(room.objects).toHaveLength(500)
    expect(instances.length).toBeGreaterThan(0)
    expect(instances.reduce((count, mesh) => count + mesh.count, 0)).toBe(500)
    expect(built.renderPlan.instancedGroups.length).toBeGreaterThan(0)
    expect(built.group.getObjectByName('development-debug-visual')).toBeUndefined()
    built.dispose()
    expect(assets.activeLeases).toBe(0)
  })

  it('keeps reusable prototypes and renderer output free of invalid SkinnedMesh nodes', async () => {
    const assetId = 'object.crate.crate'
    const descriptor = ruinedKingdomPack.assets[assetId]!
    const reviewedRoot = new THREE.Group()
    reviewedRoot.name = descriptor.nodeName
    reviewedRoot.add(new THREE.SkinnedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
    ))
    const scene = new THREE.Group()
    scene.add(reviewedRoot)
    const loadAsync = vi.fn().mockResolvedValue({
      scene,
      scenes: [scene],
      animations: [],
      cameras: [],
      asset: { version: '2.0' },
      parser: {},
      userData: {},
    } as unknown as GLTF)
    const assets = new VisualAssetCache(ruinedKingdomPack, { loadAsync })
    const room = loadRoomSpec(roomEnvelope([
      { id: 'crate-a', type: 'crate', position: [-2, 0, 0] },
      { id: 'crate-b', type: 'crate', position: [2, 0, 0] },
    ]))

    const built = await buildVisualObjects(room, { assets })
    let invalidCount = 0
    built.group.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh && !isRenderValidSkinnedMesh(mesh)) invalidCount += 1
    })

    expect(loadAsync).toHaveBeenCalledTimes(1)
    expect(invalidCount).toBe(0)
    built.dispose()
    assets.teardown()
  })

  it('uses exact, family, environment, then neutral production load candidates', async () => {
    const room = loadRoomSpec(roomEnvelope([
      { id: 'locker', type: 'chest', variant: 'footlocker', position: [0, 0, 0] },
    ]))
    const assets = new FakeAssets(new Set(['object.chest.footlocker']))
    const built = await buildVisualObjects(room, { assets })

    expect(assets.attempted.slice(0, 2)).toEqual([
      'object.chest.footlocker',
      'family.container',
    ])
    expect(
      built.group.children.some((node) => (node as THREE.InstancedMesh).isInstancedMesh),
    ).toBe(true)
  })

  it('never displays debug geometry in production when all production fallbacks fail', async () => {
    const room = loadRoomSpec(roomEnvelope([
      { type: 'clutter', kind: 'sack', position: [0, 0, 0] },
    ]))
    await expect(buildVisualObjects(room, {
      assets: new FakeAssets(undefined, true),
      allowDebug: false,
    })).rejects.toEqual(new VisualPackUnavailableError())
  })

  it('permits the explicit debug marker only through trusted development configuration', async () => {
    const room = loadRoomSpec(roomEnvelope([
      { type: 'clutter', kind: 'sack', position: [0, 0, 0] },
    ]))
    const built = await buildVisualObjects(room, {
      assets: new FakeAssets(undefined, true),
      allowDebug: true,
    })
    expect(built.group.getObjectByName('development-debug-visual')).toBeDefined()
  })

  it('keeps interactive/stateful objects unique instead of instancing them', async () => {
    const room = loadRoomSpec(roomEnvelope([
      {
        id: 'first',
        type: 'chest',
        position: [-1, 0, 0],
        interaction: { key: 'E', prompt: 'Search', effect: { kind: 'inspect' } },
      },
      {
        id: 'second',
        type: 'chest',
        position: [1, 0, 0],
        interaction: { key: 'E', prompt: 'Search', effect: { kind: 'inspect' } },
      },
    ]))
    const states = projectRoomObjectPresentationStates({
      room,
      resolvedObjectIds: new Set(['first']),
    })
    const built = await buildVisualObjects(room, {
      assets: new FakeAssets(),
      presentationStates: states,
    })

    expect(built.group.children.some((node) => (node as THREE.InstancedMesh).isInstancedMesh))
      .toBe(false)
    expect(built.group.children.filter((node) => node.userData.objectType === 'chest'))
      .toHaveLength(2)
  })

  it('updates visible object parts live without rebuilding the room', async () => {
    const room = loadRoomSpec(roomEnvelope([
      {
        id: 'coffer',
        type: 'chest',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Open', effect: { kind: 'inspect' } },
      },
    ]))
    const initial = projectRoomObjectPresentationStates({ room })
    const built = await buildVisualObjects(room, {
      assets: new FakeAssets(),
      presentationStates: initial,
    })
    const lid = built.group.getObjectByName('state-lid')!
    expect(lid.rotation.x).toBe(0)
    const namespacedLid = built.group.children[0]!.getObjectByName(
      'object.chest.treasure-chest:state-lid',
    )!
    expect(namespacedLid.rotation.x).toBe(0)

    const resolved = projectRoomObjectPresentationStates({
      room,
      resolvedObjectIds: new Set(['coffer']),
    })
    updateBuiltObjectPresentationStates(built.group, resolved)

    expect(lid.rotation.x).toBeCloseTo(-1.15)
    expect(namespacedLid.rotation.x).toBeCloseTo(-1.15)
    expect(built.group.children.find((node) => node.userData.objectId === 'coffer'))
      .toBeDefined()
  })

  it('preserves an open exit collision gap', async () => {
    const room = loadRoomSpec(roomEnvelope([
      {
        id: 'exit',
        type: 'arch',
        variant: 'iron-gate',
        width: 3,
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'next' } },
      },
    ]))
    const built = await buildVisualObjects(room, { assets: new FakeAssets() })
    const movement = built.collisionWorld.moveCircle(
      { x: 0, z: 2 },
      { x: 0, z: -4 },
      0.3,
    )
    expect(movement.collided).toBe(false)
  })

  it('honors nonblocking collision profiles for low remains', async () => {
    const room = loadRoomSpec(roomEnvelope([
      { type: 'corpse', variant: 'body', position: [0, 0, 0] },
    ]))
    const built = await buildVisualObjects(room, { assets: new FakeAssets() })
    expect(built.collisionWorld.size).toBe(0)
    const movement = built.collisionWorld.moveCircle(
      { x: 0, z: 2 },
      { x: 0, z: -4 },
      0.3,
    )
    expect(movement.collided).toBe(false)
    built.dispose()
  })

  it('creates trusted unshadowed local lights and degrades them to emissive-only', async () => {
    const room = loadRoomSpec(roomEnvelope([
      { type: 'light-fixture', kind: 'brazier', position: [0, 0, 0] },
    ]))
    const lit = await buildVisualObjects(room, { assets: new FakeAssets() })
    const point = lit.group.getObjectByName('visual-pack-local-light') as THREE.PointLight
    expect(point).toBeInstanceOf(THREE.PointLight)
    expect(point.castShadow).toBe(false)
    lit.dispose()

    const emissiveOnly = await buildVisualObjects(room, {
      assets: new FakeAssets(),
      renderBudget: { ...BALANCED_RENDER_BUDGET, localLights: 0 },
    })
    expect(emissiveOnly.renderPlan.degradations).toContainEqual({
      candidateId: 'light-fixture#0',
      kind: 'emissive-only-light',
    })
    expect(emissiveOnly.group.getObjectByName('visual-pack-local-light')).toBeUndefined()
    emissiveOnly.dispose()
  })

  it('disposes room-owned interaction indicators while releasing shared leases once', async () => {
    const assets = new FakeAssets()
    const room = loadRoomSpec(roomEnvelope([
      {
        id: 'coffer',
        type: 'chest',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Open', effect: { kind: 'inspect' } },
      },
    ]))
    const built = await buildVisualObjects(room, { assets })
    const ring = built.group.getObjectByName('interactable-indicator') as THREE.Mesh
    let geometryDisposed = false
    const disposeGeometry = ring.geometry.dispose.bind(ring.geometry)
    ring.geometry.dispose = () => {
      geometryDisposed = true
      disposeGeometry()
    }

    built.dispose()
    built.dispose()

    expect(geometryDisposed).toBe(true)
    expect(assets.activeLeases).toBe(0)
    expect(built.group.children).toHaveLength(0)
  })
  it('caps static collision bodies by weight without dropping visible objects', async () => {
    const objects = Array.from({ length: 600 }, (_, index) => ({
      id: 'chair-' + index,
      type: 'furniture',
      kind: 'chair',
      position: [(index % 30) - 15, 0, Math.floor(index / 30) - 10],
    }))
    const room = loadRoomSpec(roomEnvelope(objects))
    const assets = new FakeAssets()
    const budget: RenderBudget = { ...BALANCED_RENDER_BUDGET, staticCollisionBodies: 512 }
    const built = await buildVisualObjects(room, {
      assets,
      renderBudget: budget,
    })
    expect(room.objects).toHaveLength(600)
    expect(built.collisionWorld.size).toBe(512)
    expect(
      built.group.children
        .filter((node): node is THREE.InstancedMesh => (node as THREE.InstancedMesh).isInstancedMesh)
        .reduce((sum, node) => sum + node.count, 0),
    ).toBe(600)
    expect(assets.attempted).toHaveLength(1)
  }, 15_000)
})

class FakeAssets implements VisualAssetProvider {
  readonly attempted: string[] = []
  activeLeases = 0
  private readonly geometries = new Map<string, THREE.BufferGeometry>()
  private readonly materials = new Map<string, THREE.Material>()
  private readonly failing: ReadonlySet<string>
  private readonly failAll: boolean

  constructor(
    failing: ReadonlySet<string> = new Set(),
    failAll = false,
  ) {
    this.failing = failing
    this.failAll = failAll
  }

  async acquire(assetId: string): Promise<VisualAssetLease> {
    this.attempted.push(assetId)
    if (this.failAll || this.failing.has(assetId)) throw new Error('fixed-test-failure')
    const descriptor = ruinedKingdomPack.assets[assetId]
    if (!descriptor) throw new Error('unknown-test-asset')
    const geometry = this.geometries.get(assetId) ?? new THREE.TetrahedronGeometry(0.5)
    const material = this.materials.get(assetId)
      ?? new THREE.MeshStandardMaterial({ color: '#78634d' })
    this.geometries.set(assetId, geometry)
    this.materials.set(assetId, material)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.userData.visualPackSharedResource = true
    const instance = new THREE.Group()
    instance.name = assetId
    instance.add(mesh)
    for (const name of [
      'state-lid',
      'state-door',
      'state-lock',
      'state-contents',
      'state-looted',
      'state-read',
      'state-activated',
      'condition-damaged',
      'condition-burned',
      'condition-overgrown',
      'condition-weathered',
    ]) {
      const part = new THREE.Object3D()
      part.name = name
      instance.add(part)
      if (name === 'state-lid') {
        const namespacedPart = new THREE.Object3D()
        namespacedPart.name = assetId + ':' + name
        instance.add(namespacedPart)
      }
    }
    this.activeLeases += 1
    let released = false
    return {
      assetId,
      descriptor,
      instance,
      animations: [],
      release: () => {
        if (released) return
        released = true
        this.activeLeases -= 1
      },
    }
  }
}

function roomEnvelope(objects: unknown[]): unknown {
  return {
    schemaVersion: 1,
    id: 'visual-build-test',
    name: 'Visual Build Test',
    environmentKind: 'ruins',
    shell: {
      dimensions: { width: 80, depth: 80, height: 6 },
      exits: [],
    },
    spawn: { position: [0, 1.7, 5] },
    objects,
  }
}
  it('uses thin rotated wall colliders and leaves floors, roofs, and vegetation nonblocking', async () => {
    const room = loadRoomSpec(roomEnvelope([
      {
        id: 'wall', type: 'architecture', kind: 'wall-straight',
        position: [0, 0, 0], rotationY: 90, scale: 2, size: [4, 3, 0.4],
      },
      { id: 'floor', type: 'architecture', kind: 'floor-section', position: [0, 0, 3] },
      { id: 'roof', type: 'architecture', kind: 'roof', position: [0, 3, 3] },
      { id: 'fern', type: 'vegetation', kind: 'fern', position: [2, 0, 3] },
    ]))
    const built = await buildVisualObjects(room, { assets: new FakeAssets() })
    const wall = built.collisionWorld.snapshot().find((collider) => collider.id === 'wall')

    expect(wall).toEqual({
      id: 'wall',
      kind: 'box',
      center: { x: 0, z: 0 },
      halfExtents: [4, 0.4],
      rotationY: Math.PI / 2,
    })
    expect(built.collisionWorld.size).toBe(1)
    built.dispose()
  })

  it('keeps table and container footprints bounded in local RoomSpec space', async () => {
    const room = loadRoomSpec(roomEnvelope([
      // Off the room-center reachability target: sitting a blocking collider
      // exactly on (0, 0) would make reachability repair remove it.
      { id: 'table', type: 'furniture', kind: 'table', position: [6, 0, 6], size: [2, 1, 1] },
      { id: 'crate', type: 'crate', position: [10, 0, 6], scale: 1.5 },
    ]))
    const built = await buildVisualObjects(room, { assets: new FakeAssets() })
    const colliders = new Map(built.collisionWorld.snapshot().map((collider) => [collider.id, collider]))

    expect(colliders.get('table')).toMatchObject({
      kind: 'box', halfExtents: [1.1, 0.45], rotationY: 0,
    })
    expect(colliders.get('crate')).toMatchObject({
      kind: 'box', halfExtents: [0.75, 0.75], rotationY: 0,
    })
    built.dispose()
  })

  it('removes the solid gate collider when authoritative presentation is open', async () => {
    const room = loadRoomSpec(roomEnvelope([
      { id: 'gate', type: 'architecture', kind: 'gate', position: [0, 0, 0], size: [3, 3, 0.4] },
    ]))
    const closed = await buildVisualObjects(room, {
      assets: new FakeAssets(),
      presentationStates: new Map([['gate', {
        condition: 'intact', interactionState: 'closed', resolved: false,
      }]]),
    })
    const open = await buildVisualObjects(room, {
      assets: new FakeAssets(),
      presentationStates: new Map([['gate', {
        condition: 'intact', interactionState: 'open', resolved: true,
      }]]),
    })

    expect(closed.collisionWorld.snapshot()).toHaveLength(1)
    expect(open.collisionWorld.snapshot()).toHaveLength(2)
    expect(open.collisionWorld.moveCircle({ x: 0, z: 2 }, { x: 0, z: -4 }, 0.3).collided)
      .toBe(false)
    closed.dispose()
    open.dispose()
  })


it('updates gate collision live with the authoritative presentation state', async () => {
  const room = loadRoomSpec(roomEnvelope([
    { id: 'gate', type: 'architecture', kind: 'gate', position: [0, 0, 0], size: [3, 3, 0.4] },
  ]))
  const built = await buildVisualObjects(room, {
    assets: new FakeAssets(),
    presentationStates: new Map([['gate', {
      condition: 'intact', interactionState: 'closed', resolved: false,
    }]]),
  })
  expect(built.collisionWorld.snapshot()).toHaveLength(1)
  built.updateCollisionPresentationStates?.(new Map([['gate', {
    condition: 'intact', interactionState: 'open', resolved: true,
  }]]))
  expect(built.collisionWorld.snapshot()).toHaveLength(2)
  expect(built.collisionWorld.moveCircle({ x: 0, z: 2 }, { x: 0, z: -4 }, 0.3).collided)
    .toBe(false)
  built.dispose()
})

it('keeps every showcase target reachable in its final collision world', async () => {
  for (const showcase of Object.values(ruinedKingdomShowcases)) {
    const built = await buildVisualObjects(loadRoomSpec(showcase), { assets: new FakeAssets() })
    expect(built.reachability.reachableTargetCount).toBe(built.reachability.targetCount)
    expect(built.reachability.spawnRepaired).toBe(false)
    built.dispose()
  }
})

it('repairs an unreachable decorative furniture barrier without removing its visuals', async () => {
  const room = loadRoomSpec({
    schemaVersion: 1, id: 'decorative-barrier', name: 'Decorative barrier', environmentKind: 'tavern',
    shell: { dimensions: { width: 12, depth: 12, height: 4 }, exits: [] },
    spawn: { position: [0, 1.7, 4], yaw: 180 },
    objects: [-4, 0, 4].map((x) => ({
      id: 'table-' + x, type: 'furniture' as const, kind: 'table' as const,
      position: [x, 0, 1] as [number, number, number], size: [4, 1, 1] as [number, number, number],
    })),
  })
  const built = await buildVisualObjects(room, { assets: new FakeAssets() })
  expect(built.reachability.reachableTargetCount).toBe(built.reachability.targetCount)
  expect(built.reachability.repairedColliderCount).toBeGreaterThan(0)
  expect(built.group.children.length).toBeGreaterThan(0)
  built.dispose()
})

describe('reachability repair (bounded deterministic removal)', () => {
  it('removes only the collider actually blocking a target, leaving unrelated removable objects solid', async () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'repair-single-blocker', name: 'Repair Single Blocker', environmentKind: 'tavern',
      shell: { dimensions: { width: 12, depth: 12, height: 4 }, exits: [] },
      spawn: { position: [0, 1.7, 4], yaw: 180 },
      objects: [
        // South of spawn: never on the path to the room-center target.
        { id: 'decoy-left', type: 'furniture', kind: 'table', position: [-4, 0, 5], size: [1, 1, 1] },
        { id: 'decoy-right', type: 'furniture', kind: 'table', position: [4, 0, 5], size: [1, 1, 1] },
        // Oversized so it seals the full walkable width between spawn and center.
        { id: 'blocker', type: 'furniture', kind: 'table', position: [0, 0, 1], size: [12, 1, 1] },
      ],
    })
    const built = await buildVisualObjects(room, { assets: new FakeAssets() })

    expect(built.reachability.reachableTargetCount).toBe(built.reachability.targetCount)
    expect([...built.reachability.repairedColliderKeys]).toEqual(['blocker'])
    const ids = new Set(built.collisionWorld.snapshot().map((collider) => collider.id))
    expect(ids.has('blocker')).toBe(false)
    expect(ids.has('decoy-left')).toBe(true)
    expect(ids.has('decoy-right')).toBe(true)
    built.dispose()
  })

  it('removes a jointly-blocking pair only when neither collider alone restores reachability', async () => {
    const built = await buildVisualObjects(seriesBlockerRoom(), { assets: new FakeAssets() })

    expect(built.reachability.reachableTargetCount).toBe(built.reachability.targetCount)
    expect([...built.reachability.repairedColliderKeys].sort())
      .toEqual(['blocker-back', 'blocker-front'])
    const ids = new Set(built.collisionWorld.snapshot().map((collider) => collider.id))
    expect(ids.has('blocker-front')).toBe(false)
    expect(ids.has('blocker-back')).toBe(false)
    expect(ids.has('decoy')).toBe(true)
    built.dispose()
  })

  it('never removes a non-removable wall, leaving unrelated collision solid and unresolved reachability reported', async () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'repair-protected-wall', name: 'Repair Protected Wall', environmentKind: 'crypt',
      shell: { dimensions: { width: 12, depth: 12, height: 4 }, exits: [] },
      spawn: { position: [0, 1.7, 5], yaw: 180 },
      objects: [
        // Full-width, north of the room-center target: protected architecture.
        { id: 'wall', type: 'architecture', kind: 'wall-straight', position: [0, 0, -1], size: [12, 3, 0.4] },
        // Beyond the wall: an interaction target repair must not fabricate a path to.
        {
          id: 'watcher', type: 'npc', name: 'Watcher', npcType: 'guard', position: [0, 0, -4],
          interaction: { key: 'F', prompt: 'Talk' },
        },
        // South of spawn: unrelated, must remain solid regardless of outcome.
        { id: 'decoy', type: 'furniture', kind: 'table', position: [3, 0, 4], size: [1, 1, 1] },
      ],
    })
    const built = await buildVisualObjects(room, { assets: new FakeAssets() })

    expect(built.reachability.targetCount).toBe(2)
    expect(built.reachability.reachableTargetCount).toBe(1)
    expect(built.reachability.repairedColliderKeys.size).toBe(0)
    const ids = new Set(built.collisionWorld.snapshot().map((collider) => collider.id))
    expect(ids.has('wall')).toBe(true)
    expect(ids.has('decoy')).toBe(true)
    built.dispose()
  })

  it('produces the same repaired collider keys across repeated deterministic builds', async () => {
    const first = await buildVisualObjects(seriesBlockerRoom(), { assets: new FakeAssets() })
    const second = await buildVisualObjects(seriesBlockerRoom(), { assets: new FakeAssets() })

    expect([...first.reachability.repairedColliderKeys].sort())
      .toEqual([...second.reachability.repairedColliderKeys].sort())
    first.dispose()
    second.dispose()
  })
})

describe('reachability repair preserved across presentation updates', () => {
  it('does not restore a repaired collider when an unrelated object state changes', async () => {
    const room = loadRoomSpec({
      schemaVersion: 1, id: 'repair-preserved', name: 'Repair Preserved', environmentKind: 'tavern',
      shell: { dimensions: { width: 12, depth: 12, height: 4 }, exits: [] },
      spawn: { position: [0, 1.7, 4], yaw: 180 },
      objects: [
        { id: 'blocker', type: 'furniture', kind: 'table', position: [0, 0, 1], size: [12, 1, 1] },
        {
          id: 'loot-chest', type: 'chest', position: [-4, 0, 4],
          interaction: { key: 'E', prompt: 'Open', effect: { kind: 'inspect' } },
        },
      ],
    })
    const initialStates = projectRoomObjectPresentationStates({ room })
    const built = await buildVisualObjects(room, {
      assets: new FakeAssets(),
      presentationStates: initialStates,
    })

    expect(built.reachability.repairedColliderKeys.has('blocker')).toBe(true)
    expect(built.collisionWorld.snapshot().some((collider) => collider.id === 'blocker')).toBe(false)
    expect(built.collisionWorld.snapshot().filter((collider) => collider.id === 'loot-chest'))
      .toHaveLength(1)

    const lootedStates = projectRoomObjectPresentationStates({
      room, resolvedObjectIds: new Set(['loot-chest']),
    })
    built.updateCollisionPresentationStates?.(lootedStates)

    expect(built.collisionWorld.snapshot().some((collider) => collider.id === 'blocker')).toBe(false)
    expect(built.collisionWorld.snapshot().filter((collider) => collider.id === 'loot-chest'))
      .toHaveLength(1)
    built.dispose()
  })

  it('updates only gate collision live and stays idempotent across repeated identical updates', async () => {
    const room = loadRoomSpec(roomEnvelope([
      { id: 'gate', type: 'architecture', kind: 'gate', position: [0, 0, 0], size: [3, 3, 0.4] },
      {
        id: 'chest', type: 'chest', position: [4, 0, 0],
        interaction: { key: 'E', prompt: 'Open', effect: { kind: 'inspect' } },
      },
    ]))
    const built = await buildVisualObjects(room, {
      assets: new FakeAssets(),
      presentationStates: new Map([
        ['gate', { condition: 'intact' as const, interactionState: 'closed' as const, resolved: false }],
        ['chest', { condition: 'intact' as const, interactionState: 'closed' as const, resolved: false }],
      ]),
    })
    expect(built.collisionWorld.snapshot()).toHaveLength(2)

    const openStates = new Map([
      ['gate', { condition: 'intact' as const, interactionState: 'open' as const, resolved: true }],
      ['chest', { condition: 'intact' as const, interactionState: 'looted' as const, resolved: true }],
    ])
    built.updateCollisionPresentationStates?.(openStates)
    const afterOpen = built.collisionWorld.snapshot()
    expect(afterOpen).toHaveLength(3) // gate opens into two posts; chest collider is untouched
    expect(afterOpen.filter((collider) => collider.id === 'chest')).toHaveLength(1)

    built.updateCollisionPresentationStates?.(openStates)
    expect(built.collisionWorld.snapshot()).toEqual(afterOpen)

    const closedAgain = new Map([
      ['gate', { condition: 'intact' as const, interactionState: 'closed' as const, resolved: false }],
      ['chest', { condition: 'intact' as const, interactionState: 'looted' as const, resolved: true }],
    ])
    built.updateCollisionPresentationStates?.(closedAgain)
    expect(built.collisionWorld.snapshot()).toHaveLength(2)
    expect(built.collisionWorld.snapshot().filter((collider) => collider.id === 'chest')).toHaveLength(1)
    built.dispose()
  })
})

describe('legacy visual/collider footprint alignment', () => {
  it('scales legacy object colliders by object.scale only, ignoring render-inert authored size', async () => {
    const room = loadRoomSpec(roomEnvelope([
      // z=6, behind spawn (z=5) relative to the room-center target: none of
      // these ever block it, so reachability repair never touches them.
      { id: 'table-default', type: 'table', position: [0, 0, 6] },
      { id: 'table-oversized', type: 'table', position: [6, 0, 6], size: [40, 40, 40] },
      { id: 'table-scaled', type: 'table', position: [12, 0, 6], scale: 2 },
      { id: 'chest-a', type: 'chest', position: [-6, 0, 6] },
      { id: 'throne-a', type: 'throne', position: [-12, 0, 6] },
    ]))
    const built = await buildVisualObjects(room, { assets: new FakeAssets() })
    const colliders = new Map(built.collisionWorld.snapshot().map((collider) => [collider.id, collider]))

    expect(colliders.get('table-default')).toMatchObject({
      kind: 'box', halfExtents: [0.9, 0.55], rotationY: 0,
    })
    // Authored `size` never scales the legacy mesh (only object.scale does), so
    // an oversized `size` must not inflate the collider beyond the art footprint.
    expect(colliders.get('table-oversized')).toMatchObject({
      kind: 'box', halfExtents: [0.9, 0.55], rotationY: 0,
    })
    // object.scale applies exactly once.
    expect(colliders.get('table-scaled')).toMatchObject({
      kind: 'box', halfExtents: [1.8, 1.1], rotationY: 0,
    })
    expect(colliders.get('chest-a')).toMatchObject({
      kind: 'box', halfExtents: [0.6, 0.38], rotationY: 0,
    })
    expect(colliders.get('throne-a')).toMatchObject({
      kind: 'box', halfExtents: [0.75, 0.65], rotationY: 0,
    })
    built.dispose()
  })
})

describe('bounded asset-fallback diagnostic', () => {
  it('emits exactly one safe, deduplicated diagnostic when exact acquisition fails and a fallback succeeds', async () => {
    const room = loadRoomSpec(roomEnvelope([
      { id: 'locker-1', type: 'chest', variant: 'footlocker', position: [0, 0, 6] },
      { id: 'locker-2', type: 'chest', variant: 'footlocker', position: [2, 0, 6] },
    ]))
    const assets = new FakeAssets(new Set(['object.chest.footlocker']))
    const warn = vi.fn()
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(),
      child: () => logger,
    }
    const built = await buildVisualObjects(room, { assets, logger })

    // Both objects render (no interaction, so they instance into one shared
    // mesh rather than staying as separately tagged nodes) and the exact
    // asset was genuinely attempted before the fallback resolved.
    expect(built.group.children.length).toBeGreaterThan(0)
    expect(assets.attempted).toContain('object.chest.footlocker')
    expect(warn).toHaveBeenCalledTimes(1)
    const [message, context] = warn.mock.calls[0]!
    expect(message).toBe('visual pack asset fallback')
    expect(context).toMatchObject({ assetId: 'object.chest.footlocker', code: 'unknown' })
    const serialized = JSON.stringify(context)
    expect(serialized).not.toMatch(/\.glb|\/visual-packs\/|fixed-test-failure/)
    built.dispose()
  })

  it('never emits a diagnostic when the exact asset is acquired directly', async () => {
    const room = loadRoomSpec(roomEnvelope([
      { id: 'locker', type: 'chest', variant: 'footlocker', position: [0, 0, 6] },
    ]))
    const warn = vi.fn()
    const logger: Logger = {
      debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(),
      child: () => logger,
    }
    const built = await buildVisualObjects(room, { assets: new FakeAssets(), logger })

    expect(warn).not.toHaveBeenCalled()
    built.dispose()
  })
})

/** A wall-width blocker in series with a second: neither alone reopens the path. */
function seriesBlockerRoom(): ReturnType<typeof loadRoomSpec> {
  return loadRoomSpec({
    schemaVersion: 1, id: 'repair-series-blockers', name: 'Repair Series Blockers', environmentKind: 'tavern',
    shell: { dimensions: { width: 12, depth: 16, height: 4 }, exits: [] },
    spawn: { position: [0, 1.7, 6], yaw: 180 },
    objects: [
      { id: 'blocker-front', type: 'furniture', kind: 'table', position: [0, 0, 3], size: [12, 1, 1] },
      { id: 'blocker-back', type: 'furniture', kind: 'table', position: [0, 0, 1], size: [12, 1, 1] },
      // South of spawn: never on the path to the room-center target.
      { id: 'decoy', type: 'furniture', kind: 'table', position: [-4, 0, 7], size: [1, 1, 1] },
    ],
  })
}
