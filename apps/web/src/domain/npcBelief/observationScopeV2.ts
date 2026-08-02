import { interactionFlagKey } from '../interactions/interactionFlags'
import type { WorldEvent } from '../world/events'
import {
  NPC_BELIEF_SCHEMA_VERSION,
  type NpcObservation,
} from './contracts'

export type DefeasibleNpcObservation =
  | NpcObservation
  | Readonly<{
      schemaVersion: 1
      observerNpcId: string
      kind: 'container-state-read'
      fidelity: 'partial'
      roomId: string
      containerId: string
      contents: 'present' | 'absent'
      missing: readonly ['actor', 'action']
      sourceEventId: string
      sourceSeq: number
      occurredAt: string
    }>
  | Readonly<{
      schemaVersion: 1
      observerNpcId: string
      kind: 'actor-co-present'
      fidelity: 'full'
      roomId: string
      actorId: string
      fromSeq: number
      toSeq: number
      sourceEventId: string
      sourceSeq: number
      occurredAt: string
    }>

export type DefeasibleObservationScope = Readonly<{
  npcId: string
  npcRoomId: string
  itemId: string
  containerId: string
  attentionObjectIds: readonly string[]
  initialContents: 'present' | 'absent'
}>

export function deriveDefeasibleObservations(
  log: readonly WorldEvent[],
  scope: DefeasibleObservationScope,
): DefeasibleNpcObservation[] {
  let playerRoomId: string | undefined
  let containerContents: 'present' | 'absent' = scope.initialContents
  let activePlayerSpanIndex: number | undefined
  const observations: DefeasibleNpcObservation[] = []
  const attentionKeys = new Set(
    scope.attentionObjectIds
      .map((objectId) => interactionFlagKey(undefined, objectId))
      .filter((key): key is string => key !== undefined),
  )
  const containerFlagKey = interactionFlagKey(undefined, scope.containerId)

  const emitContainerRead = (event: WorldEvent): void => {
    observations.push({
      schemaVersion: NPC_BELIEF_SCHEMA_VERSION,
      observerNpcId: scope.npcId,
      kind: 'container-state-read',
      fidelity: 'partial',
      roomId: scope.npcRoomId,
      containerId: scope.containerId,
      contents: containerContents,
      missing: ['actor', 'action'],
      sourceEventId: event.eventId,
      sourceSeq: event.seq,
      occurredAt: event.occurredAt,
    })
  }

  const beginPlayerSpan = (event: WorldEvent): void => {
    observations.push({
      schemaVersion: NPC_BELIEF_SCHEMA_VERSION,
      observerNpcId: scope.npcId,
      kind: 'actor-co-present',
      fidelity: 'full',
      roomId: scope.npcRoomId,
      actorId: 'player',
      fromSeq: event.seq,
      toSeq: event.seq,
      sourceEventId: event.eventId,
      sourceSeq: event.seq,
      occurredAt: event.occurredAt,
    })
    activePlayerSpanIndex = observations.length - 1
  }

  const extendPlayerSpan = (toSeq: number): void => {
    if (activePlayerSpanIndex === undefined) return
    const active = observations[activePlayerSpanIndex]
    if (active?.kind !== 'actor-co-present') return
    observations[activePlayerSpanIndex] = { ...active, toSeq }
  }

  for (const event of log) {
    if (event.type === 'session-started') {
      playerRoomId = event.payload.seed.startingRoomId
      activePlayerSpanIndex = undefined
      if (playerRoomId === scope.npcRoomId) {
        emitContainerRead(event)
        beginPlayerSpan(event)
      }
      continue
    }

    if (event.type === 'moved-to-room') {
      playerRoomId = event.payload.toRoomId
      activePlayerSpanIndex = undefined
      if (playerRoomId === scope.npcRoomId) {
        emitContainerRead(event)
        beginPlayerSpan(event)
      }
      continue
    }

    if (event.type === 'offstage-item-taken') {
      if (
        event.payload.roomId === scope.npcRoomId
        && event.payload.containerId === scope.containerId
        && event.payload.itemId === scope.itemId
      ) containerContents = 'absent'
      continue
    }

    if (playerRoomId === scope.npcRoomId) extendPlayerSpan(event.seq)

    if (
      event.type === 'item-discovered'
      && event.payload.roomId === scope.npcRoomId
      && event.payload.itemId === scope.itemId
      && playerRoomId === scope.npcRoomId
    ) {
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
      continue
    }

    if (event.type !== 'room-state-changed' || event.payload.roomId !== scope.npcRoomId) {
      continue
    }

    const flags = event.payload.flags
    if (flags !== undefined && containerFlagKey !== undefined && containerFlagKey in flags) {
      containerContents = flags[containerFlagKey] === true ? 'absent' : 'present'
    }
    if (
      playerRoomId === scope.npcRoomId
      && flags !== undefined
      && Object.entries(flags).some(([key, value]) => value === true && attentionKeys.has(key))
    ) emitContainerRead(event)
  }

  return observations
}
