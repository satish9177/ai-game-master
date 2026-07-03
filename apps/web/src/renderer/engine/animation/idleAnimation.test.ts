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

  it('defaults to intensity 1 and reproduces current offsets', () => {
    const animator = new IdleAnimator()
    const node = makeNode()
    const phase = idlePhase('room-1', 'npc-1')
    animator.register({ node, phase, baseY: 2, baseRotY: 0.5 })

    animator.update(1)

    const { bobY, swayRad } = idleOffsets(phase, 1)
    expect(node.position.y).toBeCloseTo(2 + bobY, 12)
    expect(node.rotation.y).toBeCloseTo(0.5 + swayRad, 12)
  })

  it('returns intensity 0 nodes exactly to baseY and baseRotY', () => {
    const animator = new IdleAnimator()
    const node = makeNode()
    animator.register({
      node,
      phase: idlePhase('room-1', 'npc-1'),
      baseY: 2,
      baseRotY: 0.5,
      intensity: () => 0,
    })

    animator.update(1)

    expect(node.position.y).toBe(2)
    expect(node.rotation.y).toBe(0.5)
  })

  it('applies half bob offset for intensity 0.5', () => {
    const animator = new IdleAnimator()
    const node = makeNode()
    const phase = idlePhase('room-1', 'npc-1')
    animator.register({
      node,
      phase,
      baseY: 2,
      baseRotY: 0.5,
      intensity: () => 0.5,
    })

    animator.update(1)

    expect(node.position.y).toBeCloseTo(2 + idleOffsets(phase, 1).bobY * 0.5, 12)
  })

  it('never writes X/Z when intensity changes', () => {
    const animator = new IdleAnimator()
    const node = makeNode()
    node.rotation.x = 0.25
    node.rotation.z = 0.75
    animator.register({
      node,
      phase: idlePhase('room-1', 'npc-1'),
      baseY: 2,
      baseRotY: 0.5,
      intensity: () => 0,
    })

    animator.update(1)

    expect(node.position.x).toBe(1)
    expect(node.position.z).toBe(3)
    expect(node.rotation.x).toBe(0.25)
    expect(node.rotation.z).toBe(0.75)
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
