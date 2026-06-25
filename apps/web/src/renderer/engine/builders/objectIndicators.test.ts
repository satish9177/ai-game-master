import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { AFFORDANCE_RING_COLOR, buildObjects } from './index'
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

function indicatorColor(group: THREE.Group): string {
  const ring = indicators(group)[0] as THREE.Mesh | undefined
  const material = ring?.material as THREE.MeshStandardMaterial | undefined
  return `#${material?.color.getHexString()}`
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
    expect(ring.position.y).toBeLessThan(0.1) // on the floor, not at the object's y=0.5
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
