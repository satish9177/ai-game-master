import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  IDLE_BOB_AMPLITUDE,
  IDLE_BOB_FREQUENCY_HZ,
  IDLE_SWAY_AMPLITUDE_RAD,
  IdleAnimator,
  idleOffsets,
  idlePhase,
} from './idleAnimation'

describe('idlePhase', () => {
  it('is deterministic and in [0, 2π)', () => {
    const phase = idlePhase('room-1', 'npc-1')
    expect(phase).toBe(idlePhase('room-1', 'npc-1'))
    expect(phase).toBeGreaterThanOrEqual(0)
    expect(phase).toBeLessThan(Math.PI * 2)
  })

  it('diverges for two ids in the same room', () => {
    expect(idlePhase('room-1', 'npc-1')).not.toBe(idlePhase('room-1', 'npc-2'))
  })
})

describe('idleOffsets', () => {
  it('bobY is bounded and raise-only over a large elapsed sweep', () => {
    const phase = idlePhase('room-1', 'npc-1')
    for (let elapsedS = 0; elapsedS <= 10_000; elapsedS += 137) {
      const { bobY } = idleOffsets(phase, elapsedS)
      expect(bobY).toBeGreaterThanOrEqual(0)
      expect(bobY).toBeLessThanOrEqual(IDLE_BOB_AMPLITUDE)
    }
  })

  it('swayRad is 0 with current constants', () => {
    const phase = idlePhase('room-1', 'npc-1')
    for (let elapsedS = 0; elapsedS <= 5000; elapsedS += 91) {
      // Math.abs normalizes -0 to 0; `IDLE_SWAY_AMPLITUDE_RAD * sin(x)` can yield either.
      expect(Math.abs(idleOffsets(phase, elapsedS).swayRad)).toBe(0)
    }
    expect(IDLE_SWAY_AMPLITUDE_RAD).toBe(0)
  })

  it('bob amplitude and cadence stay in the visible range', () => {
    // Guards against silently retuning the bob back to imperceptible: at the
    // isometric camera's fixed framing, amplitude below ~0.06m and frequency
    // outside ~0.4-1.0 Hz reads as static or as a distracting bounce.
    expect(IDLE_BOB_AMPLITUDE).toBeGreaterThanOrEqual(0.06)
    expect(IDLE_BOB_FREQUENCY_HZ).toBeGreaterThanOrEqual(0.4)
    expect(IDLE_BOB_FREQUENCY_HZ).toBeLessThanOrEqual(1.0)
  })
})

describe('IdleAnimator', () => {
  function makeNode(): THREE.Object3D {
    const node = new THREE.Object3D()
    node.position.set(1, 2, 3)
    node.rotation.y = 0.5
    return node
  }

  it('moves position.y upward from baseY and leaves X/Z untouched', () => {
    const animator = new IdleAnimator()
    const node = makeNode()
    animator.register({ node, phase: idlePhase('room-1', 'npc-1'), baseY: 2, baseRotY: 0.5 })

    animator.update(1)

    expect(node.position.x).toBe(1)
    expect(node.position.z).toBe(3)
    expect(node.position.y).toBeGreaterThanOrEqual(2)
    expect(node.position.y).toBeLessThanOrEqual(2 + IDLE_BOB_AMPLITUDE)
  })

  it('leaves rotation.y at baseRotY because sway is disabled', () => {
    const animator = new IdleAnimator()
    const node = makeNode()
    animator.register({ node, phase: idlePhase('room-1', 'npc-1'), baseY: 2, baseRotY: 0.5 })

    animator.update(1)
    animator.update(3.7)

    expect(node.rotation.y).toBe(0.5)
  })

  it('clear() then update() is a safe no-op', () => {
    const animator = new IdleAnimator()
    const node = makeNode()
    animator.register({ node, phase: idlePhase('room-1', 'npc-1'), baseY: 2, baseRotY: 0.5 })

    animator.clear()
    animator.update(1)

    expect(node.position.y).toBe(2)
    expect(node.rotation.y).toBe(0.5)
  })

  it('is frame-rate independent: two update(0.5) calls match one update(1.0)', () => {
    const phase = idlePhase('room-1', 'npc-1')

    const stepped = new IdleAnimator()
    const steppedNode = makeNode()
    stepped.register({ node: steppedNode, phase, baseY: 2, baseRotY: 0.5 })
    stepped.update(0.5)
    stepped.update(0.5)

    const single = new IdleAnimator()
    const singleNode = makeNode()
    single.register({ node: singleNode, phase, baseY: 2, baseRotY: 0.5 })
    single.update(1.0)

    expect(steppedNode.position.y).toBeCloseTo(singleNode.position.y, 12)
  })
})
