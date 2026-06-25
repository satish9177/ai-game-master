import type { RoomObject } from './roomSpec'

/**
 * Deterministic alias repair for generated rooms only (Slice 7D.1).
 *
 * Converts common natural-language noun type strings that real LLM providers
 * emit into existing canonical RoomSpec object types before loadRoomSpec runs.
 * Only the `type` field is rewritten; every other field is preserved as-is and
 * passed to the normal Zod validation boundary unchanged.
 *
 * Rules:
 * - Pure and synchronous: no I/O, no logger, no mutation of input.
 * - Allowlist-only: unlisted nouns and canonical types pass through unchanged.
 * - Normalization: lowercase + trim + collapse internal whitespace (exact match
 *   after normalization; no substring, no fuzzy, no stemming).
 * - Canonical types are not in the alias table — they return unchanged.
 * - The envelope is only copied when at least one object type was rewritten.
 * - Does not log raw type strings or any raw generated content.
 *
 * Called from assembleRoom between JSON.parse and loadRoomSpec (Stage 1.5).
 * Never called on authored/static/fallback rooms.
 */

type CanonicalType = RoomObject['type']

/**
 * Normalized alias → canonical type. Keys are already lowercased, trimmed, and
 * have internal whitespace collapsed to a single space — the normalizeType()
 * function produces exactly that form, so the lookup is a plain Map.get().
 */
const ALIAS_TABLE: ReadonlyMap<string, CanonicalType> = new Map<string, CanonicalType>([
  // paper
  ['notes', 'paper'],
  ['note', 'paper'],
  ['letter', 'paper'],
  ['letters', 'paper'],
  ['parchment', 'paper'],
  ['papers', 'paper'],
  ['document', 'paper'],
  ['documents', 'paper'],
  ['page', 'paper'],
  ['pages', 'paper'],

  // book
  ['journal', 'book'],
  ['journals', 'book'],
  ['diary', 'book'],
  ['tome', 'book'],
  ['ledger', 'book'],
  ['books', 'book'],

  // map
  ['floor plan', 'map'],
  ['floorplan', 'map'],
  ['route chart', 'map'],
  ['chart', 'map'],
  ['blueprint', 'map'],
  ['maps', 'map'],

  // corpse
  ['dead body', 'corpse'],
  ['skeleton', 'corpse'],
  ['skeletons', 'corpse'],
  ['bones', 'corpse'],
  ['remains', 'corpse'],
  ['cadaver', 'corpse'],
  ['corpses', 'corpse'],

  // table
  ['desk', 'table'],
  ['desks', 'table'],
  ['workbench', 'table'],
  ['worktable', 'table'],
  ['work table', 'table'],
  ['counter', 'table'],
  ['tables', 'table'],

  // altar
  ['shrine', 'altar'],
  ['ritual platform', 'altar'],
  ['ritual altar', 'altar'],
  ['offering table', 'altar'],
  ['altars', 'altar'],

  // statue
  ['monument', 'statue'],
  ['idol', 'statue'],
  ['effigy', 'statue'],
  ['sculpture', 'statue'],
  ['statues', 'statue'],

  // machine
  ['generator', 'machine'],
  ['console', 'machine'],
  ['machinery', 'machine'],
  ['lab equipment', 'machine'],
  ['terminal', 'machine'],
  ['apparatus', 'machine'],
  ['machines', 'machine'],

  // artifact
  ['crystal', 'artifact'],
  ['crystals', 'artifact'],
  ['relic', 'artifact'],
  ['relics', 'artifact'],
  ['orb', 'artifact'],
  ['strange object', 'artifact'],
  ['gem', 'artifact'],
  ['shard', 'artifact'],
  ['totem', 'artifact'],
  ['artifacts', 'artifact'],

  // candle
  ['candles', 'candle'],
  ['small flames', 'candle'],
  ['votive', 'candle'],
  ['tea light', 'candle'],
  ['tealight', 'candle'],

  // arch
  ['door', 'arch'],
  ['doors', 'arch'],
  ['doorway', 'arch'],
  ['gate', 'arch'],
  ['gateway', 'arch'],
  ['archway', 'arch'],
  ['portal', 'arch'],
  ['entrance', 'arch'],

  // debris
  ['rubble', 'debris'],
  ['trash', 'debris'],
  ['garbage', 'debris'],
  ['junk', 'debris'],
  ['wreckage', 'debris'],
  ['scrap', 'debris'],
  ['broken parts', 'debris'],
  ['debris pile', 'debris'],

  // crate
  ['box', 'crate'],
  ['boxes', 'crate'],
  ['container', 'crate'],
  ['containers', 'crate'],
  ['case', 'crate'],
  ['crates', 'crate'],
  ['supply crate', 'crate'],

  // chest
  ['treasure chest', 'chest'],
  ['lockbox', 'chest'],
  ['coffer', 'chest'],
  ['strongbox', 'chest'],
  ['footlocker', 'chest'],

  // barrel
  ['drum', 'barrel'],
  ['keg', 'barrel'],
  ['cask', 'barrel'],
  ['barrels', 'barrel'],
])

/** Normalizes a raw type string for alias lookup: lowercase, trim, collapse whitespace. */
function normalizeType(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Attempts to resolve `raw` to a canonical type via the alias table. Returns
 * the canonical type string when found, or `null` when the input is not in the
 * table (including when it already IS a canonical type — those are not aliased).
 */
function resolveAlias(raw: string): CanonicalType | null {
  return ALIAS_TABLE.get(normalizeType(raw)) ?? null
}

/**
 * Rewrites a single raw objects-array entry if its `type` is a known alias.
 * Returns the same reference when no rewrite is needed.
 */
function repairEntry(entry: unknown): { entry: unknown; changed: boolean } {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return { entry, changed: false }
  }
  const obj = entry as Record<string, unknown>
  if (typeof obj['type'] !== 'string') return { entry, changed: false }

  const canonical = resolveAlias(obj['type'])
  if (canonical === null) return { entry, changed: false }

  return { entry: { ...obj, type: canonical }, changed: true }
}

/**
 * Repairs known natural-language alias type strings in the raw parsed envelope
 * before it reaches `loadRoomSpec`.
 *
 * @param parsed - The result of `JSON.parse(rawText)`. Any non-object or an
 *   object lacking an `objects` array is returned unchanged with `count: 0`.
 * @returns `{ value, count }` where `value` is the (possibly copied) envelope
 *   and `count` is the number of object entries whose `type` was rewritten.
 */
export function repairGeneratedAliases(parsed: unknown): { value: unknown; count: number } {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: parsed, count: 0 }
  }

  const envelope = parsed as Record<string, unknown>
  if (!Array.isArray(envelope['objects'])) {
    return { value: parsed, count: 0 }
  }

  const rawObjects = envelope['objects'] as unknown[]
  let count = 0
  let changed = false
  const repairedObjects = rawObjects.map((entry) => {
    const result = repairEntry(entry)
    if (result.changed) {
      count += 1
      changed = true
    }
    return result.entry
  })

  if (!changed) return { value: parsed, count: 0 }
  return { value: { ...envelope, objects: repairedObjects }, count }
}
