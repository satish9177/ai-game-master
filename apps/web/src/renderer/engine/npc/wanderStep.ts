import { stableHash32 } from '../../../domain/stableHash'
import {
  chooseWanderStep,
  distanceXZ,
  isWanderPositionAllowed,
  isWanderSegmentAllowed,
  NPC_WANDER,
  wanderPauseSeconds,
} from '../../../domain/npcMovementContract'
import type { NpcWanderField, WanderXZ } from '../../../domain/npcMovementContract'

export type NpcWanderMode = 'moving' | 'pausing'

export type NpcWanderStepState = {
  mode: NpcWanderMode
  position: { x: number; z: number }
  target: { x: number; z: number } | null
  pauseRemainingS: number
  stepIndex: number
}

export function createInitialWanderState(home: WanderXZ): NpcWanderStepState {
  return {
    mode: 'pausing',
    position: { x: home.x, z: home.z },
    target: null,
    pauseRemainingS: 0,
    stepIndex: 0,
  }
}

export function updateWanderStep(args: {
  state: NpcWanderStepState
  field: NpcWanderField
  dtS: number
  seed: string
}): NpcWanderStepState {
  const dtS = Number.isFinite(args.dtS) ? Math.max(0, args.dtS) : 0
  const seed = stableHash32(args.seed)
  const state = args.state

  if (!isWanderPositionAllowed(args.field, state.position)) {
    return pauseSafely(state.position, state.stepIndex, state.pauseRemainingS)
  }

  if (state.mode === 'moving' && state.target !== null) {
    return moveTowardTarget({
      field: args.field,
      position: state.position,
      target: state.target,
      dtS,
      seed,
      stepIndex: state.stepIndex,
    })
  }

  const pauseRemainingS = Math.max(0, state.pauseRemainingS - dtS)
  if (pauseRemainingS > 0) {
    return {
      mode: 'pausing',
      position: copyPosition(state.position),
      target: null,
      pauseRemainingS,
      stepIndex: state.stepIndex,
    }
  }

  const step = chooseWanderStep(args.field, state.position, seed, state.stepIndex)
  if (step === null || !isWanderPositionAllowed(args.field, step.target)) {
    return pauseSafely(state.position, state.stepIndex, 0)
  }

  return moveTowardTarget({
    field: args.field,
    position: state.position,
    target: step.target,
    dtS,
    seed,
    stepIndex: state.stepIndex,
  })
}

function moveTowardTarget(args: {
  field: NpcWanderField
  position: WanderXZ
  target: WanderXZ
  dtS: number
  seed: number
  stepIndex: number
}): NpcWanderStepState {
  if (!isWanderPositionAllowed(args.field, args.target)) {
    return pauseSafely(args.position, args.stepIndex, 0)
  }

  const remainingDistance = distanceXZ(args.position, args.target)
  const maxDistance = NPC_WANDER.MAX_SPEED * args.dtS

  if (remainingDistance <= maxDistance) {
    return {
      mode: 'pausing',
      position: copyPosition(args.target),
      target: null,
      pauseRemainingS: wanderPauseSeconds(args.seed, args.stepIndex),
      stepIndex: args.stepIndex + 1,
    }
  }

  if (remainingDistance === 0) {
    return pauseSafely(args.position, args.stepIndex, wanderPauseSeconds(args.seed, args.stepIndex))
  }

  const t = maxDistance / remainingDistance
  const nextPosition = {
    x: args.position.x + (args.target.x - args.position.x) * t,
    z: args.position.z + (args.target.z - args.position.z) * t,
  }

  if (!isWanderSegmentAllowed(args.field, args.position, nextPosition)) {
    return pauseSafely(args.position, args.stepIndex, 0)
  }

  return {
    mode: 'moving',
    position: nextPosition,
    target: copyPosition(args.target),
    pauseRemainingS: 0,
    stepIndex: args.stepIndex,
  }
}

function pauseSafely(position: WanderXZ, stepIndex: number, pauseRemainingS: number): NpcWanderStepState {
  return {
    mode: 'pausing',
    position: copyPosition(position),
    target: null,
    pauseRemainingS: Math.max(0, pauseRemainingS),
    stepIndex,
  }
}

function copyPosition(position: WanderXZ): { x: number; z: number } {
  return { x: position.x, z: position.z }
}
