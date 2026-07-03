import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  AFFORDANCE_RING_COLOR,
  INTERACTABLE_RING_EMISSIVE_INTENSITY,
  INTERACTABLE_RING_OPACITY,
  RESOLVED_RING_EMISSIVE_INTENSITY,
  RESOLVED_RING_OPACITY,
  RETURN_EXIT_RING_COLOR,
  buildObjects,
} from './index'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import { loadRoomSpec } from '../../../domain/loadRoomSpec'
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
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'indicator-room',
    name: 'Indicator Room',
    shell: { dimensions: { width: 12, depth: 12, height: 4 } },
    spawn: { position: [0, 1.6, 0], yaw: 0 },
    objects,
  })
}

const scroll = {
  type: 'scroll',
  position: [2, 0.5, 3],
  interaction: { key: 'E', prompt: 'Press E to read' },
}

const pillar = {
  type: 'pillar',
  position: [0, 0, 0],
}

function indicators(group: THREE.Group): THREE.Object3D[] {
  return group.children.filter((c) => c.name === 'interactable-indicator')
}

function indicatorMesh(group: THREE.Group): THREE.Mesh {
  const ring = indicators(group)[0] as THREE.Mesh | undefined
  if (!ring) throw new Error('missing interactable indicator')
  return ring
}

function indicatorColor(group: THREE.Group): string {
  const ring = indicatorMesh(group)
  const material = ring?.material as THREE.MeshStandardMaterial | undefined
  return `#${material?.color?.getHexString() ?? ''}`
}

function indicatorMaterial(group: THREE.Group): THREE.MeshStandardMaterial {
  return indicatorMesh(group).material as THREE.MeshStandardMaterial
}

const encounter = {
  id: 'threat',
  title: 'Threat',
  description: 'A threat blocks the way.',
  choices: [{
    id: 'run',
    action: 'run',
    label: 'Run',
    outcome: { effects: [] },
  }],
}

