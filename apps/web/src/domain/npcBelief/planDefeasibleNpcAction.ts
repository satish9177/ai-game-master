import type { LoadedRoom } from '../loadRoomSpec'
import { WorldCommandSchema, type WorldCommand } from '../world/events'
import {
  defeasibleNpcActionBindingFor,
  type DefeasibleNpcActionBinding,
} from './defeasibleBindings'
import { deriveWarrant, type WarrantAbstentionReason } from './deriveWarrant'
import type { NpcBeliefV1, NpcBeliefV2, NpcBeliefWarrant } from './beliefVersions'
import type { DefeasibleNpcObservation } from './observationScopeV2'

export const DEFEASIBLE_NPC_ACTION_RULE_ID =
  'defeasible-npc-action/bar-exit-on-warranted-take@1' as const

export type NpcActionConsequenceStatus = 'none' | 'active' | 'retracted'

export type DefeasibleNpcActionRefusalReason =
  | 'no-binding'
  | 'actor-not-in-room'
  | 'target-not-in-room'
  | 'already-acted'
  | 'no-qualifying-observation'
  | 'below-confidence-threshold'
  | 'already-retracted'

export type DefeasibleNpcActionPlan =
  | Readonly<{
      status: 'commit'
      basis: 'direct-witness'
      belief: NpcBeliefV1
      warrant: NpcBeliefWarrant
      ruleId: typeof DEFEASIBLE_NPC_ACTION_RULE_ID
      command: WorldCommand
    }>
  | Readonly<{
      status: 'commit'
      basis: 'inferred'
      belief: NpcBeliefV2
      warrant: NpcBeliefWarrant
      ruleId: typeof DEFEASIBLE_NPC_ACTION_RULE_ID
      command: WorldCommand
    }>
  | Readonly<{
      status: 'refused'
      reason: 'no-qualifying-observation'
      abstention: WarrantAbstentionReason
    }>
  | Readonly<{
      status: 'refused'
      reason: Exclude<DefeasibleNpcActionRefusalReason, 'no-qualifying-observation'>
    }>

type PlannerInput = Readonly<{
  room: LoadedRoom
  observations: readonly DefeasibleNpcObservation[]
  consequenceStatus: NpcActionConsequenceStatus
  binding?: DefeasibleNpcActionBinding
}>

function meetsConfidenceThreshold(
  actual: 'low' | 'high',
  minimum: 'low' | 'high',
): boolean {
  return minimum === 'low' || actual === 'high'
}

export function planDefeasibleNpcAction(input: PlannerInput): DefeasibleNpcActionPlan {
  const binding = input.binding ?? defeasibleNpcActionBindingFor(input.room.id)
  if (binding === undefined || binding.roomId !== input.room.id) {
    return { status: 'refused', reason: 'no-binding' }
  }

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

  if (input.consequenceStatus === 'active') {
    return { status: 'refused', reason: 'already-acted' }
  }
  if (input.consequenceStatus === 'retracted') {
    return { status: 'refused', reason: 'already-retracted' }
  }

  const warrantResult = deriveWarrant({
    observations: input.observations,
    holderNpcId: binding.npcId,
    roomId: binding.roomId,
    itemId: binding.triggerItemId,
  })
  if (warrantResult.status === 'abstained') {
    return {
      status: 'refused',
      reason: 'no-qualifying-observation',
      abstention: warrantResult.reason,
    }
  }
  if (!meetsConfidenceThreshold(warrantResult.derived.confidence, binding.minConfidence)) {
    return { status: 'refused', reason: 'below-confidence-threshold' }
  }

  const command = WorldCommandSchema.parse({
    schemaVersion: 1,
    type: 'npc-action-committed',
    npcId: binding.npcId,
    roomId: binding.roomId,
    action: 'bar-exit',
    targetObjectId: binding.targetObjectId,
  })
  const common = {
    status: 'commit' as const,
    warrant: warrantResult.derived.warrant,
    ruleId: DEFEASIBLE_NPC_ACTION_RULE_ID,
    command,
  }

  if (warrantResult.derived.beliefVersion === 1) {
    return {
      ...common,
      basis: 'direct-witness',
      belief: {
        schemaVersion: 1,
        holderNpcId: binding.npcId,
        predicate: 'player-took-item',
        itemId: warrantResult.derived.itemId,
        roomId: binding.roomId,
        confidence: 'high',
        supportingEventIds: warrantResult.derived.supportingEventIds,
        lastUpdatedSeq: warrantResult.derived.lastUpdatedSeq,
      },
    }
  }

  return {
    ...common,
    basis: 'inferred',
    belief: {
      schemaVersion: 2,
      holderNpcId: binding.npcId,
      predicate: 'player-took-item',
      itemId: warrantResult.derived.itemId,
      roomId: binding.roomId,
      confidence: warrantResult.derived.confidence,
      warrant: warrantResult.derived.warrant,
      supportingEventIds: warrantResult.derived.supportingEventIds,
      lastUpdatedSeq: warrantResult.derived.lastUpdatedSeq,
    },
  }
}
