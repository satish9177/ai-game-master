import type { WorldState } from '../world/worldState'
import type { ObjectiveCondition, QuestSpec } from './questSpec'
import { isMeaningfulObjectiveSatisfied } from '../objectPurpose/meaningfulObjectConsequences'

export type QuestObjectiveView = {
  id: string
  text: string
  done: boolean
}

export type QuestView = {
  questId: string
  title: string
  status: 'active' | 'complete'
  activeObjectiveId: string | null
  objectives: QuestObjectiveView[]
}

export function evaluateCondition(condition: ObjectiveCondition, state: WorldState): boolean {
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

export function evaluateQuest(
  spec: QuestSpec,
  state: WorldState,
  options: { meaningfulObjectProgression?: boolean } = {},
): QuestView {
  const objectives: QuestObjectiveView[] = spec.objectives.map((obj) => ({
    id: obj.id,
    text: obj.text,
    done: evaluateCondition(obj.condition, state)
      || (options.meaningfulObjectProgression === true
        && isMeaningfulObjectiveSatisfied(state, spec.questId, obj.id, spec.anchorRoomId)),
  }))
  const complete = objectives.every((obj) => obj.done)
  const activeObjectiveId = objectives.find((obj) => !obj.done)?.id ?? null
  return {
    questId: spec.questId,
    title: spec.title,
    status: complete ? 'complete' : 'active',
    activeObjectiveId,
    objectives,
  }
}
