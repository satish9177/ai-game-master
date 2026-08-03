import type { LoadedRoom } from '../loadRoomSpec'
import { WorldCommandSchema, type WorldCommand, type WorldEvent } from '../world/events'
import {
  defeasibleNpcActionBindingFor,
  type DefeasibleNpcActionBinding,
} from './defeasibleBindings'
import {
  evidenceHolderScopeFor,
  selectRetractionEvidence,
} from './evidenceObservation'
import { activeCommittedNpcAction, foldConsequenceStatus } from './foldConsequenceStatus'
import { normalizeCommittedBeliefWarrant, type WarrantPremiseId } from './beliefVersions'

export const NPC_ACTION_RETRACTION_RULE_ID =
  'defeasible-npc-action/retract-on-undercutting-evidence@1' as const

export type NpcActionRetractionRefusalReason =
  | 'no-binding'
  | 'actor-not-in-room'
  | 'target-not-in-room'
  | 'nothing-to-retract'
  | 'already-retracted'
  | 'no-evidence'
  | 'evidence-out-of-scope'
  | 'unknown-evidence-target'
  | 'evidence-provenance-invalid'
  | 'no-defeater'
  | 'defeater-targets-unknown-premise'
  | 'defeater-targets-indefeasible-premise'
  | 'replacement-not-reachable'

export type NpcActionRetractionCommand = Extract<
  WorldCommand,
  { type: 'npc-action-retracted' }
>

export type NpcActionRetractionPlan =
  | Readonly<{
      status: 'retract'
      command: NpcActionRetractionCommand
      ruleId: typeof NPC_ACTION_RETRACTION_RULE_ID
      defeatedPremiseId: WarrantPremiseId
      evidenceId: string
      supersedesEventId: string
      supportingEventIds: readonly [string, string]
      presentationEvent: Extract<WorldEvent, { type: 'evidence-presented' }>
      discoveryEvent: Extract<WorldEvent, { type: 'evidence-discovered' }>
    }>
  | Readonly<{ status: 'refused'; reason: NpcActionRetractionRefusalReason }>

export function planNpcActionRetraction(input: Readonly<{
  room: LoadedRoom
  log: readonly WorldEvent[]
  binding?: DefeasibleNpcActionBinding
}>): NpcActionRetractionPlan {
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

  const consequenceStatus = foldConsequenceStatus(input.log, binding)
  if (consequenceStatus === 'none') {
    return { status: 'refused', reason: 'nothing-to-retract' }
  }
  if (consequenceStatus === 'retracted') {
    return { status: 'refused', reason: 'already-retracted' }
  }
  const committed = activeCommittedNpcAction(input.log, binding)
  if (committed === undefined) return { status: 'refused', reason: 'nothing-to-retract' }

  const warrant = normalizeCommittedBeliefWarrant({
    belief: committed.payload.belief,
    supportingEventIds: committed.payload.supportingEventIds,
  })
  const selected = selectRetractionEvidence({
    log: input.log,
    scope: evidenceHolderScopeFor(binding),
    warrant,
  })
  if (selected.status === 'refused') return selected
  const { revision } = selected

  const command = WorldCommandSchema.parse({
    schemaVersion: 1,
    type: 'npc-action-retracted',
    npcId: binding.npcId,
    roomId: binding.roomId,
    action: 'bar-exit',
    targetObjectId: binding.targetObjectId,
  }) as NpcActionRetractionCommand
  return {
    status: 'retract',
    command,
    ruleId: NPC_ACTION_RETRACTION_RULE_ID,
    defeatedPremiseId: revision.defeatedPremiseId,
    evidenceId: revision.evidenceId,
    supersedesEventId: committed.eventId,
    supportingEventIds: [selected.presentationEvent.eventId, selected.discoveryEvent.eventId],
    presentationEvent: selected.presentationEvent,
    discoveryEvent: selected.discoveryEvent,
  }
}
