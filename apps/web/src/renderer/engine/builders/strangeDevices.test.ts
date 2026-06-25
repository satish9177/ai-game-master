import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import type { RoomObject } from '../../../domain/roomSpec'
import type { Logger } from '../../../platform/logger/Logger'
import { buildObjects } from './index'
import { buildArtifact, buildCandle, buildMachine } from './strangeDevices'

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

const machine = (): ObjectOf<'machine'> => ({
  type: 'machine', position: [0, 0, 0], rotationY: 0, scale: 1,
  size: [1.6, 1.2, 1], color: '#4f5558', panelColor: '#2f3638', pipeColor: '#6f665c',
})
const artifact = (): ObjectOf<'artifact'> => ({
  type: 'artifact', position: [0, 0, 0], rotationY: 0, scale: 1,
  radius: 0.35, height: 0.9, baseColor: '#4b4540', crystalColor: '#78d6c6',
})
const candle = (): ObjectOf<'candle'> => ({
  type: 'candle', position: [0, 0, 0], rotationY: 0, scale: 1,
  radius: 0.09, height: 0.22, waxColor: '#f1e3c0', flameColor: '#ffb347',
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

function pointLights(root: THREE.Object3D): THREE.PointLight[] {
  const found: THREE.PointLight[] = []
  root.traverse((node) => {
    if ((node as THREE.PointLight).isPointLight) found.push(node as THREE.PointLight)
  })
  return found
}

const builders: [string, () => THREE.Object3D][] = [
  ['machine', () => buildMachine(machine())],
  ['artifact', () => buildArtifact(artifact())],
  ['candle', () => buildCandle(candle())],
]

describe('strange/device/light builders', () => {
  it.each(builders)('%s is deterministic and floor-anchored', (_name, build) => {
    const first = build()
    expect(signature(first)).toEqual(signature(build()))
    expect(meshes(first).length).toBeGreaterThan(0)
    expect(new THREE.Box3().setFromObject(first).min.y).toBeGreaterThanOrEqual(-1e-7)
  })

  it.each(builders)('%s stays bounded and contains no text/sprite objects', (_name, build) => {
    const object = build()
    const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
    expect(size.x).toBeLessThanOrEqual(1.8)
    expect(size.z).toBeLessThanOrEqual(1.3)
    expect(size.y).toBeLessThanOrEqual(1.4)
    object.traverse((node) => expect((node as THREE.Sprite).isSprite).not.toBe(true))
  })

  it('machine, artifact, and candle have distinct procedural geometry', () => {
    expect(signature(buildMachine(machine()))).not.toEqual(signature(buildArtifact(artifact())))
    expect(signature(buildCandle(candle()))).not.toEqual(signature(buildArtifact(artifact())))
  })

  it('candle uses emissive meshes without creating a PointLight', () => {
    const built = buildCandle(candle())
    expect(pointLights(built)).toEqual([])
    expect(meshes(built).some((mesh) => {
      const material = mesh.material
      return material instanceof THREE.MeshStandardMaterial && material.emissiveIntensity > 0
    })).toBe(true)
  })
})

describe('strange/device interaction affordance', () => {
  function roomWith(objects: RoomObject[]): LoadedRoom {
    return { objects, skipped: [] } as unknown as LoadedRoom
  }

  it('adds the existing ring only to interactable machine/artifact objects', () => {
    const interactiveMachine: ObjectOf<'machine'> = {
      ...machine(),
      position: [2, 0, -3],
      interaction: { key: 'E', prompt: 'Inspect machine', body: 'Validated body.' },
    }
    const interactiveArtifact: ObjectOf<'artifact'> = {
      ...artifact(),
      position: [-2, 0, -3],
      interaction: { key: 'E', prompt: 'Inspect artifact', body: 'Validated body.' },
    }
    const built = buildObjects(roomWith([interactiveMachine, interactiveArtifact, candle()]), noopLogger)
    const rings = built.children.filter((node) => node.name === 'interactable-indicator')
    expect(rings).toHaveLength(2)
    expect(rings.map((ring) => ring.position.x).sort()).toEqual([-2, 2])
  })
})
