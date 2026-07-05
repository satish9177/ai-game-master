import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import {
  buildNpcWanderField,
  isWanderPositionAllowed,
  isWanderSegmentAllowed,
  NPC_WANDER,
} from './npcMovementContract'
import type { NpcWanderField } from './npcMovementContract'
import { buildNpcPatrolRoute, PATROL_MAX_WAYPOINTS, PATROL_MIN_WAYPOINTS } from './npcPatrolContract'
import { stableHash32 } from './stableHash'

function patrolRoom(): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'npc-patrol-contract-room',
    name: 'NPC Patrol Contract Room',
    shell: { dimensions: { width: 20, depth: 20, height: 4 } },
    spawn: { position: [0, 1.6, 0], yaw: 0 },
    objects: [
      {
        id: 'guard',
        type: 'npc',
        name: 'Guard',
        position: [0, 0, 6],
        interaction: { key: 'F', prompt: 'Talk to Guard' },
      },
      {
        id: 'other-npc',
        type: 'npc',
        name: 'Other',
        position: [6, 0, -6],
        interaction: { key: 'F', prompt: 'Talk to Other' },
      },
      {
        id: 'north-exit',
        type: 'arch',
        position: [0, 0, -9],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'north-room' } },
      },
      {
        id: 'chest',
        type: 'chest',
        position: [-6, 0, 6],
        interaction: { key: 'E', prompt: 'Open chest' },
      },
    ],
  })
}

function field(): NpcWanderField {
  const built = buildNpcWanderField(patrolRoom(), 'guard')
  expect(built).not.toBeNull()
  return built!
}

function seedFor(built: NpcWanderField): number {
  return stableHash32(`${built.roomId}:${built.npcId}`)
}

describe('buildNpcPatrolRoute', () => {
  it('returns between PATROL_MIN_WAYPOINTS and PATROL_MAX_WAYPOINTS validated waypoints in a clear room', () => {
    const built = field()
    const route = buildNpcPatrolRoute(built, seedFor(built))

    expect(route).not.toBeNull()
    expect(route!.npcId).toBe('guard')
    expect(route!.mode).toBe('ping-pong')
    expect(route!.waypoints.length).toBeGreaterThanOrEqual(PATROL_MIN_WAYPOINTS)
    expect(route!.waypoints.length).toBeLessThanOrEqual(PATROL_MAX_WAYPOINTS)
  })

  it('returns null when the room cannot fit two valid waypoints (fail-closed)', () => {
    const boxedField: NpcWanderField = {
      roomId: 'boxed',
      npcId: 'npc',
      home: { x: 0, z: 0 },
      bounds: { halfX: 8, halfZ: 8 },
      exclusions: [{ x: 0, z: 0, radius: NPC_WANDER.STEP_MAX + 0.1, reason: 'footprint' }],
    }

    expect(buildNpcPatrolRoute(boxedField, 1)).toBeNull()
  })

  it('returns null for non-finite home or seed', () => {
    const built = field()

    expect(buildNpcPatrolRoute({ ...built, home: { x: NaN, z: 0 } }, seedFor(built))).toBeNull()
    expect(buildNpcPatrolRoute({ ...built, home: { x: 0, z: Infinity } }, seedFor(built))).toBeNull()
    expect(buildNpcPatrolRoute(built, NaN)).toBeNull()
  })

  it('every waypoint passes isWanderPositionAllowed and every consecutive segment passes isWanderSegmentAllowed', () => {
    const built = field()
    const route = buildNpcPatrolRoute(built, seedFor(built))
    expect(route).not.toBeNull()

    for (const waypoint of route!.waypoints) {
      expect(isWanderPositionAllowed(built, waypoint)).toBe(true)
    }
    for (let index = 1; index < route!.waypoints.length; index += 1) {
      expect(isWanderSegmentAllowed(built, route!.waypoints[index - 1]!, route!.waypoints[index]!)).toBe(true)
    }
  })

  it('keeps every waypoint clear of exit / spawn / interactable / other-npc-home exclusion discs', () => {
    const built = field()
    const route = buildNpcPatrolRoute(built, seedFor(built))
    expect(route).not.toBeNull()

    for (const waypoint of route!.waypoints) {
      for (const disc of built.exclusions) {
        const distance = Math.hypot(disc.x - waypoint.x, disc.z - waypoint.z)
        expect(distance).toBeGreaterThanOrEqual(disc.radius)
      }
    }
  })

  it('is deterministic for the same field and seed', () => {
    const built = field()
    const seed = seedFor(built)

    expect(buildNpcPatrolRoute(built, seed)).toEqual(buildNpcPatrolRoute(built, seed))
  })

  it('does not mutate the input field', () => {
    const built = field()
    const before = JSON.stringify(built)

    buildNpcPatrolRoute(built, seedFor(built))

    expect(JSON.stringify(built)).toBe(before)
  })
})
