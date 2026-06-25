import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import type { RoomObject } from '../../../domain/roomSpec'
import type { Logger } from '../../../platform/logger/Logger'
import { buildObjects } from './index'
import { buildAltar, buildStatue } from './storyAnchors'

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

const altar = (): ObjectOf<'altar'> => ({
  type: 'altar', position: [0, 0, 0], rotationY: 0, scale: 1,
  size: [1.8, 1, 1.1], color: '#8a8172', accentColor: '#c4a15a',
})
const statue = (): ObjectOf<'statue'> => ({
  type: 'statue', position: [0, 0, 0], rotationY: 0, scale: 1,
  radius: 0.45, height: 2.2, color: '#b8b0a2', pedestalColor: '#777066',
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
  ['altar', () => buildAltar(altar())],
  ['statue', () => buildStatue(statue())],
]

describe('story anchor builders', () => {
  it.each(builders)('%s is deterministic and floor-anchored', (_name, build) => {
    const first = build()
    expect(signature(first)).toEqual(signature(build()))
    expect(meshes(first).length).toBeGreaterThan(0)
    expect(new THREE.Box3().setFromObject(first).min.y).toBeGreaterThanOrEqual(-1e-7)
  })

  it.each(builders)('%s stays bounded and contains no text/sprite objects', (_name, build) => {
    const object = build()
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
    expect(size.x).toBeLessThanOrEqual(2)
    expect(size.z).toBeLessThanOrEqual(1.4)
    expect(size.y).toBeLessThanOrEqual(2.8)
    object.traverse((node) => expect((node as THREE.Sprite).isSprite).not.toBe(true))
  })

  it('altar and statue have distinct procedural geometry', () => {
    expect(signature(buildAltar(altar()))).not.toEqual(signature(buildStatue(statue())))
  })
})

describe('story anchor interaction affordance', () => {
  function roomWith(objects: RoomObject[]): LoadedRoom {
    return { objects, skipped: [] } as unknown as LoadedRoom
  }

  it('adds the existing ring only to an interactable story anchor', () => {
    const interactiveStatue: ObjectOf<'statue'> = {
      ...statue(),
      position: [2, 0, -3],
      interaction: { key: 'E', prompt: 'Inspect statue', body: 'Validated body.' },
    }
    const built = buildObjects(roomWith([interactiveStatue, altar()]), noopLogger)
    const rings = built.children.filter((node) => node.name === 'interactable-indicator')
    expect(rings).toHaveLength(1)
    expect(rings[0]!.position.x).toBe(2)
    expect(rings[0]!.position.z).toBe(-3)
  })
})
