import {
  classifyDialogueTurn,
  type DialogueTurnClassificationInput,
} from '../domain/dialogueEvents/classify'
import type {
  DialogueSemanticEvent,
  DialogueSemanticEventScope,
} from '../domain/dialogueEvents/contracts'
import type { Logger } from '../platform/logger/Logger'

export type DeriveAndLogDialogueSemanticEventsInput = {
  scope: DialogueSemanticEventScope
  promptId?: string
  turnIndex?: number
  hasNpcReply: boolean
  makeEventId: DialogueTurnClassificationInput['makeEventId']
  logger: Pick<Logger, 'info'>
}

export function deriveAndLogDialogueSemanticEvents(
  input: DeriveAndLogDialogueSemanticEventsInput,
): DialogueSemanticEvent[] {
  const events = classifyDialogueTurn({
    scope: input.scope,
    promptId: input.promptId,
    turnIndex: input.turnIndex,
    hasNpcReply: input.hasNpcReply,
    makeEventId: input.makeEventId,
  })

  input.logger.info('dialogue semantic events derived', {
    count: events.length,
    kinds: joinUnique(events.map((event) => event.kind)),
    actors: joinUnique(events.map((event) => event.actor)),
    targets: joinUnique(events.map((event) => event.target)),
    confidences: joinUnique(events.map((event) => event.confidence)),
    worldId: input.scope.worldId,
    sessionId: input.scope.sessionId,
    roomId: input.scope.roomId,
    ...(input.scope.npcId !== undefined ? { npcId: input.scope.npcId } : {}),
    ...(input.promptId !== undefined ? { promptId: input.promptId } : {}),
  })

  return events
}

function joinUnique<T extends DialogueSemanticEvent['kind'] | DialogueSemanticEvent['actor'] | DialogueSemanticEvent['target'] | DialogueSemanticEvent['confidence']>(
  values: readonly T[],
): string {
  return [...new Set(values)].join(',')
}
