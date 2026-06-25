import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import type { RoomObject } from '../../../domain/roomSpec'
import type { Logger } from '../../../platform/logger/Logger'
import { buildObjects } from './index'
import { buildChest, buildCorpse, buildTable } from './practicalProps'

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

const chest = (): ObjectOf<'chest'> => ({
  type: 'chest', position: [0, 0, 0], rotationY: 0, scale: 1,
  size: [1.2, 0.8, 0.75], color: '#6b4a2e', trimColor: '#3a2518', latchColor: '#b88a3c',
})
const corpse = (): ObjectOf<'corpse'> => ({
  type: 'corpse', position: [0, 0, 0], rotationY: 0, scale: 1,
  size: [0.75, 0.24, 1.75], color: '#5a5148', clothColor: '#4f5f4a',
})
const table = (): ObjectOf<'table'> => ({
  type: 'table', position: [0, 0, 0], rotationY: 0, scale: 1,
  size: [1.8, 0.9, 1.1], color: '#6b4a2e',
})

const noopLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {}, child() { return noopLogger },
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) found.push(node as THREE.Mesh)
  })
  return found
}

function signature(root: THREE.Object3D): unknown[] {
  return meshes(root).map((mesh) => ({
    geometry: mesh.geometry.type,
    position: mesh.position.toArray(),
    rotation: mesh.rotation.toArray(),
  }))
}

const builders: [string, () => THREE.Object3D][] = [
  ['chest', () => buildChest(chest())],
  ['corpse', () => buildCorpse(corpse())],
  ['table', () => buildTable(table())],
]

describe('practical prop builders', () => {
  it.each(builders)('%s is deterministic and floor-anchored', (_name, build) => {
    const first = build()
    expect(signature(first)).toEqual(signature(build()))
    expect(meshes(first).length).toBeGreaterThan(0)
    expect(new THREE.Box3().setFromObject(first).min.y).toBeGreaterThanOrEqual(-1e-7)
  })

  it.each(builders)('%s stays bounded and contains no text/sprite objects', (_name, build) => {
    const object = build()
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
    expect(size.x).toBeLessThanOrEqual(2.05)
    expect(size.z).toBeLessThanOrEqual(1.95)
    object.traverse((node) => expect((node as THREE.Sprite).isSprite).not.toBe(true))
  })

  it('chest, corpse, and table have distinct procedural geometry', () => {
    expect(signature(buildChest(chest()))).not.toEqual(signature(buildCorpse(corpse())))
    expect(signature(buildTable(table()))).not.toEqual(signature(buildChest(chest())))
  })
})

describe('practical prop interaction affordance', () => {
  function roomWith(objects: RoomObject[]): LoadedRoom {
    return { objects, skipped: [] } as unknown as LoadedRoom
  }

  it('adds the existing ring only to an interactable practical prop', () => {
    const interactiveChest: ObjectOf<'chest'> = {
      ...chest(),
      position: [2, 0, -3],
      interaction: { key: 'E', prompt: 'Open chest', body: 'Validated body.' },
    }
    const built = buildObjects(roomWith([interactiveChest, table()]), noopLogger)
    const rings = built.children.filter((node) => node.name === 'interactable-indicator')
    expect(rings).toHaveLength(1)
    expect(rings[0]!.position.x).toBe(2)
    expect(rings[0]!.position.z).toBe(-3)
  })
})
