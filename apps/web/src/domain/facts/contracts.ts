import { z } from 'zod'

/**
 * Facts are inert, non-authoritative context labels. They do not create world
 * events, commands, persistence rows, prompt text, or renderer behavior.
 */

export const FACT_SCHEMA_VERSION = 1 as const
export const MAX_FACT_TEXT_CHARS = 280

export const FactKindSchema = z.enum([
  'observed',
  'npc-belief',
  'player-claim',
  'rumor',
  'hidden',
  'summary',
])

export const FactSourceSchema = z.enum(['player', 'npc', 'game', 'llm'])
export const FactAuthoritySchema = z.enum(['unverified', 'world-derived'])
export const FactConfidenceSchema = z.enum(['low', 'medium', 'high'])

export const FactVisibilitySchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('public') }).strict(),
  z.object({ scope: z.literal('player-known') }).strict(),
  z.object({ scope: z.literal('room-known'), roomId: z.string().min(1) }).strict(),
  z.object({ scope: z.literal('npc-known'), npcIds: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ scope: z.literal('hidden') }).strict(),
])

export const FactProvenanceSchema = z
  .object({
    roomId: z.string().min(1).optional(),
    npcId: z.string().min(1).optional(),
    turnIndex: z.number().int().min(0).optional(),
  })
  .strict()

export const FactSchema = z
  .object({
    schemaVersion: z.literal(FACT_SCHEMA_VERSION),
    factId: z.string().min(1),
    worldId: z.string().min(1),
    sessionId: z.string().min(1),
    kind: FactKindSchema,
    source: FactSourceSchema,
    authority: FactAuthoritySchema,
    confidence: FactConfidenceSchema,
    visibility: FactVisibilitySchema,
    subjectRef: z.string().min(1).optional(),
    objectRef: z.string().min(1).optional(),
    text: z.string().max(MAX_FACT_TEXT_CHARS).optional(),
    provenance: FactProvenanceSchema.optional(),
  })
  .strict()

export type FactKind = z.infer<typeof FactKindSchema>
export type FactSource = z.infer<typeof FactSourceSchema>
export type FactAuthority = z.infer<typeof FactAuthoritySchema>
export type FactConfidence = z.infer<typeof FactConfidenceSchema>
export type FactVisibility = z.infer<typeof FactVisibilitySchema>
export type FactProvenance = z.infer<typeof FactProvenanceSchema>
export type Fact = z.infer<typeof FactSchema>

