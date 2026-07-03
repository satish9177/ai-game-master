import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import {
  buildNpcWanderField,
  chooseWanderStep,
  isWanderPositionAllowed,
  NPC_WANDER,
  shouldPauseWander,
  wanderPauseSeconds,
} from './npcMovementContract'
import type { NpcWanderField, WanderXZ } from './npcMovementContract'
import { objectFootprintRadius } from './generatedRoomLayout'
import { stableHash01 } from './stableHash'
import { LIMITS } from './validateRoom'

function movementRoom(): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'npc-movement-contract-room',
    name: 'NPC Movement Contract Room',
    shell: { dimensions: { width: 18, depth: 18, height: 4 } },
    spawn: { position: [0, 1.6, 0], yaw: 0 },
    objects: [
      {
        id: 'wanderer',
        type: 'npc',
        name: 'Wanderer',
        position: [0, 0, 3],
        interaction: { key: 'F', prompt: 'Talk to Wanderer' },
      },
      {
        id: 'other-npc',
        type: 'npc',
        name: 'Other',
        position: [2, 0, 3],
        interaction: { key: 'F', prompt: 'Talk to Other' },
      },
      {
        id: 'north-exit',
        type: 'arch',
        position: [0, 0, -5],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'north-room' } },
      },
      {
        id: 'chest',
        type: 'chest',
        position: [-2, 0, 3],
        interaction: { key: 'E', prompt: 'Open chest' },
      },
      {
        id: 'pillar',
        type: 'pillar',
        radius: 0.4,
        position: [0, 0, 5],
      },
    ],
  })
}

function field(): NpcWanderField {
  const built = buildNpcWanderField(movementRoom(), 'wanderer')
  expect(built).not.toBeNull()
  return built!
}

function distance(a: WanderXZ, b: WanderXZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function segmentSamples(start: WanderXZ, end: WanderXZ): WanderXZ[] {
  const length = distance(start, end)
  const samples = Math.max(1, Math.ceil(length / NPC_WANDER.SEGMENT_SAMPLE_SPACING))
  return Array.from({ length: samples + 1 }, (_, sample) => {
    const t = sample / samples
    return {
      x: start.x + (end.x - start.x) * t,
      z: start.z + (end.z - start.z) * t,
    }
  })
}

describe('buildNpcWanderField', () => {
  it('assembles bounds and expected exclusion disc classes without the current NPC', () => {
    const room = movementRoom()
    const built = buildNpcWanderField(room, 'wanderer')

    expect(built).toMatchObject({
      roomId: room.id,
      npcId: 'wanderer',
      home: { x: 0, z: 3 },
      bounds: { halfX: 8.55, halfZ: 8.55 },
    })

    expect(built?.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'spawn', x: 0, z: 0, radius: LIMITS.SPAWN_CLEARANCE }),
      expect.objectContaining({
        reason: 'npc-home',
        objectId: 'other-npc',
        x: 2,
        z: 3,
        radius: NPC_WANDER.INTERACTABLE_CLEARANCE,
      }),
      expect.objectContaining({
        reason: 'exit',
        objectId: 'north-exit',
        x: 0,
        z: -5,
        radius: NPC_WANDER.EXIT_CLEARANCE,
      }),
      expect.objectContaining({
        reason: 'interactable',
        objectId: 'chest',
        x: -2,
        z: 3,
        radius: NPC_WANDER.INTERACTABLE_CLEARANCE,
      }),
      expect.objectContaining({
        reason: 'footprint',
        objectId: 'pillar',
        x: 0,
        z: 5,
        radius: objectFootprintRadius(room.objects.find((object) => object.id === 'pillar')!),
      }),
    ]))
    expect(built?.exclusions.some((disc) => disc.objectId === 'wanderer')).toBe(false)
  })

  it('handles unknown ids, non-NPC ids, and minimal rooms safely', () => {
    const room = movementRoom()

    expect(buildNpcWanderField(room, 'missing')).toBeNull()
    expect(buildNpcWanderField(room, 'chest')).toBeNull()

    const minimal = loadRoomSpec({
      schemaVersion: 1,
      id: 'minimal',
      name: 'Minimal',
      shell: { dimensions: { width: 8, depth: 8, height: 4 } },
      spawn: { position: [0, 1.6, 0], yaw: 0 },
      objects: [{
        id: 'solo',
        type: 'npc',
        name: 'Solo',
        position: [0, 0, 2],
        interaction: { key: 'F', prompt: 'Talk' },
      }],
    })

    expect(buildNpcWanderField(minimal, 'solo')).toMatchObject({
      npcId: 'solo',
      exclusions: [expect.objectContaining({ reason: 'spawn' })],
    })
  })

  it('does not mutate the input room', () => {
    const room = movementRoom()
    const before = JSON.stringify(room)

    buildNpcWanderField(room, 'wanderer')

    expect(JSON.stringify(room)).toBe(before)
  })
})

