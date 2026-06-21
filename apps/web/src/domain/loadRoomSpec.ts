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
export type LoadedRoom = Omit<RoomSpec, 'objects'> & {
  objects: RoomObject[]
  skipped: { index: number; type: string; raw: unknown }[]
  warnings: string[]
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
  })

  return { ...env, objects, skipped, warnings }
}
