import type { EntitySnapshot } from './recallMetadata'
import { MAX_DISPLAY_NAME_CHARS } from './recallMetadata'

/**
 * Pure display-name resolution (memory-display-name-persistence-v0, Slice C2).
 *
 * Maps a system entity id (room/npc/item/quest) to a human-readable display name
 * so promoted memory text reads naturally. It is fed NEUTRAL snapshot data by a
 * future composition root — it imports no `world-session`/`world-store`/platform
 * and has no path to truth. Pure: no I/O, no clock/randomness, no input mutation.
 *
 * An unknown id resolves to `null`; the caller then keeps its id-free generic
 * text. A resolved snapshot carries only `{ id, displayName }` — the raw id is
 * NEVER fabricated into a display name, and the promoter never places a raw id
 * into memory text. Resolved names are trimmed and bounded so the snapshot always
 * satisfies `EntitySnapshotsSchema`.
 */

/** The entity namespaces a resolver may be asked about (kept open as `string`). */
export type EntityKind = 'room' | 'npc' | 'item' | 'quest'

export interface DisplayNameResolver {
  /** A bounded `{ id, displayName }` snapshot for (kind,id), or `null` when unknown/blank. */
  resolve(kind: string, id: string): EntitySnapshot | null
}

/** Injected neutral lookup: entity kind → (system id → display name). */
export type DisplayNameSnapshots = Record<string, Record<string, string>>

/**
 * Map-backed resolver over an injected snapshot lookup. Returns `null` for an
 * unknown id, a blank/whitespace name, or an id too long to store as a bounded
 * snapshot (so it can never produce an invalid snapshot). A present name is
 * trimmed and bounded to `MAX_DISPLAY_NAME_CHARS`.
 */
export function createDisplayNameResolver(
  snapshots: DisplayNameSnapshots,
): DisplayNameResolver {
  return {
    resolve(kind, id) {
      const trimmedId = typeof id === 'string' ? id.trim() : ''
      if (trimmedId.length === 0 || trimmedId.length > MAX_DISPLAY_NAME_CHARS) return null

      const name = snapshots[kind]?.[trimmedId]
      if (typeof name !== 'string') return null

      const displayName = name.trim().slice(0, MAX_DISPLAY_NAME_CHARS)
      if (displayName.length === 0) return null

      return { id: trimmedId, displayName }
    },
  }
}
