import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'
import { LIMITS } from './validateRoom'

/**
 * Deterministic room repair (room-generation-repair-fallback v0). A pure domain
 * function that applies a few SAFE, NARROWING fixes to a loaded room so that a
 * room with a repairable fatal playability issue can be salvaged instead of
 * discarded — the deterministic subset of the ADR-0007 "repair / regenerate"
 * stage (a model-driven re-prompt repair stays future and would live in the
 * async orchestrator, not here).
 *
 * It is the code peer of validateRoom (ADR-0011): pure, synchronous, no logger,
 * no React/Three.js, no DB/server. It NEVER mutates its input — it returns a new
 * room — and it only ever removes or clamps, never invents content.
 *
 * v0 fixes (each maps to a repairable validateRoom fatal):
 * - `spawn-out-of-bounds`        → clamp spawn X/Z into the walkable AABB, using
 *                                  the SAME margin validateRoom uses.
 * - `object-budget-hard-exceeded`→ truncate `objects` to the hard object budget.
 * - `light-budget-hard-exceeded` → drop `torch` objects beyond the hard light
 *                                  budget (non-torch objects preserved).
 *
 * Deliberately NOT repaired (route to the fallback room in a later commit):
 * room dimensions (resizing would dislocate spawn/objects), reachability,
 * collision, quest consistency. Repair is a single pass; the caller re-runs
 * validateRoom and falls back if a fatal issue remains.
 *
 * Conventions: Y-up, meters, -Z = north.
 */
export function repairRoom(room: LoadedRoom): LoadedRoom {
  const { width, depth } = room.shell.dimensions
  const walkableMargin = room.shell.wallThickness / 2 + LIMITS.WALL_CLEARANCE
  const [spawnX, spawnY, spawnZ] = room.spawn.position
  const position: [number, number, number] = [
    clampAxis(spawnX, width / 2 - walkableMargin),
    spawnY,
    clampAxis(spawnZ, depth / 2 - walkableMargin),
  ]

  // Drop excess lights first, then enforce the overall object cap on the result.
  const objects = truncateObjects(truncateLights(room.objects))

  return { ...room, spawn: { ...room.spawn, position }, objects }
}

/**
 * Clamp a coordinate to ±max. If the half-extent is non-positive (a degenerate,
 * too-small room — which is itself unrepairable and falls back), center on 0
 * rather than producing an inverted range.
 */
function clampAxis(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(Math.max(value, -max), max)
}

/**
 * Drop `torch` objects beyond the hard light budget, preserving order and every
 * non-torch object. Returns the same array reference when already within budget.
 */
function truncateLights(objects: RoomObject[]): RoomObject[] {
  let torchCount = 0
  for (const object of objects) {
    if (object.type === 'torch') torchCount += 1
  }
  if (torchCount <= LIMITS.MAX_LIGHTS_HARD) return objects

  let kept = 0
  return objects.filter((object) => {
    if (object.type !== 'torch') return true
    kept += 1
    return kept <= LIMITS.MAX_LIGHTS_HARD
  })
}

/**
 * Truncate the object list to the hard object budget. Returns the same array
 * reference when already within budget.
 */
function truncateObjects(objects: RoomObject[]): RoomObject[] {
  return objects.length > LIMITS.MAX_OBJECTS_HARD
    ? objects.slice(0, LIMITS.MAX_OBJECTS_HARD)
    : objects
}
