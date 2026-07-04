import {
  DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
  type DialogueSemanticEvent,
  type DialogueSemanticEventKind,
  type DialogueSemanticEventScope,
} from './contracts'
import { validateDialogueSemanticEvent } from './validate'

const KNOWN_QUESTION_PROMPT_IDS = ['ask-room', 'ask-help'] as const

export interface DialogueTurnClassificationInput {
  scope: DialogueSemanticEventScope
  promptId?: string
  turnIndex?: number
  hasNpcReply: boolean
  makeEventId: (kind: DialogueSemanticEventKind, indexInTurn: number) => string
}

function isKnownQuestionPromptId(promptId: string | undefined): promptId is (typeof KNOWN_QUESTION_PROMPT_IDS)[number] {
  return promptId !== undefined && KNOWN_QUESTION_PROMPT_IDS.includes(promptId as never)
}

function provenance(input: DialogueTurnClassificationInput): DialogueSemanticEvent['provenance'] {
  return {
    classifier: 'deterministic-local',
    ...(input.promptId !== undefined ? { promptId: input.promptId } : {}),
    ...(input.turnIndex !== undefined ? { turnIndex: input.turnIndex } : {}),
  }
}

export function classifyDialogueTurn(input: DialogueTurnClassificationInput): DialogueSemanticEvent[] {
  const candidates: unknown[] = []

  if (isKnownQuestionPromptId(input.promptId)) {
    candidates.push({
      schemaVersion: DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
      eventId: input.makeEventId('player_asked_question', candidates.length),
      kind: 'player_asked_question',
      actor: 'player',
      target: 'npc',
      scope: input.scope,
      provenance: provenance(input),
      confidence: 'high',
    })
  }

  if (input.hasNpcReply) {
    candidates.push({
      schemaVersion: DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
      eventId: input.makeEventId('npc_responded', candidates.length),
      kind: 'npc_responded',
      actor: 'npc',
      target: 'player',
      scope: input.scope,
      provenance: provenance(input),
      confidence: 'high',
    })
  }

  return candidates.flatMap((candidate) => {
    const event = validateDialogueSemanticEvent(candidate)
    return event === null ? [] : [event]
  })
}
