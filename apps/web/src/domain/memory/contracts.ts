import { z } from 'zod'

/**
 * NPC memory contracts (npc-memory-persistence-v0, memory-firewall-v0).
 *
 * A memory record is opaque, inert text plus closed-enum metadata, scoped by the
 * exact `(worldId, sessionId, npcId)` triple. Memory is supporting context only:
 * it feeds no event, no reducer, no state change. The `WorldSession` event log +
 * reducers remain the sole authority. This module imports only `zod` and exports
 * NO `WorldCommand`/`WorldEvent`-producing function — there is no memory→truth
 * mapping (the structural firewall).
 *
 * `text` is inert recall content: never parsed, never `eval`'d, never logged.
 */

export const NPC_MEMORY_SCHEMA_VERSION = 1 as const

/** Hard cap on a single memory's inert text. */
export const MAX_MEMORY_CHARS = 280

/**
 * Epistemic class of a memory. A `player_claim` is a claim, not truth; an
 * `npc_belief` may be wrong; an `npc_observation` is a scoped remembered
 * observation, NOT authoritative world fact; `dialogue_summary` is a storable
 * kind only (v0 builds no summarizer).
 */
export const MemoryKindSchema = z.enum([
  'player_claim',
  'npc_belief',
  'npc_observation',
  'dialogue_summary',
])

/**
 * Where the assertion came from. `game` means a memory originated by
 * deterministic game rules / runtime activity — NEVER hidden
 * system/developer/internal prompt text. There is deliberately no `system`
 * source.
 */
export const MemorySourceSchema = z.enum(['player', 'npc', 'game', 'llm'])

/** Informational only in v0: does not update truth and does not drive recall. */
export const MemoryConfidenceSchema = z.enum(['low', 'medium', 'high'])

/** The exact scope triple every read and write is filtered against. */
export const MemoryScopeSchema = z
  .object({
    worldId: z.string().min(1),
    sessionId: z.string().min(1),
    npcId: z.string().min(1),
  })
  .strict()

export const MemoryProvenanceSchema = z
  .object({
    source: MemorySourceSchema,
    roomId: z.string().min(1).optional(), // where the memory was formed
    turnIndex: z.number().int().min(0).optional(), // dialogue turn that produced it
  })
  .strict()

export const NpcMemoryRecordSchema = z
  .object({
    schemaVersion: z.literal(NPC_MEMORY_SCHEMA_VERSION),
    memoryId: z.string().min(1),
    worldId: z.string().min(1), // SCOPE
    sessionId: z.string().min(1), // SCOPE
    npcId: z.string().min(1), // SCOPE
    kind: MemoryKindSchema,
    text: z.string().min(1).max(MAX_MEMORY_CHARS), // inert recall content — NEVER logged, never code
    provenance: MemoryProvenanceSchema,
    confidence: MemoryConfidenceSchema, // informational only
    seq: z.number().int().min(1), // per (sessionId, npcId); ordering key
    createdAt: z.string().min(1), // UTC ISO-8601 via Clock
  })
  .strict()

export type MemoryKind = z.infer<typeof MemoryKindSchema>
export type MemorySource = z.infer<typeof MemorySourceSchema>
export type MemoryConfidence = z.infer<typeof MemoryConfidenceSchema>
export type MemoryScope = z.infer<typeof MemoryScopeSchema>
export type MemoryProvenance = z.infer<typeof MemoryProvenanceSchema>
export type NpcMemoryRecord = z.infer<typeof NpcMemoryRecordSchema>

/** What the service hands the store: id/createdAt are stamped; the store assigns `seq`. */
export type NpcMemoryInsert = Omit<NpcMemoryRecord, 'seq'>
