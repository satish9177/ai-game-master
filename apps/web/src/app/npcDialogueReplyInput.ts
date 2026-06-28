import type { NPCDialogueTarget } from './dialogue'
import type { NPCDialogueInput } from '../dialogue/NPCDialogueService'
import type { NPCDialogueTurn, QuestDialogueContext, RoomDialogueContext } from '../domain/dialogue/contracts'

export function buildNPCDialogueReplyInput({
  sessionId,
  target,
  history,
  playerLine,
  roomContext,
  questStage,
}: {
  sessionId: string
  target: NPCDialogueTarget
  history: NPCDialogueTurn[]
  playerLine?: string
  roomContext?: RoomDialogueContext
  questStage?: QuestDialogueContext
}): NPCDialogueInput {
  return {
    sessionId,
    npcId: target.npcId,
    npcName: target.npcName,
    dialogue: target.dialogue,
    persona: target.persona,
    history,
    playerLine,
    ...(roomContext !== undefined ? { roomContext } : {}),
    ...(questStage !== undefined ? { quest: questStage } : {}),
  }
}
