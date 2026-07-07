import {
  distanceXZ,
  isWanderPositionAllowed,
  isWanderSegmentAllowed,
  NPC_WANDER,
} from '../../../domain/npcMovementContract'
import type { NpcWanderField, WanderXZ } from '../../../domain/npcMovementContract'

export const CONTACT_STANDOFF = 0.8

export type NpcChaseStepResult = Readonly<{
  position: { x: number; z: number }
}>

export function chaseStep(args: {
  field: NpcWanderField
  position: WanderXZ
  playerTarget: WanderXZ
  dtS: number
}): NpcChaseStepResult {
  const position = args.position
  const playerTarget = args.playerTarget

  if (!isFinitePosition(position) || !isFinitePosition(playerTarget)) {
    return holdPosition(position)
  }

  const distanceToTarget = distanceXZ(position, playerTarget)
  if (distanceToTarget <= CONTACT_STANDOFF || distanceToTarget === 0) {
    return holdPosition(position)
  }

  const dtS = Number.isFinite(args.dtS) ? Math.max(0, args.dtS) : 0
  const maxDistance = NPC_WANDER.MAX_SPEED * dtS
  const stepDistance = Math.min(maxDistance, distanceToTarget - CONTACT_STANDOFF)

  if (stepDistance <= 0) {
    return holdPosition(position)
  }

  const t = stepDistance / distanceToTarget
  const nextPosition = {
    x: position.x + (playerTarget.x - position.x) * t,
    z: position.z + (playerTarget.z - position.z) * t,
  }

  if (
    !isWanderPositionAllowed(args.field, nextPosition)
    || !isWanderSegmentAllowed(args.field, position, nextPosition)
  ) {
    return holdPosition(position)
  }

  return { position: nextPosition }
}

function isFinitePosition(position: WanderXZ): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.z)
}

function holdPosition(position: WanderXZ): NpcChaseStepResult {
  return { position: { x: position.x, z: position.z } }
}
