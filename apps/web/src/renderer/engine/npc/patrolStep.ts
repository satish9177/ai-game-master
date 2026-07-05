import { stableHash32 } from '../../../domain/stableHash'
import {
  distanceXZ,
  isWanderPositionAllowed,
  isWanderSegmentAllowed,
  NPC_WANDER,
  wanderPauseSeconds,
} from '../../../domain/npcMovementContract'
import type { NpcWanderField, WanderXZ } from '../../../domain/npcMovementContract'
import type { PatrolRoute } from '../../../domain/npcPatrolContract'

export type NpcPatrolMode = 'moving' | 'pausing'

export type NpcPatrolStepState = {
  mode: NpcPatrolMode
  position: { x: number; z: number }
  waypointIndex: number
  direction: 1 | -1
  pauseRemainingS: number
  stepIndex: number
}

export function createInitialPatrolState(route: PatrolRoute): NpcPatrolStepState {
  const first = route.waypoints[0]!
  return {
    mode: 'pausing',
    position: { x: first.x, z: first.z },
    waypointIndex: 0,
    direction: 1,
    pauseRemainingS: 0,
    stepIndex: 0,
  }
}

export function updatePatrolStep(args: {
  state: NpcPatrolStepState
  route: PatrolRoute
  field: NpcWanderField
  dtS: number
  seed: string
}): NpcPatrolStepState {
  const dtS = Number.isFinite(args.dtS) ? Math.max(0, args.dtS) : 0
  const state = args.state
  const waypoints = args.route.waypoints

  if (waypoints.length < 2 || !isWanderPositionAllowed(args.field, state.position)) {
    return pauseSafely(state.position, state.waypointIndex, state.direction, state.pauseRemainingS, state.stepIndex)
  }

  const seed = stableHash32(args.seed)

  if (state.mode === 'moving') {
    const target = waypoints[state.waypointIndex]!
    return moveTowardTarget({
      field: args.field,
      position: state.position,
      target,
      dtS,
      seed,
      waypointIndex: state.waypointIndex,
      direction: state.direction,
      stepIndex: state.stepIndex,
    })
  }

  const pauseRemainingS = Math.max(0, state.pauseRemainingS - dtS)
  if (pauseRemainingS > 0) {
    return {
      mode: 'pausing',
      position: copyPosition(state.position),
      waypointIndex: state.waypointIndex,
      direction: state.direction,
      pauseRemainingS,
      stepIndex: state.stepIndex,
    }
  }

  const next = nextWaypoint(state.waypointIndex, state.direction, waypoints.length)
  const target = waypoints[next.waypointIndex]!
  if (
    !isWanderPositionAllowed(args.field, target)
    || !isWanderSegmentAllowed(args.field, state.position, target)
  ) {
    return pauseSafely(state.position, state.waypointIndex, state.direction, 0, state.stepIndex)
  }

  return moveTowardTarget({
    field: args.field,
    position: state.position,
    target,
    dtS,
    seed,
    waypointIndex: next.waypointIndex,
    direction: next.direction,
    stepIndex: state.stepIndex,
  })
}

function nextWaypoint(
  currentIndex: number,
  direction: 1 | -1,
  length: number,
): { waypointIndex: number; direction: 1 | -1 } {
  let nextDirection = direction
  if (currentIndex === length - 1 && direction === 1) nextDirection = -1
  else if (currentIndex === 0 && direction === -1) nextDirection = 1
  return { waypointIndex: currentIndex + nextDirection, direction: nextDirection }
}

function moveTowardTarget(args: {
  field: NpcWanderField
  position: WanderXZ
  target: WanderXZ
  dtS: number
  seed: number
  waypointIndex: number
  direction: 1 | -1
  stepIndex: number
}): NpcPatrolStepState {
  if (!isWanderPositionAllowed(args.field, args.target)) {
    return pauseSafely(args.position, args.waypointIndex, args.direction, 0, args.stepIndex)
  }

  const remainingDistance = distanceXZ(args.position, args.target)
  const maxDistance = NPC_WANDER.MAX_SPEED * args.dtS

  if (remainingDistance <= maxDistance) {
    return {
      mode: 'pausing',
      position: copyPosition(args.target),
      waypointIndex: args.waypointIndex,
      direction: args.direction,
      pauseRemainingS: wanderPauseSeconds(args.seed, args.stepIndex),
      stepIndex: args.stepIndex + 1,
    }
  }

  if (remainingDistance === 0) {
    return pauseSafely(
      args.position,
      args.waypointIndex,
      args.direction,
      wanderPauseSeconds(args.seed, args.stepIndex),
      args.stepIndex,
    )
  }

  const t = maxDistance / remainingDistance
  const nextPosition = {
    x: args.position.x + (args.target.x - args.position.x) * t,
    z: args.position.z + (args.target.z - args.position.z) * t,
  }

  if (!isWanderSegmentAllowed(args.field, args.position, nextPosition)) {
    return pauseSafely(args.position, args.waypointIndex, args.direction, 0, args.stepIndex)
  }

  return {
    mode: 'moving',
    position: nextPosition,
    waypointIndex: args.waypointIndex,
    direction: args.direction,
    pauseRemainingS: 0,
    stepIndex: args.stepIndex,
  }
}

function pauseSafely(
  position: WanderXZ,
  waypointIndex: number,
  direction: 1 | -1,
  pauseRemainingS: number,
  stepIndex: number,
): NpcPatrolStepState {
  return {
    mode: 'pausing',
    position: copyPosition(position),
    waypointIndex,
    direction,
    pauseRemainingS: Math.max(0, pauseRemainingS),
    stepIndex,
  }
}

function copyPosition(position: WanderXZ): { x: number; z: number } {
  return { x: position.x, z: position.z }
}
