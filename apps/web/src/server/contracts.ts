import { z } from 'zod'
import { HealthSchema, InventoryItemSchema } from '../domain/world/worldState'

/** Strict HTTP body for `POST /sessions`; server-owned fields are omitted. */
export const CreateSessionRequestSchema = z
  .object({
    name: z.string().min(1),
    startingRoomId: z.string().min(1),
    initialPlayer: z
      .object({
        health: HealthSchema,
        status: z.array(z.string()).default([]),
        inventory: z.array(InventoryItemSchema).default([]),
      })
      .strict(),
  })
  .strict()

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>

/** Strict HTTP body for `POST /sessions/:sessionId/move`. */
export const MoveRequestSchema = z
  .object({
    toRoomId: z.string().min(1),
    expectedRevision: z.number().int().min(1),
    fromRoomId: z.string().min(1).optional(),
  })
  .strict()

export type MoveRequest = z.infer<typeof MoveRequestSchema>

const SinceSeqValueSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .transform(Number)
  .refine(Number.isSafeInteger)

export const SinceSeqQuerySchema = z
  .object({
    sinceSeq: SinceSeqValueSchema.optional(),
  })
  .strict()

export type SinceSeqQuery = z.infer<typeof SinceSeqQuerySchema>

export type SinceSeqQueryParseResult =
  | { success: true; data: SinceSeqQuery }
  | { success: false }

/**
 * Convert URLSearchParams into the strict API query contract. Duplicate keys
 * are rejected instead of silently choosing one value.
 */
export function parseSinceSeqQuery(query: URLSearchParams): SinceSeqQueryParseResult {
  const entries = [...query.entries()]
  const keys = entries.map(([key]) => key)
  if (new Set(keys).size !== keys.length) return { success: false }

  const parsed = SinceSeqQuerySchema.safeParse(Object.fromEntries(entries))
  return parsed.success ? { success: true, data: parsed.data } : { success: false }
}
