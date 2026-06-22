import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildObjects } from './index'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import type { Logger } from '../../../platform/logger/Logger'

/**
 * No-WebGL test: builds objects and checks the renderer-internal discoverability
 * cues. Objects carrying an `interaction` get a floor indicator at their XZ;
 * other objects don't. Shadow casting is enabled on object meshes. Driven only
 * by existing RoomSpec data — no schema change.
 */

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger
  },
}

function roomWith(objects: unknown[]): LoadedRoom {
  return { objects, skipped: [] } as unknown as LoadedRoom
}

const scroll = {
  type: 'scroll',
  position: [2, 0.5, 3],
  rotationY: 0,
  scale: 1,
  color: '#e8dcb5',
  interaction: { key: 'E', prompt: 'Press E to read' },
}

const pillar = {
  type: 'pillar',
  position: [0, 0, 0],
  rotationY: 0,
  scale: 1,
  radius: 0.4,
  height: 4,
  color: '#cfc8b8',
}

function indicators(group: THREE.Group): THREE.Object3D[] {
  return group.children.filter((c) => c.name === 'interactable-indicator')
}

describe('buildObjects interactable indicators', () => {
  it('adds one floor indicator under an interactable object, at its XZ', () => {
    const g = buildObjects(roomWith([scroll]), noopLogger)
    const found = indicators(g)
    expect(found).toHaveLength(1)
    const ring = found[0]!
    expect(ring.position.x).toBeCloseTo(2)
    expect(ring.position.z).toBeCloseTo(3)
    expect(ring.position.y).toBeLessThan(0.1) // on the floor, not at the object's y=0.5
  })

  it('adds no indicator for non-interactable objects', () => {
    const g = buildObjects(roomWith([pillar]), noopLogger)
    expect(indicators(g)).toHaveLength(0)
  })

  it('enables shadow casting on object meshes', () => {
    const g = buildObjects(roomWith([pillar]), noopLogger)
    let casters = 0
    g.traverse((c) => {
      const mesh = c as THREE.Mesh
      if (mesh.isMesh && mesh.castShadow) casters++
    })
    expect(casters).toBeGreaterThan(0)
  })
})
