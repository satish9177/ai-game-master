import type { WorldState } from '../world/worldState'
import type { ObjectiveCondition, QuestSpec } from './questSpec'

export type QuestObjectiveView = {
  id: string
  text: string
  done: boolean
}

export type QuestView = {
  questId: string
  title: string
  status: 'active' | 'complete'
  objectives: QuestObjectiveView[]
}

function evaluateCondition(condition: ObjectiveCondition, state: WorldState): boolean {
  switch (condition.kind) {
    case 'room-flag':
      return state.roomStates[condition.roomId]?.flags?.[condition.flag] === true
    case 'has-item': {
      const min = condition.min ?? 1
      const item = state.inventory.find((i) => i.itemId === condition.itemId)
      return item != null && item.quantity >= min
    }
    case 'room-visited':
      return state.roomStates[condition.roomId]?.visited === true
    case 'has-status':
      return state.player.status.includes(condition.status)
  }
}

export function evaluateQuest(spec: QuestSpec, state: WorldState): QuestView {
  const objectives: QuestObjectiveView[] = spec.objectives.map((obj) => ({
    id: obj.id,
    text: obj.text,
    done: evaluateCondition(obj.condition, state),
  }))
  const complete = objectives.every((obj) => obj.done)
  return {
    questId: spec.questId,
    title: spec.title,
    status: complete ? 'complete' : 'active',
    objectives,
  }
}
