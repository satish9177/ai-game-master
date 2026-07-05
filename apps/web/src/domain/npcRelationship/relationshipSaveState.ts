import { z } from 'zod'
import { NpcRelationshipStateSchema } from './contracts'
import type { NpcRelationshipState } from './contracts'

/**
 * Pure save-state helpers for the NPC relationship persistence sidecar
 * (npc-relationship-persistence-v0, Slice 1). Domain-pure: imports only `zod`
 * and sibling `domain/npcRelationship` contracts. Exports NO
 * `WorldCommand`/`WorldEvent`-producing function — a parked relationship blob
 * can never become authoritative truth.
 *
 * Mirrors `domain/memory/roomMemorySaveState.ts`: a versioned envelope, strict
 * re-validation, a deterministic cap, and fixed reason codes. Unlike room
 * memory, each record is validated and dropped individually rather than as a
 * whole-array reject, per ADR-0081 ("strict drop, never field-repair" applies
 * per record, not per envelope) — `NpcRelationshipState` has no free-text
 * field, so there is no line-safety concern to filter for.
 */

export const NPC_RELATIONSHIP_SAVE_SCHEMA_VERSION = 1 as const

/** Deterministic hard cap bounding payload size against a poisoned/huge save. */
export const NPC_RELATIONSHIP_SAVE_MAX_RECORDS = 64

export const NpcRelationshipSaveStateSchema = z
  .object({
    schemaVersion: z.literal(NPC_RELATIONSHIP_SAVE_SCHEMA_VERSION),
    records: z.array(NpcRelationshipStateSchema).min(1).max(NPC_RELATIONSHIP_SAVE_MAX_RECORDS),
  })
  .strict()

export type NpcRelationshipSaveState = z.infer<typeof NpcRelationshipSaveStateSchema>

const NpcRelationshipSaveVersionEnvelopeSchema = z.object({ schemaVersion: z.number().int() }).passthrough()

const NpcRelationshipSaveEnvelopeShapeSchema = z
  .object({
    schemaVersion: z.literal(NPC_RELATIONSHIP_SAVE_SCHEMA_VERSION),
    records: z.array(z.unknown()).min(1),
  })
  .strict()

export type NpcRelationshipSaveLoadCode = 'invalid-json' | 'unsupported-version' | 'invalid-schema'

export type LoadNpcRelationshipSaveStateResult =
  | { ok: true; state: NpcRelationshipSaveState }
  | { ok: false; code: NpcRelationshipSaveLoadCode }

/** Optional scope filter. When a field is provided, non-matching records drop. */
export type NpcRelationshipSaveScope = { worldId?: string; sessionId?: string }

/** Restore result: surviving records plus safe, reason-coded drop counts only. */
export type RestorableRelationshipsResult = {
  records: NpcRelationshipState[]
  keptCount: number
  droppedCount: number
  droppedByScope: number
  droppedByCap: number
}

/**
 * Build a strict, bounded save-state from a snapshot of runtime records.
 *
 * Applies (in order): optional scope filter → deterministic cap → strict
 * envelope validation. Returns `null` when nothing survives (empty snapshot),
 * so the caller can simply omit the sidecar key.
 */
