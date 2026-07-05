import { describe, expect, it } from 'vitest'
import { isWanderPositionAllowed, NPC_WANDER } from '../../../domain/npcMovementContract'
import type { NpcWanderField, WanderXZ } from '../../../domain/npcMovementContract'
import type { PatrolRoute } from '../../../domain/npcPatrolContract'
import { createInitialPatrolState, updatePatrolStep } from './patrolStep'
import type { NpcPatrolStepState } from './patrolStep'

function openField(): NpcWanderField {
  return {
    roomId: 'patrol-step-room',
    npcId: 'npc',
    home: { x: 0, z: 0 },
    bounds: { halfX: 8, halfZ: 8 },
    exclusions: [],
  }
}

function route(waypoints: readonly WanderXZ[]): PatrolRoute {
  return { npcId: 'npc', waypoints, mode: 'ping-pong' }
}

function distance(a: WanderXZ, b: WanderXZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function runSequence(
  field: NpcWanderField,
  patrolRoute: PatrolRoute,
  seed: string,
  dts: readonly number[],
): NpcPatrolStepState[] {
  let state = createInitialPatrolState(patrolRoute)
  return dts.map((dtS) => {
    state = updatePatrolStep({ state, route: patrolRoute, field, dtS, seed })
    return state
  })
}

describe('patrolStep', () => {
  it('createInitialPatrolState starts paused at the first waypoint', () => {
    const patrolRoute = route([{ x: 1, z: 0 }, { x: -1, z: 0 }])
    const state = createInitialPatrolState(patrolRoute)

    expect(state).toEqual({
      mode: 'pausing',
      position: { x: 1, z: 0 },
      waypointIndex: 0,
      direction: 1,
      pauseRemainingS: 0,
      stepIndex: 0,
    })
  })

  it('advances toward the next waypoint at MAX_SPEED', () => {
    const field = openField()
    const patrolRoute = route([{ x: 2, z: 0 }, { x: -2, z: 0 }])
    let state = createInitialPatrolState(patrolRoute)

    state = updatePatrolStep({ state, route: patrolRoute, field, dtS: 0.25, seed: 'speed' })

    expect(state.mode).toBe('moving')
    expect(distance({ x: 2, z: 0 }, state.position)).toBeCloseTo(NPC_WANDER.MAX_SPEED * 0.25, 10)
  })

  it('arrives and pauses at the target waypoint', () => {
    const field = openField()
    const patrolRoute = route([{ x: 2, z: 0 }, { x: -2, z: 0 }])
    let state = createInitialPatrolState(patrolRoute)

    for (let index = 0; state.mode !== 'pausing' || index === 0; index += 1) {
      state = updatePatrolStep({ state, route: patrolRoute, field, dtS: 100, seed: 'arrival' })
      if (index > 5) break
    }

    expect(state.mode).toBe('pausing')
    expect(state.position).toEqual({ x: -2, z: 0 })
    expect(state.pauseRemainingS).toBeGreaterThanOrEqual(NPC_WANDER.PAUSE_MIN_S)
    expect(state.pauseRemainingS).toBeLessThan(NPC_WANDER.PAUSE_MAX_S)
  })

  it('ping-pongs direction at both ends of the route', () => {
    const field = openField()
    const patrolRoute = route([{ x: 2, z: 0 }, { x: 0, z: 0 }, { x: -2, z: 0 }])
    let state = createInitialPatrolState(patrolRoute)
    const visited: WanderXZ[] = [state.position]

    for (let tick = 0; tick < 40; tick += 1) {
      state = updatePatrolStep({ state, route: patrolRoute, field, dtS: 5, seed: 'ping-pong' })
      if (state.mode === 'pausing') {
        state = { ...state, pauseRemainingS: 0 }
        visited.push(state.position)
      }
    }

    expect(visited).toContainEqual({ x: -2, z: 0 })
    expect(visited).toContainEqual({ x: 2, z: 0 })
    expect(visited.filter((p) => p.x === 2 && p.z === 0).length).toBeGreaterThan(1)
    expect(visited.filter((p) => p.x === -2 && p.z === 0).length).toBeGreaterThan(1)
  })

  it('treats non-finite or negative dtS as zero and does not teleport or corrupt state', () => {
    const field = openField()
    const patrolRoute = route([{ x: 2, z: 0 }, { x: -2, z: 0 }])
    const state = createInitialPatrolState(patrolRoute)

    const withNaN = updatePatrolStep({ state, route: patrolRoute, field, dtS: NaN, seed: 'dt-guard' })
    const withNegative = updatePatrolStep({ state, route: patrolRoute, field, dtS: -5, seed: 'dt-guard' })
    const withZero = updatePatrolStep({ state, route: patrolRoute, field, dtS: 0, seed: 'dt-guard' })

    expect(withNaN).toEqual(withZero)
    expect(withNegative).toEqual(withZero)
    expect(Number.isFinite(withZero.position.x)).toBe(true)
    expect(Number.isFinite(withZero.position.z)).toBe(true)
  })

  it('pauses safely in place when the current position becomes invalid', () => {
    const field: NpcWanderField = {
      ...openField(),
      exclusions: [{ x: 5, z: 5, radius: 1, reason: 'footprint' }],
    }
    const patrolRoute = route([{ x: 2, z: 0 }, { x: -2, z: 0 }])
    const invalidState: NpcPatrolStepState = {
      mode: 'moving',
      position: { x: 5, z: 5 },
      waypointIndex: 1,
      direction: 1,
      pauseRemainingS: 0,
      stepIndex: 0,
    }
    expect(isWanderPositionAllowed(field, invalidState.position)).toBe(false)

    const next = updatePatrolStep({ state: invalidState, route: patrolRoute, field, dtS: 0.5, seed: 'invalid-pos' })

    expect(next.mode).toBe('pausing')
    expect(next.position).toEqual({ x: 5, z: 5 })
  })

  it('revalidates the segment before stepping and pauses in place if the next step is unsafe', () => {
    const patrolRoute = route([{ x: 0, z: 0 }, { x: 2, z: 0 }])
    const field: NpcWanderField = {
      ...openField(),
      exclusions: [{ x: 0.6, z: 0, radius: 0.3, reason: 'footprint' }],
    }
    const state: NpcPatrolStepState = {
      mode: 'moving',
      position: { x: 0, z: 0 },
      waypointIndex: 1,
      direction: 1,
      pauseRemainingS: 0,
      stepIndex: 0,
    }
    expect(isWanderPositionAllowed(field, state.position)).toBe(true)

    const next = updatePatrolStep({ state, route: patrolRoute, field, dtS: 0.5, seed: 'segment' })

    expect(next.mode).toBe('pausing')
    expect(next.position).toEqual({ x: 0, z: 0 })
  })

  it('is deterministic for the same route, field, seed, and dt sequence', () => {
    const field = openField()
    const patrolRoute = route([{ x: 2, z: 0 }, { x: -2, z: 0 }])
    const dts = [0.1, 0.2, 0.35, 1.2, 0.016, 0.5, 2.1, 0.3, 4]

    expect(runSequence(field, patrolRoute, 'same-seed', dts))
      .toEqual(runSequence(field, patrolRoute, 'same-seed', dts))
  })

  it('does not mutate input state, route, or field', () => {
    const field = openField()
    const patrolRoute = route([{ x: 2, z: 0 }, { x: -2, z: 0 }])
    const state = createInitialPatrolState(patrolRoute)
    const fieldBefore = JSON.stringify(field)
    const routeBefore = JSON.stringify(patrolRoute)
    const stateBefore = JSON.stringify(state)

    const next = updatePatrolStep({ state, route: patrolRoute, field, dtS: 0.2, seed: 'immutable' })

    expect(JSON.stringify(field)).toBe(fieldBefore)
    expect(JSON.stringify(patrolRoute)).toBe(routeBefore)
    expect(JSON.stringify(state)).toBe(stateBefore)
    expect(next).not.toBe(state)
    expect(next.position).not.toBe(state.position)
  })

  it('does not construct WebGL or Engine objects', () => {
    const field = openField()
    const patrolRoute = route([{ x: 2, z: 0 }, { x: -2, z: 0 }])

    expect(() => {
      updatePatrolStep({
        state: createInitialPatrolState(patrolRoute),
        route: patrolRoute,
        field,
        dtS: 0.1,
        seed: 'pure',
      })
    }).not.toThrow()
  })
})