describe('isWanderPositionAllowed', () => {
  it('accepts safe positions', () => {
    expect(isWanderPositionAllowed(field(), { x: 0.8, z: 3.8 })).toBe(true)
  })

  it('rejects out-of-bounds and beyond-tether positions', () => {
    const built = field()

    expect(isWanderPositionAllowed(built, { x: built.bounds.halfX + 0.01, z: 3 })).toBe(false)
    expect(isWanderPositionAllowed(built, { x: 0, z: 3 + NPC_WANDER.MAX_RADIUS_FROM_HOME + 0.01 }))
      .toBe(false)
  })

  it('rejects positions inside exclusion discs', () => {
    const built = field()

    expect(isWanderPositionAllowed(built, { x: 0, z: 0 })).toBe(false)
    expect(isWanderPositionAllowed(built, { x: 2, z: 3 })).toBe(false)
    expect(isWanderPositionAllowed(built, { x: -2, z: 3 })).toBe(false)
    expect(isWanderPositionAllowed(built, { x: 0, z: 5 })).toBe(false)
  })

  it('allows exact exclusion and bounds boundaries', () => {
    const built = field()
    const spawnBoundaryField: NpcWanderField = {
      ...built,
      home: { x: 0, z: 0 },
      exclusions: [{ x: 0, z: 0, radius: LIMITS.SPAWN_CLEARANCE, reason: 'spawn' }],
    }

    expect(isWanderPositionAllowed(
      spawnBoundaryField,
      { x: LIMITS.SPAWN_CLEARANCE, z: 0 },
    )).toBe(true)
    expect(isWanderPositionAllowed(built, { x: built.bounds.halfX, z: 3 })).toBe(false)

    const openField: NpcWanderField = {
      ...built,
      home: { x: built.bounds.halfX - 1, z: 0 },
      exclusions: [],
    }
    expect(isWanderPositionAllowed(openField, { x: built.bounds.halfX, z: 0 })).toBe(true)
  })
})

