import type { LoadedRoom } from './loadRoomSpec'
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
 * room — and it only clamps the spawn position, never inventing content.
 *
 * v0 fix:
 * - `spawn-out-of-bounds`        → clamp spawn X/Z into the walkable AABB, using
 *                                  the SAME margin validateRoom uses.
 *
 * Object and light counts are deliberately not repair inputs. Rendering cost is
 * controlled by the renderer's weighted budget, not by deleting semantic room
 * objects. The high object-entry envelope is abuse protection and remains fatal
 * rather than being truncated into a seemingly valid room.
 *
 * Deliberately NOT repaired (route to the fallback room in a later commit):
 * room dimensions, an exceeded parser-abuse envelope, reachability, collision,
 * or quest consistency. Repair is a single pass; the caller re-runs validateRoom
 * and falls back if a fatal issue remains.
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

  return { ...room, spawn: { ...room.spawn, position } }
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
