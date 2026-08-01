import type { LoadedRoom } from '../loadRoomSpec'
import { WorldCommandSchema } from '../world/events'
import type { WorldCommand, WorldEvent } from '../world/events'
import type { WorldState } from '../world/worldState'
import { deriveNpcBelief } from './beliefFromObservations'
import { npcActionBindingFor, type NpcBelief } from './contracts'
import { deriveNpcObservations } from './observationScope'

export const BELIEF_GATED_NPC_ACTION_RULE_ID =
  'belief-gated-npc-action/bar-exit-on-witnessed-take@1' as const

export type NpcActionRefusalReason =
  | 'no-binding'
  | 'actor-not-in-room'
  | 'target-not-in-room'
  | 'already-acted'
  | 'no-qualifying-observation'

export type NpcActionPlan =
  | { status: 'commit'; command: WorldCommand; belief: NpcBelief; ruleId: string }
  | { status: 'refused'; reason: NpcActionRefusalReason }

export function planBeliefGatedNpcAction(input: {
  room: LoadedRoom
  state: WorldState
  log: readonly WorldEvent[]
}): NpcActionPlan {
  const binding = npcActionBindingFor(input.room.id)
  if (binding === undefined) return { status: 'refused', reason: 'no-binding' }

  const actors = input.room.objects.filter(
    (object) => object.id === binding.npcId && object.type === 'npc',
  )
  if (actors.length !== 1) return { status: 'refused', reason: 'actor-not-in-room' }

  const targets = input.room.objects.filter(
    (object) => object.id === binding.targetObjectId
      && 'interaction' in object
      && object.interaction?.exit !== undefined,
  )
  if (targets.length !== 1) return { status: 'refused', reason: 'target-not-in-room' }

  const alreadyActed = input.log.some(
    (event) => event.type === 'npc-action-committed'
      && event.payload.npcId === binding.npcId
      && event.payload.action === 'bar-exit',
  )
  if (alreadyActed) return { status: 'refused', reason: 'already-acted' }

  const observations = deriveNpcObservations(input.log, {
    npcId: binding.npcId,
    npcRoomId: input.room.id,
    itemId: binding.triggerItemId,
  })
  const belief = deriveNpcBelief(observations)
  if (belief === null) return { status: 'refused', reason: 'no-qualifying-observation' }

  return {
    status: 'commit',
    belief,
    ruleId: BELIEF_GATED_NPC_ACTION_RULE_ID,
    command: WorldCommandSchema.parse({
      schemaVersion: 1,
      type: 'npc-action-committed',
      npcId: binding.npcId,
      roomId: input.room.id,
      action: 'bar-exit',
      targetObjectId: binding.targetObjectId,
    }),
  }
}
