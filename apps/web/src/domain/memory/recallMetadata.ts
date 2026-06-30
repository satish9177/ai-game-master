import { z } from 'zod'

/**
 * Shared, bounded recall metadata for NPC and room memories
 * (memory-display-name-persistence-v0, Slice C1).
 *
 * These fields are OPTIONAL and ADDITIVE. They ride inside the existing
 * `memory_json` blob — no DDL, and NO `schemaVersion` bump (it stays `1`), so old
 * fieldless rows still parse and the memory record objects stay `.strict()`. They
 * are inert, backend-assigned metadata with no path to truth: `importance` informs
 * ranking, `dedupeKey` enables idempotent promotion, and `entitySnapshots` keeps
 * memory text readable (system id → display name) even if names change later.
 *
 * This is a shared leaf module imported by both `contracts.ts`/`roomContracts.ts`
 * and both firewalls. It introduces NO NPC↔room coupling — neither memory family
 * imports the other; both depend only on this neutral module and `zod`.
 */

export const MAX_DEDUPE_KEY_CHARS = 200
export const MAX_DISPLAY_NAME_CHARS = 120
export const MAX_ENTITY_ROLE_CHARS = 40
export const MAX_ENTITY_SNAPSHOTS = 8
export const MAX_IMPORTANCE = 5

/** Persisted importance (0–5). When present, ranking uses it instead of a kind proxy. */
export const MemoryImportanceSchema = z.number().int().min(0).max(MAX_IMPORTANCE)

/** Deterministic idempotency / dedupe key (bounded). */
export const MemoryDedupeKeySchema = z.string().min(1).max(MAX_DEDUPE_KEY_CHARS)

/** A single display-name snapshot: system id + readable name, both bounded. */
export const EntitySnapshotSchema = z
  .object({
    id: z.string().min(1).max(MAX_DISPLAY_NAME_CHARS),
    displayName: z.string().min(1).max(MAX_DISPLAY_NAME_CHARS),
  })
  .strict()

/** Bounded map of entity-role → snapshot, so memory text stays readable over time. */
export const EntitySnapshotsSchema = z
  .record(z.string().min(1).max(MAX_ENTITY_ROLE_CHARS), EntitySnapshotSchema)
  .refine((value) => Object.keys(value).length <= MAX_ENTITY_SNAPSHOTS, {
    message: 'too-many-entity-snapshots',
  })

export type MemoryImportance = z.infer<typeof MemoryImportanceSchema>
export type EntitySnapshot = z.infer<typeof EntitySnapshotSchema>
export type EntitySnapshots = z.infer<typeof EntitySnapshotsSchema>

export type RecallMetadataInput = {
  importance?: number
  dedupeKey?: string
  entitySnapshots?: EntitySnapshots
}

export type RecallMetadataRejectReason =
  | 'invalid-importance'
  | 'invalid-dedupe-key'
  | 'invalid-entity-snapshots'

export type ValidateRecallMetadataResult =
  | { ok: true; value: RecallMetadataInput }
  | { ok: false; reason: RecallMetadataRejectReason }

/**
 * Validate + bound the optional recall metadata, shared by the NPC and room
 * firewalls (no NPC↔room coupling — both call this leaf). Each field is
 * independently optional; an absent field is accepted. Returns only the present,
 * validated fields, so the caller can spread the result into a draft. Pure: no
 * mutation, no I/O.
 */
export function validateRecallMetadata(input: RecallMetadataInput): ValidateRecallMetadataResult {
  const value: RecallMetadataInput = {}
  if (input.importance !== undefined) {
    const parsed = MemoryImportanceSchema.safeParse(input.importance)
    if (!parsed.success) return { ok: false, reason: 'invalid-importance' }
    value.importance = parsed.data
  }
  if (input.dedupeKey !== undefined) {
    const parsed = MemoryDedupeKeySchema.safeParse(input.dedupeKey)
    if (!parsed.success) return { ok: false, reason: 'invalid-dedupe-key' }
    value.dedupeKey = parsed.data
  }
  if (input.entitySnapshots !== undefined) {
    const parsed = EntitySnapshotsSchema.safeParse(input.entitySnapshots)
    if (!parsed.success) return { ok: false, reason: 'invalid-entity-snapshots' }
    value.entitySnapshots = parsed.data
  }
  return { ok: true, value }
}
