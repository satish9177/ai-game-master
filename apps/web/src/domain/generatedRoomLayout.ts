import { LIMITS } from './validateRoom'
import type { RoomObject } from './roomSpec'
import type { LoadedRoom } from './loadRoomSpec'

/**
 * Generated room layout contract (generated-room-layout-contract v0). Pure
 * domain constants and helpers that define the safe size envelope and spatial
 * classification rules for generated rooms only. No I/O, no logger, no React,
 * no Three.js, no mutation. Values never carry raw generated content.
 *
 * Authored/static rooms are validate-only and are NOT subject to these bounds.
 * Zones are internal repair-logic concepts; none appear as a RoomSpec field.
 *
 * Conventions: Y-up, meters, -Z = north.
 */

/** Size envelope and object cap for generated rooms. Authored rooms ignore these. */
export const GENERATED_ROOM = {
  DEFAULT_SIZE: 18,
  MIN_SIZE: 14,
  MAX_SIZE: 24,
  /** Max objects per generated room (benign normalization; below the soft budget of 60). */
  MAX_OBJECTS: 30,
} as const

/** Returns the default generated room floor dimensions (18 × 18 m). */
export function defaultGeneratedDimensions(): { width: number; depth: number } {
  return { width: GENERATED_ROOM.DEFAULT_SIZE, depth: GENERATED_ROOM.DEFAULT_SIZE }
}

/**
 * Clamps a generated room width or depth to [MIN_SIZE..MAX_SIZE].
 * Returns DEFAULT_SIZE for zero, negative, or non-finite inputs.
 */
export function clampGeneratedDimension(dim: number): number {
  if (!Number.isFinite(dim) || dim <= 0) return GENERATED_ROOM.DEFAULT_SIZE
  return Math.min(Math.max(dim, GENERATED_ROOM.MIN_SIZE), GENERATED_ROOM.MAX_SIZE)
}

/** Symmetric half-extents of the walkable area (spawn + object placement). */
export type PlayableBounds = {
  /** Max |X| coordinate inside which spawn/objects must land (≥ 0). */
  halfX: number
  /** Max |Z| coordinate inside which spawn/objects must land (≥ 0). */
  halfZ: number
}

/**
 * Computes the walkable bounds for a room, using the same wall-margin formula
 * as validateRoom (wallThickness/2 + LIMITS.WALL_CLEARANCE). Returns 0 for
 * degenerate dimensions where the margin exceeds the half-extent.
 */
export function computePlayableBounds(
  dims: { width: number; depth: number },
  wallThickness: number,
): PlayableBounds {
  const margin = wallThickness / 2 + LIMITS.WALL_CLEARANCE
  return {
    halfX: Math.max(0, dims.width / 2 - margin),
    halfZ: Math.max(0, dims.depth / 2 - margin),
  }
}

/**
 * Returns true when the [x, y, z] position lies inside the walkable region
 * described by `bounds`. Y (height) is not checked here.
 */
export function isInsidePlayableBounds(
  position: [number, number, number],
  bounds: PlayableBounds,
): boolean {
  const [x, , z] = position
  return Math.abs(x) <= bounds.halfX && Math.abs(z) <= bounds.halfZ
}

/**
 * Returns true when `position` falls within the spawn safe-area exclusion zone
 * (radius = LIMITS.SPAWN_CLEARANCE, using only the X/Z plane). Mirrors the
 * `object-crowds-spawn` check in validateRoom; callers apply type filtering.
 */
export function isSpawnSafeAreaOverlap(
  position: [number, number, number],
  spawnPosition: [number, number, number],
): boolean {
  const [x, , z] = position
  const [spawnX, , spawnZ] = spawnPosition
  return Math.hypot(x - spawnX, z - spawnZ) < LIMITS.SPAWN_CLEARANCE
}

/**
 * Clamps the floor dimensions (width, depth) of a generated room to the product
 * contract [MIN_SIZE..MAX_SIZE]. Height is not constrained by the generated-room
 * contract and is left unchanged.
 *
 * Returns the SAME object reference when no dimension needed clamping, so
 * callers can use a reference equality check (`clamped !== room`) to detect
 * whether any repair was applied — without adding extra state.
 *
 * Never mutates the input room.
 */
