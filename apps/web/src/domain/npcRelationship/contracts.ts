import { z } from 'zod'

/**
 * NPC relationship state is a non-authoritative, in-memory projection of how
 * one NPC feels toward the player. It is not a WorldEvent, WorldCommand,
 * WorldState field, memory record, or fact. Nothing may treat it as truth.
 */

export const NPC_RELATIONSHIP_SCHEMA_VERSION = 1 as const

// Bipolar axes: negative = hostile/contempt, 0 = neutral baseline, positive = warm/esteem.
export const RelationshipBipolarSchema = z.number().int().min(-100).max(100)
// Unipolar axes: 0 = none, 100 = max. There is no negative pole for these axes.
export const RelationshipUnipolarSchema = z.number().int().min(0).max(100)

export const RelationshipAxesSchema = z
  .object({
    trust: RelationshipBipolarSchema,
    respect: RelationshipBipolarSchema,
    fear: RelationshipUnipolarSchema,
    familiarity: RelationshipUnipolarSchema,
  })
  .strict()

export const NpcRelationshipScopeSchema = z
  .object({
    worldId: z.string().min(1),
    sessionId: z.string().min(1),
    npcId: z.string().min(1),
  })
  .strict()

export const NpcRelationshipSubjectSchema = z.literal('npc')
export const NpcRelationshipObjectSchema = z.literal('player')

export const NpcRelationshipStateSchema = z
  .object({
    schemaVersion: z.literal(NPC_RELATIONSHIP_SCHEMA_VERSION),
    scope: NpcRelationshipScopeSchema,
    subject: NpcRelationshipSubjectSchema,
    object: NpcRelationshipObjectSchema,
    axes: RelationshipAxesSchema,
    interactionCount: z.number().int().min(0),
  })
  .strict()

export type RelationshipAxes = z.infer<typeof RelationshipAxesSchema>
export type NpcRelationshipScope = z.infer<typeof NpcRelationshipScopeSchema>
export type NpcRelationshipSubject = z.infer<typeof NpcRelationshipSubjectSchema>
export type NpcRelationshipObject = z.infer<typeof NpcRelationshipObjectSchema>
export type NpcRelationshipState = z.infer<typeof NpcRelationshipStateSchema>
