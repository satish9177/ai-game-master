import type { ZodIssue } from 'zod'
import { RoomObjectSchema, RoomSpecSchema } from './roomSpec'
import type { RoomObject, RoomSpec } from './roomSpec'

/**
 * The lenient RoomSpec loader. Kept separate from the schema so roomSpec.ts
 * stays pure data/types with no behavior.
 *
 * It returns problems as data (warnings / skipped) rather than logging — the
 * caller decides what to log (ADR-0003). The domain never logs.
 *
 * Conventions: Y-up, units in meters, -Z = north, rotationY in degrees.
 */

/**
 * Fixed classification buckets for skipped object validation failures.
 * Count-only: no raw type strings, field values, or content-bearing data.
 */
export type SkippedObjectReasonCounts = {
  unknownType: number          // discriminator value not in the canonical union
  missingRequiredField: number // required field absent (e.g. npc.name)
  invalidPosition: number      // position tuple malformed or wrong type
  invalidInteraction: number   // interaction field missing or invalid
  invalidTransform: number     // scale or rotationY invalid
  invalidDimensions: number    // radius/height/width/length/size invalid
  invalidColor: number         // a #rrggbb color field failed regex
  otherSchemaInvalid: number   // anything else that didn't match a named bucket
}

export type LoadedRoom = Omit<RoomSpec, 'objects'> & {
  objects: RoomObject[]
  skipped: { index: number; type: string; raw: unknown }[]
  warnings: string[]
  /** Aggregate skip-reason counts. All zeros when no objects were skipped. */
  skippedObjectReasonCounts: SkippedObjectReasonCounts
}

/* ---------- skip-reason classifier (internal) ---------- */

const COLOR_PATH_KEYS = new Set([
  'color', 'waxColor', 'flameColor', 'coverColor', 'pageColor', 'markColor',
  'trimColor', 'latchColor', 'panelColor', 'pipeColor', 'crystalColor',
  'baseColor', 'pedestalColor', 'accentColor', 'clothColor',
])
const DIMENSION_PATH_KEYS = new Set(['radius', 'height', 'width', 'length', 'size'])
const TRANSFORM_PATH_KEYS = new Set(['scale', 'rotationY'])

function classifySkipReason(issues: ZodIssue[]): keyof SkippedObjectReasonCounts {
  // 1. Discriminated union failure (Zod v4: `invalid_union` with a `discriminator`
  //    key set) → the `type` value was not in the canonical list.
  for (const issue of issues) {
    if (issue.code === 'invalid_union' && issue.discriminator !== undefined) {
      return 'unknownType'
    }
  }
  // 2. Path-based buckets (first matching issue wins).
  for (const issue of issues) {
    const p0 = issue.path[0]
    if (p0 === 'position') return 'invalidPosition'
    if (p0 === 'interaction') return 'invalidInteraction'
    if (typeof p0 === 'string' && COLOR_PATH_KEYS.has(p0)) return 'invalidColor'
    if (typeof p0 === 'string' && TRANSFORM_PATH_KEYS.has(p0)) return 'invalidTransform'
    if (typeof p0 === 'string' && DIMENSION_PATH_KEYS.has(p0)) return 'invalidDimensions'
  }
  // 3. Missing required field (Zod v4: `invalid_type` with `input === undefined`
  //    means the value was absent, not wrong-typed).
  for (const issue of issues) {
    if (issue.code === 'invalid_type' && issue.input === undefined) {
      return 'missingRequiredField'
    }
  }
  return 'otherSchemaInvalid'
}

function zeroReasonCounts(): SkippedObjectReasonCounts {
  return {
    unknownType: 0,
    missingRequiredField: 0,
    invalidPosition: 0,
    invalidInteraction: 0,
    invalidTransform: 0,
    invalidDimensions: 0,
    invalidColor: 0,
    otherSchemaInvalid: 0,
  }
}

/**
 * Validates the room envelope strictly (throws on broken required fields) but
 * parses `objects` leniently: any unknown or malformed object is skipped and
 * recorded in `skipped`/`warnings` instead of crashing the load.
 */
export function loadRoomSpec(raw: unknown): LoadedRoom {
  const env = RoomSpecSchema.parse(raw)
  const objects: RoomObject[] = []
  const skipped: LoadedRoom['skipped'] = []
  const warnings: string[] = []
  const skippedObjectReasonCounts = zeroReasonCounts()

  env.objects.forEach((item, index) => {
    const parsed = RoomObjectSchema.safeParse(item)
    if (parsed.success) {
      objects.push(parsed.data)
      return
    }
    const type =
      item && typeof item === 'object' && 'type' in item
        ? String((item as { type: unknown }).type)
        : 'unknown'
    skipped.push({ index, type, raw: item })
    warnings.push(
      `objects[${index}] type="${type}" skipped: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    )
    skippedObjectReasonCounts[classifySkipReason(parsed.error.issues)] += 1
  })

  return { ...env, objects, skipped, warnings, skippedObjectReasonCounts }
}
