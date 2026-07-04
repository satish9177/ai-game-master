import {
  DialogueSemanticEventSchema,
  type DialogueSemanticEvent,
} from './contracts'

export function validateDialogueSemanticEvent(input: unknown): DialogueSemanticEvent | null {
  const parsed = DialogueSemanticEventSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

export const parseDialogueSemanticEvent = validateDialogueSemanticEvent
