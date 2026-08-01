import type { WorldEvent } from '../world/events'
import { NPC_BELIEF_SCHEMA_VERSION, type NpcObservation } from './contracts'

export function deriveNpcObservations(
  log: readonly WorldEvent[],
  scope: { npcId: string; npcRoomId: string; itemId: string },
): NpcObservation[] {
  let playerRoomId: string | undefined
  const observations: NpcObservation[] = []

  for (const event of log) {
    if (event.type === 'session-started') {
      playerRoomId = event.payload.seed.startingRoomId
      continue
    }
    if (event.type === 'moved-to-room') {
      playerRoomId = event.payload.toRoomId
      continue
    }
    if (
      event.type !== 'item-discovered'
      || event.payload.roomId !== scope.npcRoomId
      || event.payload.itemId !== scope.itemId
      || playerRoomId !== scope.npcRoomId
    ) continue

    observations.push({
      schemaVersion: NPC_BELIEF_SCHEMA_VERSION,
      observerNpcId: scope.npcId,
      kind: 'item-taken-from-room',
      roomId: event.payload.roomId,
      itemId: event.payload.itemId,
      fidelity: 'full',
      sourceEventId: event.eventId,
      sourceSeq: event.seq,
      occurredAt: event.occurredAt,
    })
  }

  return observations.sort((left, right) => left.sourceSeq - right.sourceSeq)
}
