import type { NPCDialogueTarget } from './dialogue'
import type { NPCDialogueInput } from '../dialogue/NPCDialogueService'
import type {
  BeliefDialogueContext,
  NPCDialogueTurn,
  QuestDialogueContext,
  RoomDialogueContext,
  RoomMemoryDialogueContext,
  RoutineDialogueContext,
} from '../domain/dialogue/contracts'
import type { NpcRelationshipState } from '../domain/npcRelationship/contracts'
import type { PromptTimeContext } from '../domain/world/worldClock'

export function buildNPCDialogueReplyInput({
  sessionId,
  target,
  history,
  promptId,
  playerLine,
  roomContext,
  questStage,
  memoryContext,
  beliefContext,
  relationshipState,
  timeContext,
  routineContext,
}: {
  sessionId: string
  target: NPCDialogueTarget
  history: NPCDialogueTurn[]
  promptId?: string
  playerLine?: string
  roomContext?: RoomDialogueContext
  questStage?: QuestDialogueContext
  memoryContext?: RoomMemoryDialogueContext
  beliefContext?: BeliefDialogueContext
  relationshipState?: NpcRelationshipState
  timeContext?: PromptTimeContext
  routineContext?: RoutineDialogueContext
}): NPCDialogueInput {
  return {
    sessionId,
    npcId: target.npcId,
    npcName: target.npcName,
    dialogue: target.dialogue,
    persona: target.persona,
    history,
    promptId,
    playerLine,
    ...(roomContext !== undefined ? { roomContext } : {}),
    ...(questStage !== undefined ? { quest: questStage } : {}),
    ...(memoryContext !== undefined ? { memoryContext } : {}),
    ...(beliefContext !== undefined ? { beliefContext } : {}),
    ...(relationshipState !== undefined ? { relationshipState } : {}),
    ...(timeContext !== undefined ? { timeContext } : {}),
    ...(routineContext !== undefined ? { routineContext } : {}),
  }
}