describe('chooseWanderStep', () => {
  it('is deterministic for the same seed, current position, and stepIndex', () => {
    const built = field()
    const current = { x: 0, z: 3 }

    expect(chooseWanderStep(built, current, 42, 7))
      .toEqual(chooseWanderStep(built, current, 42, 7))
  })

  it('can diverge for different seeds or stepIndex values', () => {
    const built = field()
    const current = { x: 0, z: 3 }
    const choices = new Set([
      JSON.stringify(chooseWanderStep(built, current, 42, 7)),
      JSON.stringify(chooseWanderStep(built, current, 43, 7)),
      JSON.stringify(chooseWanderStep(built, current, 42, 8)),
    ])

    expect(choices.size).toBeGreaterThan(1)
  })

  it('chooses only safe steps within max step and tether constants', () => {
    const built = field()
    let current = { x: 0, z: 3 }

    for (let stepIndex = 0; stepIndex < 500; stepIndex += 1) {
      const step = chooseWanderStep(built, current, 1001, stepIndex)
      if (!step) continue

      const stepDistance = distance(current, step.target)
      expect(stepDistance).toBeGreaterThanOrEqual(NPC_WANDER.STEP_MIN)
      expect(stepDistance).toBeLessThanOrEqual(NPC_WANDER.STEP_MAX)
      expect(distance(built.home, step.target)).toBeLessThanOrEqual(NPC_WANDER.MAX_RADIUS_FROM_HOME)
      for (const sample of segmentSamples(current, step.target)) {
        expect(isWanderPositionAllowed(built, sample)).toBe(true)
      }
      current = step.target
    }
  })

  it('rejects a step whose segment crosses a small exclusion disc', () => {
    const seed = 18
    const stepIndex = 11
    const current = { x: 0, z: 0 }
    const key = `crossing:npc:${current.x.toFixed(3)}:${current.z.toFixed(3)}:${seed}:${stepIndex}`
    const candidates = Array.from({ length: 24 }, (_, candidate) => {
      const angle = stableHash01(`${key}:angle:${candidate}`) * Math.PI * 2
      const length = NPC_WANDER.STEP_MIN
        + stableHash01(`${key}:length:${candidate}`) * (NPC_WANDER.STEP_MAX - NPC_WANDER.STEP_MIN)
      return {
        x: Math.cos(angle) * length,
        z: Math.sin(angle) * length,
      }
    })
    const first = candidates[0]
    const crossingField: NpcWanderField = {
      roomId: 'crossing',
      npcId: 'npc',
      home: current,
      bounds: { halfX: 8, halfZ: 8 },
      exclusions: [
        {
          x: first.x * 0.25,
          z: first.z * 0.25,
          radius: 0.15,
          reason: 'footprint',
          objectType: 'candle',
        },
        ...candidates.slice(1).map((target) => ({
          x: target.x,
          z: target.z,
          radius: 0.001,
          reason: 'footprint' as const,
        })),
      ],
    }

    expect(isWanderPositionAllowed(crossingField, current)).toBe(true)
    expect(isWanderPositionAllowed(crossingField, first)).toBe(true)
    expect(chooseWanderStep(crossingField, current, seed, stepIndex)).toBeNull()
  })

  it('returns null when boxed in', () => {
    const boxedField: NpcWanderField = {
      roomId: 'boxed',
      npcId: 'npc',
      home: { x: 0, z: 0 },
      bounds: { halfX: 8, halfZ: 8 },
      exclusions: [{ x: 0, z: 0, radius: NPC_WANDER.STEP_MAX + 0.1, reason: 'footprint' }],
    }

    expect(chooseWanderStep(boxedField, { x: 0, z: 0 }, 1, 0)).toBeNull()
  })
})

describe('wanderPauseSeconds', () => {
  it('is deterministic and stays inside the configured range', () => {
    for (let stepIndex = 0; stepIndex < 100; stepIndex += 1) {
      const pause = wanderPauseSeconds(77, stepIndex)
      expect(pause).toBe(wanderPauseSeconds(77, stepIndex))
      expect(pause).toBeGreaterThanOrEqual(NPC_WANDER.PAUSE_MIN_S)
      expect(pause).toBeLessThan(NPC_WANDER.PAUSE_MAX_S)
    }
  })
})

describe('shouldPauseWander', () => {
  it('pauses only for closed v0 pause reasons', () => {
    expect(shouldPauseWander({ interactionLocked: false, npcTalking: false })).toBe(false)
    expect(shouldPauseWander({ interactionLocked: true, npcTalking: false })).toBe(true)
    expect(shouldPauseWander({ interactionLocked: false, npcTalking: true })).toBe(true)
    expect(shouldPauseWander({ interactionLocked: true, npcTalking: true })).toBe(true)
  })
})
