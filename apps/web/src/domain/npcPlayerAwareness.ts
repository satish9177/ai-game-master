import { distanceXZ } from './npcMovementContract'

export const NPC_PLAYER_AWARENESS = {
  ALERTED_RADIUS: 1.5,
  AWARE_RADIUS: 3.0,
  NEARBY_RADIUS: 5.0,
} as const

export type NpcPlayerAwarenessLevel = 'unaware' | 'nearby' | 'aware' | 'alerted'

export type NpcPlayerAwarenessReason = 'proximity' | 'different-room' | 'missing-position'

export type AwarenessXZ = Readonly<{ x: number; z: number }>

export type NpcPlayerAwarenessState = Readonly<{
  npcId: string
  level: NpcPlayerAwarenessLevel
  distance: number | null
  reason: NpcPlayerAwarenessReason
}>

export function detectNpcPlayerAwareness(input: {
  npcId: string
  npcPosition: AwarenessXZ
  playerPosition: AwarenessXZ
  sameRoom: boolean
}): NpcPlayerAwarenessState {
  const { npcId, npcPosition, playerPosition, sameRoom } = input

  if (!sameRoom) {
    return { npcId, level: 'unaware', distance: null, reason: 'different-room' }
  }

  if (
    !Number.isFinite(npcPosition.x) || !Number.isFinite(npcPosition.z)
    || !Number.isFinite(playerPosition.x) || !Number.isFinite(playerPosition.z)
  ) {
    return { npcId, level: 'unaware', distance: null, reason: 'missing-position' }
  }

  const distance = distanceXZ(npcPosition, playerPosition)
  const level: NpcPlayerAwarenessLevel = distance <= NPC_PLAYER_AWARENESS.ALERTED_RADIUS
    ? 'alerted'
    : distance <= NPC_PLAYER_AWARENESS.AWARE_RADIUS
      ? 'aware'
      : distance <= NPC_PLAYER_AWARENESS.NEARBY_RADIUS
        ? 'nearby'
        : 'unaware'

  return { npcId, level, distance, reason: 'proximity' }
}
