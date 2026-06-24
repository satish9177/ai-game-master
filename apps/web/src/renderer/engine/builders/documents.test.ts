import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import type { RoomObject } from '../../../domain/roomSpec'
import type { Logger } from '../../../platform/logger/Logger'
import { buildObjects } from './index'
import { buildBook, buildMap, buildPaper } from './documents'

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

const book = (): ObjectOf<'book'> => ({
  type: 'book', position: [0, 0, 0], rotationY: 0, scale: 1,
  size: [0.7, 0.14, 0.5], coverColor: '#6b3f2a', pageColor: '#e8dcb5',
})
const paper = (): ObjectOf<'paper'> => ({
  type: 'paper', position: [0, 0, 0], rotationY: 0, scale: 1,
  size: [0.8, 0.6], color: '#e8dcb5',
})
const map = (): ObjectOf<'map'> => ({
  type: 'map', position: [0, 0, 0], rotationY: 0, scale: 1,
  size: [1.4, 0.9], color: '#d6c28e', markColor: '#8a3f2f',
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
  ['book', () => buildBook(book())],
  ['paper', () => buildPaper(paper())],
  ['map', () => buildMap(map())],
]

describe('document builders', () => {
  it.each(builders)('%s is deterministic and floor-anchored', (_name, build) => {
    const first = build()
    expect(signature(first)).toEqual(signature(build()))
    expect(meshes(first).length).toBeGreaterThan(0)
    expect(new THREE.Box3().setFromObject(first).min.y).toBeGreaterThanOrEqual(-1e-9)
  })

  it.each(builders)('%s stays bounded and contains no text/sprite objects', (_name, build) => {
    const object = build()
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
    expect(size.x).toBeLessThanOrEqual(1.5)
    expect(size.z).toBeLessThanOrEqual(1)
    object.traverse((node) => expect((node as THREE.Sprite).isSprite).not.toBe(true))
  })

  it('book, paper, and map have distinct procedural geometry', () => {
    expect(meshes(buildBook(book())).length).not.toBe(meshes(buildPaper(paper())).length)
    expect(meshes(buildMap(map())).length).toBeGreaterThan(meshes(buildPaper(paper())).length)
  })
})

describe('document interaction affordance', () => {
  function roomWith(objects: RoomObject[]): LoadedRoom {
    return { objects, skipped: [] } as unknown as LoadedRoom
  }

  it('adds the existing ring only to an interactable document', () => {
    const interactiveMap: ObjectOf<'map'> = {
      ...map(),
      position: [2, 0, -3],
      interaction: { key: 'E', prompt: 'Study map', body: 'Fixed validated body.' },
    }
    const built = buildObjects(roomWith([interactiveMap, paper()]), noopLogger)
    const rings = built.children.filter((node) => node.name === 'interactable-indicator')
    expect(rings).toHaveLength(1)
    expect(rings[0]!.position.x).toBe(2)
    expect(rings[0]!.position.z).toBe(-3)
  })
})
