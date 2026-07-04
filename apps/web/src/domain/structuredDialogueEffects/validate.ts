import {
  StructuredDialogueEffectSchema,
  type StructuredDialogueEffect,
} from './contracts'

export function validateStructuredDialogueEffect(input: unknown): StructuredDialogueEffect | null {
  const parsed = StructuredDialogueEffectSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

export const parseStructuredDialogueEffect = validateStructuredDialogueEffect
