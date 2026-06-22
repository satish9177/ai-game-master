import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildObjects } from './index'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import type { Logger } from '../../../platform/logger/Logger'

/**
 * No-WebGL tests for the humanoid characters built through buildObjects: the
 * existing NPC still assembles, the new zombie assembles, and a zombie that
 * carries the shared optional interaction gets the same static floor indicator
 * as any other interactable — no zombie-specific renderer logic.
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

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh)
  })
  return out
}

function indicators(group: THREE.Group): THREE.Object3D[] {
  return group.children.filter((c) => c.name === 'interactable-indicator')
}

const npc = {
  type: 'npc',
  name: 'Survivor',
  position: [-2, 0, 0],
  rotationY: 0,
  scale: 1,
  color: '#3a6ea5',
  interaction: { key: 'F', prompt: 'Press F to speak' },
}

const zombie = (interaction?: unknown) => ({
  type: 'zombie',
  position: [2, 0, -2],
  rotationY: 0,
  scale: 1,
  color: '#5c6b46',
  ...(interaction ? { interaction } : {}),
})

describe('humanoid characters in buildObjects', () => {
  it('still builds the NPC as a full humanoid and keeps its indicator', () => {
    const g = buildObjects(roomWith([npc]), noopLogger)
    expect(meshes(g).length).toBeGreaterThanOrEqual(12)
    expect(indicators(g)).toHaveLength(1)
  })

  it('builds a zombie and adds no indicator when it has no interaction', () => {
    const g = buildObjects(roomWith([zombie()]), noopLogger)
    expect(meshes(g).length).toBeGreaterThanOrEqual(12)
    expect(indicators(g)).toHaveLength(0)
  })

  it('lights the standard indicator for a zombie that carries an interaction', () => {
    const g = buildObjects(
      roomWith([zombie({ key: 'F', prompt: 'Press F to examine the corpse' })]),
      noopLogger,
    )
    const found = indicators(g)
    expect(found).toHaveLength(1)
    expect(found[0]!.position.x).toBeCloseTo(2)
    expect(found[0]!.position.z).toBeCloseTo(-2)
  })
})
