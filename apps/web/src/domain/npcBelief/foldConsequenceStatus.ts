import type { WorldEvent } from '../world/events'
import type { DefeasibleNpcActionBinding } from './defeasibleBindings'
import type { NpcActionConsequenceStatus } from './planDefeasibleNpcAction'

type CommittedEvent = Extract<WorldEvent, { type: 'npc-action-committed' }>

function matchesBinding(
  event: CommittedEvent | Extract<WorldEvent, { type: 'npc-action-retracted' }>,
  binding: DefeasibleNpcActionBinding,
): boolean {
  return event.payload.npcId === binding.npcId
    && event.payload.roomId === binding.roomId
    && event.payload.action === 'bar-exit'
    && event.payload.targetObjectId === binding.targetObjectId
}

export function activeCommittedNpcAction(
  log: readonly WorldEvent[],
  binding: DefeasibleNpcActionBinding,
): CommittedEvent | undefined {
  let active: CommittedEvent | undefined
  for (const event of log) {
    if (event.type === 'npc-action-committed' && matchesBinding(event, binding)) {
      active = event
      continue
    }
    if (
      event.type === 'npc-action-retracted'
      && matchesBinding(event, binding)
      && active !== undefined
      && event.payload.supersedesEventId === active.eventId
    ) active = undefined
  }
  return active
}

export function foldConsequenceStatus(
  log: readonly WorldEvent[],
  binding: DefeasibleNpcActionBinding,
): NpcActionConsequenceStatus {
  let seenMatchingCommit = false
  let active: CommittedEvent | undefined
  for (const event of log) {
    if (event.type === 'npc-action-committed' && matchesBinding(event, binding)) {
      seenMatchingCommit = true
      active = event
      continue
    }
    if (
      event.type === 'npc-action-retracted'
      && matchesBinding(event, binding)
      && active !== undefined
      && event.payload.supersedesEventId === active.eventId
    ) active = undefined
  }
  if (active !== undefined) return 'active'
  return seenMatchingCommit ? 'retracted' : 'none'
}
