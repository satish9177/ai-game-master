import { LIMITS } from './validateRoom'
import type { RoomObject } from './roomSpec'

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

/** Size envelope for generated rooms (meters). Authored rooms ignore these. */
export const GENERATED_ROOM = {
  DEFAULT_SIZE: 18,
  MIN_SIZE: 14,
  MAX_SIZE: 24,
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
