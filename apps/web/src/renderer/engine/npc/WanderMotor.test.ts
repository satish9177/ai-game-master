import { describe, expect, it } from 'vitest'
import {
  chooseWanderStep,
  isWanderPositionAllowed,
  NPC_WANDER,
} from '../../../domain/npcMovementContract'
import type { NpcWanderField, WanderXZ } from '../../../domain/npcMovementContract'
import { stableHash01, stableHash32 } from '../../../domain/stableHash'
import type { PatrolRoute } from '../../../domain/npcPatrolContract'
import { WanderMotor } from './WanderMotor'

type TestNode = {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
}

type TestInteractable = {
  position: { x: number; y: number; z: number }
}

function openField(): NpcWanderField {
  return {
    roomId: 'wander-motor-room',
    npcId: 'npc',
    home: { x: 0, z: 0 },
    bounds: { halfX: 8, halfZ: 8 },
    exclusions: [],
  }
}

function boxedField(): NpcWanderField {
  const seed = stableHash32('boxed')
  const current = { x: 0, z: 0 }
  const key = `boxed:npc:${current.x.toFixed(3)}:${current.z.toFixed(3)}:${seed}:0`
  const candidates = Array.from({ length: 24 }, (_, candidate) => {
    const angle = stableHash01(`${key}:angle:${candidate}`) * Math.PI * 2
    const length = NPC_WANDER.STEP_MIN
      + stableHash01(`${key}:length:${candidate}`) * (NPC_WANDER.STEP_MAX - NPC_WANDER.STEP_MIN)
    return {
      x: Math.cos(angle) * length,
      z: Math.sin(angle) * length,
    }
  })

  return {
    ...openField(),
    roomId: 'boxed',
    exclusions: candidates.map((target) => ({
      x: target.x,
      z: target.z,
      radius: 0.001,
      reason: 'footprint' as const,
    })),
  }
}

function patrolField(): NpcWanderField {
  return {
    roomId: 'wander-motor-patrol-room',
    npcId: 'npc',
    home: { x: 0, z: 0 },
    bounds: { halfX: 8, halfZ: 8 },
    exclusions: [],
  }
}

function patrolRoute(): PatrolRoute {
  return { npcId: 'npc', waypoints: [{ x: 1, z: 0 }, { x: -1, z: 0 }], mode: 'ping-pong' }
}

function makeNode(x = 99, z = 99): TestNode {
  return {
    position: { x, y: 7, z },
    rotation: { x: 0.25, y: 0.5, z: 0.75 },
  }
}

function makeInteractable(x = 99, z = 99): TestInteractable {
  return {
    position: { x, y: 3, z },
  }
}