describe('buildObjects interactable indicators', () => {
  it('adds one floor indicator under an interactable object, at its XZ', () => {
    const g = buildObjects(roomWith([scroll]), noopLogger)
    const found = indicators(g)
    expect(found).toHaveLength(1)
    const ring = found[0]!
    expect(ring.position.x).toBeCloseTo(2)
    expect(ring.position.z).toBeCloseTo(3)
    expect(ring.position.y).toBeGreaterThan(0.04) // raised slightly above the floor
    expect(ring.position.y).toBeLessThan(0.1) // still on the floor, not at the object's y=0.5
  })

  it('keeps one stable lightweight indicator mesh with stronger visibility settings', () => {
    const g = buildObjects(roomWith([scroll]), noopLogger)
    const ring = indicatorMesh(g)
    const geometry = ring.geometry as THREE.RingGeometry
    const material = ring.material as THREE.MeshStandardMaterial

    expect(indicators(g)).toHaveLength(1)
    expect(ring.name).toBe('interactable-indicator')
    expect(geometry.parameters.innerRadius).toBeCloseTo(0.72)
    expect(geometry.parameters.outerRadius).toBeCloseTo(1.14)
    expect(material.emissiveIntensity).toBeCloseTo(INTERACTABLE_RING_EMISSIVE_INTENSITY)
    expect(material.opacity).toBe(INTERACTABLE_RING_OPACITY)
    expect(material.depthWrite).toBe(false)
    expect(material.roughness).toBeCloseTo(0.55)
    expect(material.metalness).toBeCloseTo(0.02)
    expect(material.toneMapped).toBe(false)
    expect(ring.renderOrder).toBe(12)
  })

  it('preserves object-id tagging while polishing the indicator material', () => {
    const g = buildObjects(roomWith([{ ...scroll, id: 'scroll-1' }]), noopLogger)
    const ring = indicatorMesh(g)
    const material = ring.material as THREE.MeshStandardMaterial

    expect(ring.userData.forObjectId).toBe('scroll-1')
    expect(ring.userData.objectId).toBeUndefined()
    expect(ring.userData.objectType).toBeUndefined()
    expect(material.transparent).toBe(true)
    expect(material.opacity).toBeCloseTo(INTERACTABLE_RING_OPACITY)
  })

  it('dims resolved interactable indicators without changing color or geometry', () => {
    const unresolved = buildObjects(roomWith([{ ...scroll, id: 'scroll-1' }]), noopLogger)
    const resolved = buildObjects(
      roomWith([{ ...scroll, id: 'scroll-1' }]),
      noopLogger,
      new Set(['scroll-1']),
    )
    const unresolvedMaterial = indicatorMaterial(unresolved)
    const resolvedMaterial = indicatorMaterial(resolved)
    const unresolvedGeometry = indicatorMesh(unresolved).geometry as THREE.RingGeometry
    const resolvedGeometry = indicatorMesh(resolved).geometry as THREE.RingGeometry

    expect(indicatorColor(resolved)).toBe(indicatorColor(unresolved))
    expect(resolvedGeometry.parameters.innerRadius).toBeCloseTo(
      unresolvedGeometry.parameters.innerRadius,
    )
    expect(resolvedGeometry.parameters.outerRadius).toBeCloseTo(
      unresolvedGeometry.parameters.outerRadius,
    )
    expect(resolvedMaterial.opacity).toBeCloseTo(RESOLVED_RING_OPACITY)
    expect(resolvedMaterial.emissiveIntensity).toBeCloseTo(RESOLVED_RING_EMISSIVE_INTENSITY)
    expect(resolvedMaterial.opacity).toBeLessThan(unresolvedMaterial.opacity)
    expect(resolvedMaterial.emissiveIntensity).toBeLessThan(unresolvedMaterial.emissiveIntensity)
  })

  it('keeps unresolved indicators unchanged when resolved ids do not match', () => {
    const g = buildObjects(
      roomWith([{ ...scroll, id: 'scroll-1' }]),
      noopLogger,
      new Set(['other-object']),
    )
    const material = indicatorMaterial(g)

    expect(material.opacity).toBe(INTERACTABLE_RING_OPACITY)
    expect(material.emissiveIntensity).toBeCloseTo(INTERACTABLE_RING_EMISSIVE_INTENSITY)
  })

  it('adds no indicator for non-interactable objects', () => {
    const g = buildObjects(roomWith([pillar]), noopLogger)
    expect(indicators(g)).toHaveLength(0)
  })

  it('uses the inspect/default color for a body-only interactable', () => {
    const g = buildObjects(roomWith([{
      type: 'chest',
      position: [0, 0, 0],
      interaction: {
        key: 'E',
        prompt: 'Talk take exit use approach open',
        title: 'Exit through the chest',
        body: '{"debug":"not an affordance"}',
      },
    }]), noopLogger)

    expect(indicatorColor(g)).toBe(AFFORDANCE_RING_COLOR.inspect)
  })

  it('uses the talk color for npc and dialogue interactions', () => {
    const npc = buildObjects(roomWith([{
      type: 'npc',
      name: 'Exit Take Approach',
      position: [0, 0, 0],
      interaction: { key: 'F', prompt: 'Open the box' },
    }]), noopLogger)
    const dialogue = buildObjects(roomWith([{
      type: 'statue',
      position: [0, 0, 0],
      interaction: { key: 'F', prompt: 'Inspect', dialogue: { greeting: 'Hello.' } },
    }]), noopLogger)

    expect(indicatorColor(npc)).toBe(AFFORDANCE_RING_COLOR.talk)
    expect(indicatorColor(dialogue)).toBe(AFFORDANCE_RING_COLOR.talk)
    expect(indicatorColor(npc)).not.toBe(AFFORDANCE_RING_COLOR.inspect)
  })

  it('uses the exit color for exit interactions', () => {
    const g = buildObjects(roomWith([{
      type: 'arch',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Inspect arch', exit: { toRoomId: 'next' } },
    }]), noopLogger)

    expect(indicatorColor(g)).toBe(AFFORDANCE_RING_COLOR.exit)
    expect(indicatorColor(g)).not.toBe(AFFORDANCE_RING_COLOR.inspect)
  })

  it('uses the return-exit ring color for return-exit namespace ids', () => {
    const g = buildObjects(roomWith([{
      type: 'arch',
      id: 'R1:exit:north:return-exit:south',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Return', exit: { toRoomId: 'R1' } },
    }]), noopLogger)

    expect(indicatorColor(g)).toBe(RETURN_EXIT_RING_COLOR)
    expect(indicatorColor(g)).not.toBe(AFFORDANCE_RING_COLOR.exit)
  })

  it('keeps forward generated exit rings cyan', () => {
    const g = buildObjects(roomWith([{
      type: 'arch',
      id: 'R1:generated-exit:north',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Enter next room', exit: { toRoomId: 'R1:exit:north' } },
    }]), noopLogger)

    expect(indicatorColor(g)).toBe(AFFORDANCE_RING_COLOR.exit)
    expect(indicatorColor(g)).not.toBe(RETURN_EXIT_RING_COLOR)
  })

  it('keeps authored exit rings cyan', () => {
    const g = buildObjects(roomWith([{
      type: 'arch',
      id: 'north-arch',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'ruined-room' } },
    }]), noopLogger)

    expect(indicatorColor(g)).toBe(AFFORDANCE_RING_COLOR.exit)
    expect(indicatorColor(g)).not.toBe(RETURN_EXIT_RING_COLOR)
  })

  it('uses the approach color for encounter interactions', () => {
    const g = buildObjects(roomWith([{
      type: 'zombie',
      name: 'Talker',
      position: [0, 0, 0],
      interaction: { key: 'F', prompt: 'Talk with zombie', encounter },
    }]), noopLogger)

    expect(indicatorColor(g)).toBe(AFFORDANCE_RING_COLOR.approach)
    expect(indicatorColor(g)).not.toBe(AFFORDANCE_RING_COLOR.inspect)
  })

  it('uses take and use colors for structured item effects', () => {
    const take = buildObjects(roomWith([{
      type: 'crate',
      position: [0, 0, 0],
      interaction: {
        key: 'E',
        prompt: 'Inspect crate',
        effect: {
          kind: 'take-item',
          item: { itemId: 'bandage', name: 'Bandage', quantity: 1 },
        },
      },
    }]), noopLogger)
    const use = buildObjects(roomWith([{
      type: 'machine',
      position: [0, 0, 0],
      interaction: {
        key: 'E',
        prompt: 'Take machine',
        effect: { kind: 'use-item', itemId: 'medkit', quantity: 1 },
      },
    }]), noopLogger)

    expect(indicatorColor(take)).toBe(AFFORDANCE_RING_COLOR.take)
    expect(indicatorColor(use)).toBe(AFFORDANCE_RING_COLOR.use)
  })

  it('keeps exit arch tags and position stable while giving arch segments clearer material', () => {
    const g = buildObjects(roomWith([{
      type: 'arch',
      id: 'north-arch',
      position: [1, 0, -5],
      interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'ruined-room' } },
    }]), noopLogger)

    const arch = g.children.find((child) => child.userData.objectId === 'north-arch')
    if (!arch) throw new Error('missing arch object')
    const archMeshes = arch.children.filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    )
    const material = archMeshes[0]?.material
    if (!(material instanceof THREE.MeshStandardMaterial)) {
      throw new Error('expected arch segment material')
    }

    expect(arch.userData.objectType).toBe('arch')
    expect(arch.position.toArray()).toEqual([1, 0, -5])
    expect(archMeshes).toHaveLength(3)
    expect(archMeshes.map((mesh) => mesh.position.toArray())).toEqual([
      [-1.25, 1.75, 0],
      [1.25, 1.75, 0],
      [0, 3.75, 0],
    ])
    expect(material.emissiveIntensity).toBeCloseTo(0.22)
    expect(material.roughness).toBeCloseTo(0.72)
    expect(material.metalness).toBeCloseTo(0.04)
  })

  it('does not render raw JSON or debug data into indicator names', () => {
    const g = buildObjects(roomWith([{
      type: 'scroll',
      position: [0, 0, 0],
      interaction: {
        key: 'E',
        prompt: '{"secret":"raw"}',
        title: '{"title":"debug"}',
        body: '{"body":"debug"}',
      },
    }]), noopLogger)

    expect(indicators(g)).toHaveLength(1)
    const names = g.children.map((child) => child.name).join(' ')
    expect(names).toContain('interactable-indicator')
    expect(names).not.toContain('secret')
    expect(names).not.toContain('debug')
    expect(names).not.toContain('{')
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
