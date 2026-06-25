/**
 * Generated-room-only pre-validation repair for optional object transform fields.
 *
 * Real providers sometimes emit valid RoomSpec object types but malformed
 * optional transform fields such as `rotationY: "45deg"` or `scale: "large"`.
 * Zod rejects the whole object before defaults can apply, which turns otherwise
 * useful visual vocabulary into skipped mystery markers.
 *
 * This helper runs only inside assembleRoom, after alias repair and before
 * loadRoomSpec. It removes only malformed optional `rotationY` / `scale` fields
 * so the schema defaults apply. It never coerces values, never logs, and never
 * touches authored/static/restored/fallback rooms.
 */

type RepairResult = { value: unknown; count: number }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function isValidRotationY(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidScale(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function repairEntry(entry: unknown): { entry: unknown; changed: boolean } {
  if (!isPlainObject(entry)) return { entry, changed: false }

  let changed = false
  const repaired: Record<string, unknown> = { ...entry }

  if (hasOwn(entry, 'rotationY') && !isValidRotationY(entry['rotationY'])) {
    delete repaired['rotationY']
    changed = true
  }

  if (hasOwn(entry, 'scale') && !isValidScale(entry['scale'])) {
    delete repaired['scale']
    changed = true
  }

  return changed ? { entry: repaired, changed } : { entry, changed: false }
}

/**
 * Removes malformed optional transform fields from raw generated object entries.
 *
 * Count is per object repaired, not per field: if a single object has both a bad
 * `rotationY` and a bad `scale`, the returned `count` increases by one.
 */
export function repairGeneratedObjectTransforms(parsed: unknown): RepairResult {
  if (!isPlainObject(parsed)) return { value: parsed, count: 0 }
  if (!Array.isArray(parsed['objects'])) return { value: parsed, count: 0 }

  const objects = parsed['objects'] as unknown[]
  let count = 0
  let changed = false
  const repairedObjects = objects.map((entry) => {
    const result = repairEntry(entry)
    if (result.changed) {
      count += 1
      changed = true
    }
    return result.entry
  })

  if (!changed) return { value: parsed, count: 0 }
  return { value: { ...parsed, objects: repairedObjects }, count }
}
