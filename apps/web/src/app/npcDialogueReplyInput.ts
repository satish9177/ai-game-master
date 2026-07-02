import type { NPCDialogueTarget } from './dialogue'
import type { NPCDialogueInput } from '../dialogue/NPCDialogueService'
import type {
  NPCDialogueTurn,
  QuestDialogueContext,
  RoomDialogueContext,
  RoomMemoryDialogueContext,
} from '../domain/dialogue/contracts'

export function buildNPCDialogueReplyInput({
  sessionId,
  target,
  history,
  promptId,
  playerLine,
  roomContext,
  questStage,
  memoryContext,
}: {
  sessionId: string
  target: NPCDialogueTarget
  history: NPCDialogueTurn[]
  promptId?: string
  playerLine?: string
  roomContext?: RoomDialogueContext
  questStage?: QuestDialogueContext
  memoryContext?: RoomMemoryDialogueContext
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
  }
}
