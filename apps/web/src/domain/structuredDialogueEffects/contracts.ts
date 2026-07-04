import { z } from 'zod'
import { DialogueSemanticEventKindSchema } from '../dialogueEvents/contracts'

/**
 * Structured dialogue effects are inert, non-authoritative candidates derived
 * from validated dialogue semantic events. They are not WorldEvents, commands,
 * memory writes, facts, or state changes.
 */

export const STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION = 1 as const

export const StructuredDialogueEffectKindSchema = z.enum([
  'player_question_effect_candidate',
  'npc_response_effect_candidate',
])

export const StructuredDialogueEffectActorSchema = z.enum(['player', 'npc'])
export const StructuredDialogueEffectTargetSchema = z.enum(['player', 'npc', 'room', 'none'])
export const StructuredDialogueEffectStatusSchema = z.literal('candidate')
export const StructuredDialogueEffectConfidenceSchema = z.enum(['low', 'medium', 'high'])
export const StructuredDialogueEffectClassifierSchema = z.literal('deterministic-local')

export const StructuredDialogueEffectScopeSchema = z
  .object({
    worldId: z.string().min(1),
    sessionId: z.string().min(1),
    roomId: z.string().min(1),
    npcId: z.string().min(1).optional(),
  })
  .strict()

export const StructuredDialogueEffectProvenanceSchema = z
  .object({
    classifier: StructuredDialogueEffectClassifierSchema,
    promptId: z.string().min(1).optional(),
    turnIndex: z.number().int().min(0).optional(),
  })
  .strict()

export const StructuredDialogueEffectSchema = z
  .object({
    schemaVersion: z.literal(STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION),
    effectId: z.string().min(1),
    kind: StructuredDialogueEffectKindSchema,
    sourceEventId: z.string().min(1),
    sourceKind: DialogueSemanticEventKindSchema,
    status: StructuredDialogueEffectStatusSchema,
    actor: StructuredDialogueEffectActorSchema,
    target: StructuredDialogueEffectTargetSchema,
    scope: StructuredDialogueEffectScopeSchema,
    provenance: StructuredDialogueEffectProvenanceSchema,
    confidence: StructuredDialogueEffectConfidenceSchema,
  })
  .strict()

export type StructuredDialogueEffectKind = z.infer<typeof StructuredDialogueEffectKindSchema>
export type StructuredDialogueEffectActor = z.infer<typeof StructuredDialogueEffectActorSchema>
export type StructuredDialogueEffectTarget = z.infer<typeof StructuredDialogueEffectTargetSchema>
export type StructuredDialogueEffectStatus = z.infer<typeof StructuredDialogueEffectStatusSchema>
export type StructuredDialogueEffectConfidence = z.infer<typeof StructuredDialogueEffectConfidenceSchema>
export type StructuredDialogueEffectClassifier = z.infer<typeof StructuredDialogueEffectClassifierSchema>
export type StructuredDialogueEffectScope = z.infer<typeof StructuredDialogueEffectScopeSchema>
export type StructuredDialogueEffectProvenance = z.infer<typeof StructuredDialogueEffectProvenanceSchema>
export type StructuredDialogueEffect = z.infer<typeof StructuredDialogueEffectSchema>
