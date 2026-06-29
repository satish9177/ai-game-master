import type { QuestObjective } from '../quests/questSpec'
import type { NPCObjectiveContext, NPCObjectiveKind } from './contracts'

export function buildNPCObjectiveContext(
  activeObjective: QuestObjective | null,
  status: NPCObjectiveContext['status'],
): NPCObjectiveContext | undefined {
  if (activeObjective == null) return undefined
  return {
    status,
    kind: kindFromCondition(activeObjective.condition),
  }
}

function kindFromCondition(condition: QuestObjective['condition']): NPCObjectiveKind {
  switch (condition.kind) {
    case 'room-flag':
      if (condition.flag.startsWith('interaction:')) return 'inspect'
      if (condition.flag.startsWith('encounter:')) return 'resolve'
      return 'general'
    case 'room-visited':
      return 'reach'
    case 'has-item':
    case 'has-status':
      return 'general'
  }
}