function distance(a: WanderXZ, b: WanderXZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function updateOpenMotor(seed = 'motor'): {
  field: NpcWanderField
  motor: WanderMotor
  node: TestNode
} {
  const field = openField()
  const motor = new WanderMotor()
  const node = makeNode()
  motor.register({ npcId: 'npc', node, field, seed, home: field.home })
  return { field, motor, node }
}

function runPositions(seed: string, dts: readonly number[]): WanderXZ[] {
  const { motor, node } = updateOpenMotor(seed)
  return dts.map((dtS) => {
    motor.update(dtS, { interactionLocked: false, isNpcTalking: () => false })
    return { x: node.position.x, z: node.position.z }
  })
}

describe('WanderMotor', () => {
  it('registers an NPC and updates node X/Z', () => {
    const { field, motor, node } = updateOpenMotor('sync-node')

    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })

    expect(node.position.x).not.toBe(field.home.x)
    expect(node.position.z).not.toBe(field.home.z)
    expect(isWanderPositionAllowed(field, node.position)).toBe(true)
  })

  it('syncs ring/helper X/Z when provided', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()
    const ring = makeNode(-9, -9)
    motor.register({ npcId: 'npc', node, ring, field, seed: 'ring', home: field.home })

    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })

    expect(ring.position.x).toBe(node.position.x)
    expect(ring.position.z).toBe(node.position.z)
  })

  it('syncs interactable position X/Z for future proximity checks', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()
    const interactable = makeInteractable(-9, -9)
    motor.register({ npcId: 'npc', node, interactable, field, seed: 'interactable', home: field.home })

    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })

    expect(interactable.position.x).toBe(node.position.x)
    expect(interactable.position.z).toBe(node.position.z)
  })

  it('leaves Y and rotation untouched for node and ring', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()
    const ring = makeNode()
    const before = {
      nodeY: node.position.y,
      nodeRotation: { ...node.rotation },
      ringY: ring.position.y,
      ringRotation: { ...ring.rotation },
    }
    motor.register({ npcId: 'npc', node, ring, field, seed: 'no-y-rotation', home: field.home })

    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })

    expect(node.position.y).toBe(before.nodeY)
    expect(node.rotation).toEqual(before.nodeRotation)
    expect(ring.position.y).toBe(before.ringY)
    expect(ring.rotation).toEqual(before.ringRotation)
  })

  it('freezes position and state when paused by interaction lock', () => {
    const { motor, node } = updateOpenMotor('interaction-pause')
    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })
    const frozen = { x: node.position.x, z: node.position.z }
    expect(motor.isWalking('npc')).toBe(true)

    motor.update(3, { interactionLocked: true, isNpcTalking: () => false })

    expect(node.position.x).toBe(frozen.x)
    expect(node.position.z).toBe(frozen.z)
    expect(motor.isWalking('npc')).toBe(true)
  })

  it('freezes position and state when paused by npcTalking', () => {
    const { motor, node } = updateOpenMotor('talking-pause')
    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })
    const frozen = { x: node.position.x, z: node.position.z }

    motor.update(3, { interactionLocked: false, isNpcTalking: (npcId) => npcId === 'npc' })

    expect(node.position.x).toBe(frozen.x)
    expect(node.position.z).toBe(frozen.z)
    expect(motor.isWalking('npc')).toBe(true)
  })

  it('resumes from frozen position and state after unpausing', () => {
    const { field, motor, node } = updateOpenMotor('resume')
    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })
    const frozen = { x: node.position.x, z: node.position.z }
    motor.update(3, { interactionLocked: true, isNpcTalking: () => false })

    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })

    expect(node.position.x).not.toBe(field.home.x)
    expect(node.position.z).not.toBe(field.home.z)
    expect(Math.hypot(node.position.x - frozen.x, node.position.z - frozen.z)).toBeGreaterThan(0)
  })

  it('clear() makes later update a safe no-op', () => {
    const { motor, node } = updateOpenMotor('clear')
    motor.clear()

    expect(() => {
      motor.update(1, { interactionLocked: false, isNpcTalking: () => false })
    }).not.toThrow()
    expect(node.position.x).toBe(0)
    expect(node.position.z).toBe(0)
    expect(motor.isWalking('npc')).toBe(false)
  })

  it('reports walking only while moving', () => {
    const { motor } = updateOpenMotor('walking-status')

    expect(motor.isWalking('npc')).toBe(false)
    motor.update(0.1, { interactionLocked: false, isNpcTalking: () => false })
    expect(motor.isWalking('npc')).toBe(true)

    for (let index = 0; motor.isWalking('npc') && index < 100; index += 1) {
      motor.update(0.1, { interactionLocked: false, isNpcTalking: () => false })
    }

    expect(motor.isWalking('npc')).toBe(false)
  })

  it('keeps a boxed-in NPC safe and jitter-free', () => {
    const field = boxedField()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'boxed', home: field.home })

    expect(isWanderPositionAllowed(field, field.home)).toBe(true)
    expect(chooseWanderStep(field, field.home, stableHash32('boxed'), 0)).toBeNull()
    for (let index = 0; index < 10; index += 1) {
      motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })
      expect(node.position.x).toBe(field.home.x)
      expect(node.position.z).toBe(field.home.z)
      expect(isWanderPositionAllowed(field, node.position)).toBe(true)
    }
    expect(motor.isWalking('npc')).toBe(false)
  })

  it('is deterministic for the same seed and update sequence', () => {
    const dts = [0.1, 0.2, 0.25, 0.4, 0.1, 2, 0.3]

    expect(runPositions('deterministic', dts)).toEqual(runPositions('deterministic', dts))
  })

  it('does not construct WebGL or Engine objects', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()

    expect(() => {
      motor.register({ npcId: 'npc', node, field, seed: 'pure', home: field.home })
      motor.update(0.1, { interactionLocked: false, isNpcTalking: () => false })
    }).not.toThrow()
  })

  it('patrols deterministically toward route waypoints when policy is "patrol"', () => {
    const field = patrolField()
    const route = patrolRoute()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'patrol-basic', policy: 'patrol', route })

    expect(node.position.x).toBe(1)
    expect(node.position.z).toBe(0)

    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })

    expect(node.position.x).toBeLessThan(1)
    expect(isWanderPositionAllowed(field, { x: node.position.x, z: node.position.z })).toBe(true)
    expect(motor.isWalking('npc')).toBe(true)
  })

  it('composes wander and patrol entries independently; policy is not inferred from route presence', () => {
    const wanderField = openField()
    const patrolFieldValue = patrolField()
    const route = patrolRoute()
    const motor = new WanderMotor()
    const wanderNode = makeNode()
    const patrolNode = makeNode()

    motor.register({ npcId: 'wanderer', node: wanderNode, field: wanderField, seed: 'compose-wander', home: wanderField.home })
    motor.register({
      npcId: 'patroller',
      node: patrolNode,
      field: patrolFieldValue,
      seed: 'compose-patrol',
      policy: 'patrol',
      route,
    })

    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })

    expect(isWanderPositionAllowed(wanderField, { x: wanderNode.position.x, z: wanderNode.position.z })).toBe(true)
    expect(patrolNode.position.x).toBeLessThan(1)
    expect(motor.isWalking('patroller')).toBe(true)
  })

  it('freezes patrol position and state when paused by interaction lock', () => {
    const field = patrolField()
    const route = patrolRoute()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'patrol-lock', policy: 'patrol', route })
    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })
    const frozen = { x: node.position.x, z: node.position.z }

    motor.update(3, { interactionLocked: true, isNpcTalking: () => false })

    expect(node.position.x).toBe(frozen.x)
    expect(node.position.z).toBe(frozen.z)
  })

  it('freezes patrol position and state when paused by npcTalking', () => {
    const field = patrolField()
    const route = patrolRoute()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'patrol-talking', policy: 'patrol', route })
    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })
    const frozen = { x: node.position.x, z: node.position.z }

    motor.update(3, { interactionLocked: false, isNpcTalking: (npcId) => npcId === 'npc' })

    expect(node.position.x).toBe(frozen.x)
    expect(node.position.z).toBe(frozen.z)
  })

  it('has no drift across successive ticks while paused patrol', () => {
    const field = patrolField()
    const route = patrolRoute()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'patrol-no-drift', policy: 'patrol', route })
    motor.update(0.25, { interactionLocked: true, isNpcTalking: () => false })
    const frozen = { x: node.position.x, z: node.position.z }

    for (let index = 0; index < 5; index += 1) {
      motor.update(0.25, { interactionLocked: true, isNpcTalking: () => false })
      expect(node.position.x).toBe(frozen.x)
      expect(node.position.z).toBe(frozen.z)
    }
  })

  it('syncs ring and interactable X/Z refs during patrol', () => {
    const field = patrolField()
    const route = patrolRoute()
    const motor = new WanderMotor()
    const node = makeNode()
    const ring = makeNode(-9, -9)
    const interactable = makeInteractable(-9, -9)
    motor.register({ npcId: 'npc', node, ring, interactable, field, seed: 'patrol-sync', policy: 'patrol', route })

    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })

    expect(ring.position.x).toBe(node.position.x)
    expect(ring.position.z).toBe(node.position.z)
    expect(interactable.position.x).toBe(node.position.x)
    expect(interactable.position.z).toBe(node.position.z)
  })

  it('moves a chase-eligible active NPC toward the player', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'chase-active', home: field.home, chaseEligible: true })

    motor.update(0.25, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => true,
    })

    expect(node.position.x).toBeGreaterThan(field.home.x)
    expect(node.position.z).toBe(0)
    expect(distance(field.home, node.position)).toBeLessThanOrEqual((NPC_WANDER.MAX_SPEED * 0.25) + 1e-12)
    expect(motor.isWalking('npc')).toBe(true)
  })

  it('uses normal wander behavior for chase-eligible NPCs when chase is inactive', () => {
    const field = openField()
    const chaseMotor = new WanderMotor()
    const normalMotor = new WanderMotor()
    const chaseNode = makeNode()
    const normalNode = makeNode()
    chaseMotor.register({ npcId: 'npc', node: chaseNode, field, seed: 'inactive-chase', home: field.home, chaseEligible: true })
    normalMotor.register({ npcId: 'npc', node: normalNode, field, seed: 'inactive-chase', home: field.home })

    chaseMotor.update(0.25, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => false,
    })
    normalMotor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })

    expect({ x: chaseNode.position.x, z: chaseNode.position.z })
      .toEqual({ x: normalNode.position.x, z: normalNode.position.z })
  })

  it('leaves non-eligible NPC behavior unchanged when chase context is present', () => {
    const field = openField()
    const withContextMotor = new WanderMotor()
    const withoutContextMotor = new WanderMotor()
    const withContextNode = makeNode()
    const withoutContextNode = makeNode()
    const dts = [0.1, 0.2, 0.25, 0.4]
    withContextMotor.register({ npcId: 'npc', node: withContextNode, field, seed: 'non-eligible', home: field.home })
    withoutContextMotor.register({ npcId: 'npc', node: withoutContextNode, field, seed: 'non-eligible', home: field.home })

    for (const dtS of dts) {
      withContextMotor.update(dtS, {
        interactionLocked: false,
        isNpcTalking: () => false,
        playerPosition: { x: 2, z: 0 },
        isChaseActive: () => true,
      })
      withoutContextMotor.update(dtS, { interactionLocked: false, isNpcTalking: () => false })

      expect({ x: withContextNode.position.x, z: withContextNode.position.z })
        .toEqual({ x: withoutContextNode.position.x, z: withoutContextNode.position.z })
      expect(withContextMotor.isWalking('npc')).toBe(withoutContextMotor.isWalking('npc'))
    }
  })

  it('pauses active chase for interaction lock or npcTalking before movement', () => {
    const field = openField()
    const lockedMotor = new WanderMotor()
    const talkingMotor = new WanderMotor()
    const lockedNode = makeNode()
    const talkingNode = makeNode()
    lockedMotor.register({ npcId: 'npc', node: lockedNode, field, seed: 'chase-lock', home: field.home, chaseEligible: true })
    talkingMotor.register({ npcId: 'npc', node: talkingNode, field, seed: 'chase-talking', home: field.home, chaseEligible: true })

    lockedMotor.update(1, {
      interactionLocked: true,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => true,
    })
    talkingMotor.update(1, {
      interactionLocked: false,
      isNpcTalking: (npcId) => npcId === 'npc',
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => true,
    })

    expect({ x: lockedNode.position.x, z: lockedNode.position.z }).toEqual(field.home)
    expect({ x: talkingNode.position.x, z: talkingNode.position.z }).toEqual(field.home)
    expect(lockedMotor.isWalking('npc')).toBe(false)
    expect(talkingMotor.isWalking('npc')).toBe(false)
  })

  it('resumes wander safely from the current chase position when chase becomes inactive', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'chase-drop-wander', home: field.home, chaseEligible: true })
    motor.update(0.25, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => true,
    })
    const chased = { x: node.position.x, z: node.position.z }

    motor.update(0.25, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => false,
    })

    expect(isWanderPositionAllowed(field, node.position)).toBe(true)
    expect(distance(chased, node.position)).toBeGreaterThan(0)
    expect(distance(field.home, node.position)).toBeGreaterThan(0)
  })

  it('resumes patrol safely from the current chase position when chase becomes inactive', () => {
    const field = patrolField()
    const route = patrolRoute()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({
      npcId: 'npc',
      node,
      field,
      seed: 'chase-drop-patrol',
      policy: 'patrol',
      route,
      chaseEligible: true,
    })
    motor.update(0.25, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => true,
    })
    const chased = { x: node.position.x, z: node.position.z }

    motor.update(0.25, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => false,
    })

    expect(isWanderPositionAllowed(field, node.position)).toBe(true)
    expect(distance(chased, node.position)).toBeGreaterThan(0)
  })

  it('reports walking for chase movement but not for standoff holds', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'chase-walking', home: field.home, chaseEligible: true })

    motor.update(0.25, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => true,
    })
    expect(motor.isWalking('npc')).toBe(true)

    motor.update(0.25, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: node.position.x, z: node.position.z },
      isChaseActive: () => true,
    })
    expect(motor.isWalking('npc')).toBe(false)
  })

  it('holds an idle NPC at its home position across updates without drift', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'idle-hold', policy: 'idle', home: field.home })

    expect(node.position.x).toBe(field.home.x)
    expect(node.position.z).toBe(field.home.z)

    for (let index = 0; index < 10; index += 1) {
      motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })
      expect(node.position.x).toBe(field.home.x)
      expect(node.position.z).toBe(field.home.z)
    }
  })

  it('never reports walking for a plain idle NPC', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'idle-not-walking', policy: 'idle', home: field.home })

    expect(motor.isWalking('npc')).toBe(false)
    motor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })
    expect(motor.isWalking('npc')).toBe(false)
  })

  it('freezes idle position when paused by interaction lock or npcTalking', () => {
    const field = openField()
    const lockedMotor = new WanderMotor()
    const talkingMotor = new WanderMotor()
    const lockedNode = makeNode()
    const talkingNode = makeNode()
    lockedMotor.register({ npcId: 'npc', node: lockedNode, field, seed: 'idle-lock', policy: 'idle', home: field.home })
    talkingMotor.register({ npcId: 'npc', node: talkingNode, field, seed: 'idle-talking', policy: 'idle', home: field.home })

    lockedMotor.update(3, { interactionLocked: true, isNpcTalking: () => false })
    talkingMotor.update(3, { interactionLocked: false, isNpcTalking: (npcId) => npcId === 'npc' })

    expect({ x: lockedNode.position.x, z: lockedNode.position.z }).toEqual(field.home)
    expect({ x: talkingNode.position.x, z: talkingNode.position.z }).toEqual(field.home)
    expect(lockedMotor.isWalking('npc')).toBe(false)
    expect(talkingMotor.isWalking('npc')).toBe(false)
  })

  it('lets the existing chase override move an idle NPC when chaseEligible && isChaseActive', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'idle-chase-active', policy: 'idle', home: field.home, chaseEligible: true })

    motor.update(0.25, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => true,
    })

    expect(node.position.x).toBeGreaterThan(field.home.x)
    expect(node.position.z).toBe(0)
    expect(distance(field.home, node.position)).toBeLessThanOrEqual((NPC_WANDER.MAX_SPEED * 0.25) + 1e-12)
    expect(motor.isWalking('npc')).toBe(true)
  })

  it('does not wander an idle NPC when chase is inactive or unavailable', () => {
    const field = openField()
    const inactiveMotor = new WanderMotor()
    const noContextMotor = new WanderMotor()
    const inactiveNode = makeNode()
    const noContextNode = makeNode()
    inactiveMotor.register({ npcId: 'npc', node: inactiveNode, field, seed: 'idle-chase-inactive', policy: 'idle', home: field.home, chaseEligible: true })
    noContextMotor.register({ npcId: 'npc', node: noContextNode, field, seed: 'idle-chase-none', policy: 'idle', home: field.home, chaseEligible: true })

    inactiveMotor.update(0.25, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => false,
    })
    noContextMotor.update(0.25, { interactionLocked: false, isNpcTalking: () => false })

    expect({ x: inactiveNode.position.x, z: inactiveNode.position.z }).toEqual(field.home)
    expect({ x: noContextNode.position.x, z: noContextNode.position.z }).toEqual(field.home)
    expect(inactiveMotor.isWalking('npc')).toBe(false)
    expect(noContextMotor.isWalking('npc')).toBe(false)
  })

  it('holds an idle NPC at the chase-stop position once chase becomes inactive, without further drift', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()
    motor.register({ npcId: 'npc', node, field, seed: 'idle-chase-stop', policy: 'idle', home: field.home, chaseEligible: true })
    motor.update(0.25, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => true,
    })
    const chased = { x: node.position.x, z: node.position.z }
    expect(distance(field.home, chased)).toBeGreaterThan(0)

    for (let index = 0; index < 5; index += 1) {
      motor.update(0.25, {
        interactionLocked: false,
        isNpcTalking: () => false,
        playerPosition: { x: 2, z: 0 },
        isChaseActive: () => false,
      })
      expect(node.position.x).toBe(chased.x)
      expect(node.position.z).toBe(chased.z)
    }
    expect(motor.isWalking('npc')).toBe(false)
  })

  it('preserves chase max-step behavior at the motor level', () => {
    const field = openField()
    const motor = new WanderMotor()
    const node = makeNode()
    const dtS = 0.25
    motor.register({ npcId: 'npc', node, field, seed: 'chase-no-teleport', home: field.home, chaseEligible: true })
    const before = { x: node.position.x, z: node.position.z }

    motor.update(dtS, {
      interactionLocked: false,
      isNpcTalking: () => false,
      playerPosition: { x: 2, z: 0 },
      isChaseActive: () => true,
    })

    expect(distance(before, node.position)).toBeLessThanOrEqual((NPC_WANDER.MAX_SPEED * dtS) + 1e-12)
    expect(isWanderPositionAllowed(field, node.position)).toBe(true)
  })
})