export function buildNpcRelationshipSaveState(
  records: readonly NpcRelationshipState[],
  scope?: NpcRelationshipSaveScope,
): NpcRelationshipSaveState | null {
  const scoped = records.filter((record) => matchesScope(record, scope))
  const capped = capRelationships(scoped)
  if (capped.length === 0) return null

  const candidate = { schemaVersion: NPC_RELATIONSHIP_SAVE_SCHEMA_VERSION, records: capped }
  const parsed = NpcRelationshipSaveStateSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/**
 * Convenience wrapper: `buildNpcRelationshipSaveState` then `JSON.stringify`.
 * Returns the JSON string to park as `npcRelationshipJson`, or `null` when
 * there is nothing to save.
 */
export function buildNpcRelationshipSaveJson(
  records: readonly NpcRelationshipState[],
  scope?: NpcRelationshipSaveScope,
): string | null {
  const state = buildNpcRelationshipSaveState(records, scope)
  return state === null ? null : JSON.stringify(state)
}

/**
 * Parse + strictly validate a parked `npcRelationshipJson` blob. Fixed reason
 * codes only; never echoes blob content. Each record in `records` is
 * validated individually with `NpcRelationshipStateSchema` — a record that
 * fails validation is dropped whole (never field-repaired); valid siblings
 * survive. The surviving records are then deterministically capped.
 */
export function loadNpcRelationshipSaveState(json: string): LoadNpcRelationshipSaveStateResult {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(json)
  } catch {
    return { ok: false, code: 'invalid-json' }
  }

  const envelope = NpcRelationshipSaveVersionEnvelopeSchema.safeParse(parsedJson)
  if (!envelope.success) return { ok: false, code: 'invalid-schema' }
  if (envelope.data.schemaVersion !== NPC_RELATIONSHIP_SAVE_SCHEMA_VERSION) {
    return { ok: false, code: 'unsupported-version' }
  }

  const shape = NpcRelationshipSaveEnvelopeShapeSchema.safeParse(parsedJson)
  if (!shape.success) return { ok: false, code: 'invalid-schema' }

  const survivors: NpcRelationshipState[] = []
  for (const candidate of shape.data.records) {
    const parsedRecord = NpcRelationshipStateSchema.safeParse(candidate)
    if (parsedRecord.success) survivors.push(parsedRecord.data)
  }

  const capped = capRelationships(survivors)
  return { ok: true, state: { schemaVersion: NPC_RELATIONSHIP_SAVE_SCHEMA_VERSION, records: capped } }
}

/**
 * Restore filter over already schema-validated records (the output of
 * `loadNpcRelationshipSaveState`). Drops — never normalizes — records whose
 * `scope.worldId`/`scope.sessionId` does not match the restored authoritative
 * `WorldState`, then applies the same deterministic cap as save. `npcId` is
 * deliberately NOT cross-checked against loaded rooms/NPCs. Returns surviving
 * records plus safe drop counts; no raw axis values.
 */
export function filterRestorableRelationships(
  records: readonly NpcRelationshipState[],
  scope: NpcRelationshipSaveScope,
): RestorableRelationshipsResult {
  let droppedByScope = 0
  const survivors: NpcRelationshipState[] = []

  for (const record of records) {
    if (!matchesScope(record, scope)) {
      droppedByScope += 1
      continue
    }
    survivors.push(record)
  }

  const capped = capRelationships(survivors)
  const droppedByCap = survivors.length - capped.length

  return {
    records: capped,
    keptCount: capped.length,
    droppedCount: records.length - capped.length,
    droppedByScope,
    droppedByCap,
  }
}

function matchesScope(record: NpcRelationshipState, scope?: NpcRelationshipSaveScope): boolean {
  if (scope?.worldId !== undefined && record.scope.worldId !== scope.worldId) return false
  if (scope?.sessionId !== undefined && record.scope.sessionId !== scope.sessionId) return false
  return true
}

/**
 * Deterministic cap: sort by `scope.npcId` ascending (the only stable,
 * content-free key on the record) and keep the first
 * `NPC_RELATIONSHIP_SAVE_MAX_RECORDS`. Always sorted, even under the cap, so
 * output order is stable regardless of input order.
 */
function capRelationships(records: readonly NpcRelationshipState[]): NpcRelationshipState[] {
  return [...records].sort(compareByNpcId).slice(0, NPC_RELATIONSHIP_SAVE_MAX_RECORDS)
}

function compareByNpcId(a: NpcRelationshipState, b: NpcRelationshipState): number {
  if (a.scope.npcId < b.scope.npcId) return -1
  if (a.scope.npcId > b.scope.npcId) return 1
  return 0
}
