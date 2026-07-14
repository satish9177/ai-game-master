import type { RoomObject } from './roomSpec'

/**
 * Deterministic alias repair for generated rooms only (Slice 7D.1).
 *
 * Converts common natural-language nouns into a canonical RoomSpec type plus
 * a closed semantic variant before loadRoomSpec runs. Other fields are copied
 * unchanged and still pass through the normal Zod validation boundary.
 * Alias meaning never becomes an asset path or renderer instruction.
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

type VariantOf<T> = T extends { variant?: infer Variant }
  ? Exclude<Variant, undefined>
  : never
type SemanticVariant = VariantOf<RoomObject>

/** Alias-specific semantic detail retained after canonical type repair. */
const ALIAS_VARIANT_TABLE: ReadonlyMap<string, SemanticVariant> = new Map<string, SemanticVariant>([
  // paper
  ['notes', 'notes'],
  ['note', 'notes'],
  ['letter', 'letter'],
  ['letters', 'letter'],
  ['parchment', 'parchment'],
  ['papers', 'sheet'],
  ['document', 'sheet'],
  ['documents', 'sheet'],
  ['page', 'sheet'],
  ['pages', 'sheet'],

  // book
  ['journal', 'journal'],
  ['journals', 'journal'],
  ['diary', 'journal'],
  ['tome', 'tome'],
  ['ledger', 'ledger'],
  ['books', 'closed-book'],

  // map
  ['floor plan', 'floor-plan'],
  ['floorplan', 'floor-plan'],
  ['route chart', 'route-map'],
  ['chart', 'world-map'],
  ['blueprint', 'floor-plan'],
  ['maps', 'world-map'],

  // corpse
  ['dead body', 'body'],
  ['skeleton', 'skeleton'],
  ['skeletons', 'skeleton'],
  ['bones', 'bone-pile'],
  ['remains', 'decayed-remains'],
  ['cadaver', 'body'],
  ['corpses', 'body'],

  // table
  ['desk', 'desk'],
  ['desks', 'desk'],
  ['workbench', 'workbench'],
  ['worktable', 'workbench'],
  ['work table', 'workbench'],
  ['counter', 'counter'],
  ['tables', 'table'],

  // altar
  ['shrine', 'shrine'],
  ['ritual platform', 'ritual-platform'],
  ['ritual altar', 'ritual-platform'],
  ['offering table', 'offering-table'],
  ['altars', 'altar'],

  // statue
  ['monument', 'monument'],
  ['idol', 'idol'],
  ['effigy', 'effigy'],
  ['sculpture', 'sculpture'],
  ['statues', 'statue'],

  // machine
  ['generator', 'generator'],
  ['console', 'console'],
  ['machinery', 'machinery'],
  ['lab equipment', 'lab-equipment'],
  ['terminal', 'terminal'],
  ['apparatus', 'apparatus'],
  ['machines', 'machine'],

  // artifact
  ['crystal', 'crystal'],
  ['crystals', 'crystal'],
  ['relic', 'relic'],
  ['relics', 'relic'],
  ['orb', 'orb'],
  ['strange object', 'strange-object'],
  ['gem', 'gem'],
  ['shard', 'shard'],
  ['totem', 'totem'],
  ['artifacts', 'artifact'],

  // candle
  ['candles', 'cluster'],
  ['small flames', 'cluster'],
  ['votive', 'votive'],
  ['tea light', 'tea-light'],
  ['tealight', 'tea-light'],

  // arch
  ['door', 'wood-door'],
  ['doors', 'wood-door'],
  ['doorway', 'wood-door'],
  ['gate', 'iron-gate'],

  ['gateway', 'iron-gate'],
  ['archway', 'stone-arch'],
  ['portal', 'stone-portal'],
  ['entrance', 'entrance'],

  // debris
  ['rubble', 'rubble'],
  ['trash', 'trash'],
  ['garbage', 'trash'],
  ['junk', 'junk'],
  ['wreckage', 'wreckage'],
  ['scrap', 'scrap'],
  ['broken parts', 'broken-parts'],
  ['debris pile', 'debris-pile'],

  // crate
  ['box', 'box'],
  ['boxes', 'box'],
  ['container', 'crate'],
  ['containers', 'crate'],
  ['case', 'case'],
  ['crates', 'crate'],
  ['supply crate', 'supply-crate'],

  // chest
  ['treasure chest', 'treasure-chest'],
  ['lockbox', 'lockbox'],
  ['coffer', 'coffer'],
  ['strongbox', 'strongbox'],
  ['footlocker', 'footlocker'],

  // barrel
  ['drum', 'drum'],
  ['keg', 'keg'],
  ['cask', 'cask'],
  ['barrels', 'barrel'],
])
/**
 * Closed, renderer-agnostic catalog of every generated noun repair.
 *
 * Exporting the catalog lets focused boundary tests prove that every accepted
 * alias reaches a trusted visual-pack mapping without teaching the domain
 * layer anything about renderer families, assets, paths, or licenses.
 */
export type GeneratedRoomAliasCatalogEntry = Readonly<{
  alias: string
  type: RoomObject['type']
  variant: SemanticVariant
}>

export const GENERATED_ROOM_ALIAS_CATALOG: readonly GeneratedRoomAliasCatalogEntry[] =
  Object.freeze(Array.from(ALIAS_TABLE, ([alias, type]) => {
    const variant = ALIAS_VARIANT_TABLE.get(alias)
    if (variant === undefined) {
      throw new Error('generated alias catalog invariant failed')
    }
    return Object.freeze({ alias, type, variant })
  }))

const ALIAS_RESOLUTION_TABLE: ReadonlyMap<
  string,
  Readonly<{ type: CanonicalType; variant: SemanticVariant }>
> = new Map(GENERATED_ROOM_ALIAS_CATALOG.map(({ alias, type, variant }) => [
  alias,
  { type, variant },
]))

/** Normalizes a raw type string for alias lookup: lowercase, trim, collapse whitespace. */
function normalizeType(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Attempts to resolve `raw` to a canonical type via the alias table. Returns
 * the canonical type string when found, or `null` when the input is not in the
 * table (including when it already IS a canonical type — those are not aliased).
 */
function resolveAlias(
  raw: string,
): { type: CanonicalType; variant: SemanticVariant } | null {
  const normalized = normalizeType(raw)
  return ALIAS_RESOLUTION_TABLE.get(normalized) ?? null
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

  const resolution = resolveAlias(obj['type'])
  if (resolution === null) return { entry, changed: false }

  return {
    entry: { ...obj, type: resolution.type, variant: resolution.variant },
    changed: true,
  }
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
