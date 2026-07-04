import { z } from 'zod'

/**
 * Dialogue semantic events are inert, non-authoritative classifications of a
 * dialogue turn. They are not WorldEvents, commands, memory writes, or effects.
 */

export const DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION = 1 as const

export const DialogueSemanticEventKindSchema = z.enum([
  'player_asked_question',
  'player_shared_claim',
  'player_promised_help',
  'player_threatened_npc',
  'npc_responded',
  'npc_warned_player',
  'npc_revealed_rumor',
  'npc_refused_request',
  'npc_acknowledged_memory',
])

export const DialogueSemanticEventActorSchema = z.enum(['player', 'npc'])
export const DialogueSemanticEventTargetSchema = z.enum(['player', 'npc', 'room', 'none'])
export const DialogueSemanticEventConfidenceSchema = z.enum(['low', 'medium', 'high'])
export const DialogueSemanticEventClassifierSchema = z.literal('deterministic-local')

export const DialogueSemanticEventScopeSchema = z
  .object({
    worldId: z.string().min(1),
    sessionId: z.string().min(1),
    roomId: z.string().min(1),
    npcId: z.string().min(1).optional(),
  })
  .strict()

export const DialogueSemanticEventProvenanceSchema = z
  .object({
    classifier: DialogueSemanticEventClassifierSchema,
    promptId: z.string().min(1).optional(),
    turnIndex: z.number().int().min(0).optional(),
  })
  .strict()

export const DialogueSemanticEventSchema = z
  .object({
    schemaVersion: z.literal(DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION),
    eventId: z.string().min(1),
    kind: DialogueSemanticEventKindSchema,
    actor: DialogueSemanticEventActorSchema,
    target: DialogueSemanticEventTargetSchema,
    scope: DialogueSemanticEventScopeSchema,
    provenance: DialogueSemanticEventProvenanceSchema,
    confidence: DialogueSemanticEventConfidenceSchema,
  })
  .strict()

export type DialogueSemanticEventKind = z.infer<typeof DialogueSemanticEventKindSchema>
export type DialogueSemanticEventActor = z.infer<typeof DialogueSemanticEventActorSchema>
export type DialogueSemanticEventTarget = z.infer<typeof DialogueSemanticEventTargetSchema>
export type DialogueSemanticEventConfidence = z.infer<typeof DialogueSemanticEventConfidenceSchema>
export type DialogueSemanticEventClassifier = z.infer<typeof DialogueSemanticEventClassifierSchema>
export type DialogueSemanticEventScope = z.infer<typeof DialogueSemanticEventScopeSchema>
export type DialogueSemanticEventProvenance = z.infer<typeof DialogueSemanticEventProvenanceSchema>
export type DialogueSemanticEvent = z.infer<typeof DialogueSemanticEventSchema>
