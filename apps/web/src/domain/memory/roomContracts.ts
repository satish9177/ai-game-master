import { z } from 'zod'

/**
 * Room memory contracts (living-world-room-memory-v0, room-memory-firewall-v0).
 *
 * A room memory record is opaque, inert text plus closed-enum metadata, scoped
 * by the exact `(worldId, sessionId, roomId)` triple. Memory is supporting
 * context only: it feeds no event, no reducer, no `roomStates` change. The
 * `WorldSession` event log + reducers remain the sole authority. This module
 * imports only `zod` and exports NO `WorldCommand`/`WorldEvent`-producing
 * function — there is no memory→truth mapping (the structural firewall).
 *
 * `text` is inert recall content: never parsed, never `eval`'d, never logged.
 */

export const ROOM_MEMORY_SCHEMA_VERSION = 1 as const

/** Hard cap on a single room memory's inert text. */
export const MAX_ROOM_MEMORY_CHARS = 280

/**
 * Epistemic class of a room memory. A `player_claim` is a claim about a room,
 * not truth; a `room_observation` is a scoped observation, NOT an authoritative
 * room fact; `room_note` is the home for generated/narrator room text (inert
 * supporting context only); `room_summary` is a storable kind only (v0 builds
 * no summarizer).
 */
export const RoomMemoryKindSchema = z.enum([
  'player_claim',
  'room_observation',
  'room_note',
  'room_summary',
])

/**
 * Where the assertion came from. `game` means a memory originated by
 * deterministic game rules / runtime activity — NEVER hidden
 * system/developer/internal prompt text. There is deliberately no `system`
 * source.
 */
export const RoomMemorySourceSchema = z.enum(['player', 'npc', 'game', 'llm'])

/** Informational only in v0: does not update truth and does not drive recall. */
export const RoomMemoryConfidenceSchema = z.enum(['low', 'medium', 'high'])

/** The exact scope triple every read and write is filtered against. */
export const RoomMemoryScopeSchema = z
  .object({
    worldId: z.string().min(1),
    sessionId: z.string().min(1),
    roomId: z.string().min(1), // authored / generated / fallback id; NOT FK'd to `rooms`
  })
  .strict()

export const RoomMemoryProvenanceSchema = z
  .object({
    source: RoomMemorySourceSchema,
    npcId: z.string().min(1).optional(), // which NPC formed/uttered this memory
    turnIndex: z.number().int().min(0).optional(), // dialogue turn that produced it
  })
  .strict()

export const RoomMemoryRecordSchema = z
  .object({
    schemaVersion: z.literal(ROOM_MEMORY_SCHEMA_VERSION),
    memoryId: z.string().min(1),
    worldId: z.string().min(1), // SCOPE
    sessionId: z.string().min(1), // SCOPE
    roomId: z.string().min(1), // SCOPE
    kind: RoomMemoryKindSchema,
    text: z.string().min(1).max(MAX_ROOM_MEMORY_CHARS), // inert recall content — NEVER logged, never code
    provenance: RoomMemoryProvenanceSchema,
    confidence: RoomMemoryConfidenceSchema, // informational only
    seq: z.number().int().min(1), // per (sessionId, roomId); ordering key
    createdAt: z.string().min(1), // UTC ISO-8601 via Clock
  })
  .strict()

export type RoomMemoryKind = z.infer<typeof RoomMemoryKindSchema>
export type RoomMemorySource = z.infer<typeof RoomMemorySourceSchema>
export type RoomMemoryConfidence = z.infer<typeof RoomMemoryConfidenceSchema>
export type RoomMemoryScope = z.infer<typeof RoomMemoryScopeSchema>
export type RoomMemoryProvenance = z.infer<typeof RoomMemoryProvenanceSchema>
export type RoomMemoryRecord = z.infer<typeof RoomMemoryRecordSchema>

/** What the service hands the store: id/createdAt are stamped; the store assigns `seq`. */
export type RoomMemoryInsert = Omit<RoomMemoryRecord, 'seq'>