export function clampGeneratedShell(room: LoadedRoom): LoadedRoom {
  const { width, depth, height } = room.shell.dimensions
  const newWidth = clampGeneratedDimension(width)
  const newDepth = clampGeneratedDimension(depth)
  if (newWidth === width && newDepth === depth) return room
  return {
    ...room,
    shell: {
      ...room.shell,
      dimensions: { width: newWidth, depth: newDepth, height },
    },
  }
}

/**
 * Safe reason code for object layout importance:
 * - 'critical'   — carries interactive/exit content; must be preserved and
 *                  relocated when outside bounds.
 * - 'structural' — shapes the space (pillars, lighting, throne) but carries no
 *                  story content; preserve if possible.
 * - 'decorative' — pure aesthetic clutter; safe to drop when space is tight.
 */
export type ObjectImportance = 'critical' | 'structural' | 'decorative'

/**
 * Classifies a room object by its layout importance for generated-room repair
 * decisions. Uses type and presence of an interaction to infer importance;
 * never reads or surfaces raw object content (names, prompt text, body text).
 */
export function classifyObjectImportance(obj: RoomObject): ObjectImportance {
  switch (obj.type) {
    case 'npc':
    case 'scroll':
      return 'critical'
    case 'arch':
      return obj.interaction != null ? 'critical' : 'structural'
    case 'crate':
    case 'barrel':
    case 'debris':
    case 'barricade':
    case 'zombie':
      return obj.interaction != null ? 'critical' : 'decorative'
    case 'throne':
    case 'pillar':
    case 'torch':
      return 'structural'
    case 'prop':
    case 'rug':
    default:
      return 'decorative'
  }
}

/**
 * Clamps each object's X/Z position into the playable floor area and caps the
 * total object count at GENERATED_ROOM.MAX_OBJECTS for generated rooms only.
 *
 * Returns the SAME object reference when no object needed repair (same-reference
 * optimization), so callers can use a reference check (`fixed !== room`) to
 * detect whether any change was applied. Never mutates the input room or any
 * of its objects.
 *
 * Cap drop order (least important first): decorative → structural → critical.
 * Critical objects are never dropped.
 *
 * This is a benign normalization — like clampGeneratedShell it keeps provenance
 * 'generated' and must NOT trigger the host's repair/fallback notice.
 * Authored/static/fallback rooms are never passed through this function.
 */
export function repairGeneratedObjects(room: LoadedRoom): LoadedRoom {
  const bounds = computePlayableBounds(room.shell.dimensions, room.shell.wallThickness)

  // Step 1: clamp each object's X/Z position into playable bounds.
  let anyMoved = false
  const positioned = room.objects.map((obj) => {
    const [x, y, z] = obj.position
    const cx = halfClamp(x, bounds.halfX)
    const cz = halfClamp(z, bounds.halfZ)
    if (cx === x && cz === z) return obj
    anyMoved = true
    return { ...obj, position: [cx, y, cz] as [number, number, number] } as RoomObject
  })

  // Step 2: cap total object count; drop least-important objects first.
  const needsCap = positioned.length > GENERATED_ROOM.MAX_OBJECTS
  const final = needsCap ? dropLeastImportant(positioned, GENERATED_ROOM.MAX_OBJECTS) : positioned

  if (!anyMoved && !needsCap) return room
  return { ...room, objects: final }
}

/** Clamp `value` to [–max, +max]. Returns 0 for degenerate (non-positive) max. */
function halfClamp(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(Math.max(value, -max), max)
}

/**
 * Drop lowest-importance objects until `objects.length === target`. Preserves
 * the original index order of the kept objects (stable).
 */
function dropLeastImportant(objects: RoomObject[], target: number): RoomObject[] {
  const rank: Record<ObjectImportance, number> = { decorative: 0, structural: 1, critical: 2 }
  const indexed = objects.map((obj, i) => ({ obj, rank: rank[classifyObjectImportance(obj)], i }))
  // Sort ascending: lowest rank = dropped first. Secondary sort by index for stability.
  indexed.sort((a, b) => a.rank - b.rank || a.i - b.i)
  // Keep the last `target` entries (highest importance), then restore original order.
  const kept = indexed.slice(objects.length - target)
  kept.sort((a, b) => a.i - b.i)
  return kept.map(({ obj }) => obj)
}
