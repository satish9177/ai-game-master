import { chooseWanderStep } from './npcMovementContract'
import type { NpcWanderField, WanderXZ } from './npcMovementContract'

export const PATROL_MIN_WAYPOINTS = 2
export const PATROL_MAX_WAYPOINTS = 4

export type PatrolWaypoint = WanderXZ

export type PatrolRoute = Readonly<{
  npcId: string
  waypoints: readonly PatrolWaypoint[]
  mode: 'ping-pong'
}>

export function buildNpcPatrolRoute(field: NpcWanderField, seed: number): PatrolRoute | null {
  if (!Number.isFinite(field.home.x) || !Number.isFinite(field.home.z) || !Number.isFinite(seed)) {
    return null
  }

  const waypoints: PatrolWaypoint[] = []
  let current: WanderXZ = field.home

  for (let stepIndex = 0; stepIndex < PATROL_MAX_WAYPOINTS; stepIndex += 1) {
    const step = chooseWanderStep(field, current, seed, stepIndex)
    if (!step) break
    waypoints.push(step.target)
    current = step.target
  }

  if (waypoints.length < PATROL_MIN_WAYPOINTS) return null

  return { npcId: field.npcId, waypoints, mode: 'ping-pong' }
}
