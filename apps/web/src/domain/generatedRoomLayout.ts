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

/**
 * The spawn-blocking object types used for the generated-room spawn safe-area
 * check. Mirrors SPAWN_BLOCKING_TYPES in validateRoom.ts; kept separate here to
 * avoid coupling the domain validator to repair logic.
 */
const GENERATED_SPAWN_BLOCKING_TYPES = new Set<RoomObject['type']>([
  'throne',
  'pillar',
  'npc',
  'prop',
  'crate',
  'barrel',
  'barricade',
  'debris',
  'zombie',
])

/** Step distance used when searching for an uncrowded spawn candidate. */
const SPAWN_STEP = LIMITS.SPAWN_CLEARANCE + 0.5

/**
 * Repairs the generated room player spawn so it lies inside the playable floor
 * area and is not crowded by a spawn-blocking object.
 *
 * Step 1: Clamps spawn X/Z into the playable floor area. Because the playable
 * bounds already account for the wall clearance margin, this handles both
 * out-of-bounds spawns and spawns that are too close to the wall.
 *
 * Step 2: If the clamped position is still crowded by a spawn-blocking object,
 * searches a small, deterministic set of candidate positions for a safe one.
 *
 * Spawn Y (height) is preserved; floor-height logic is out of scope here.
 *
 * Returns the SAME object reference when spawn is already safe, so callers can
 * use a reference equality check (`fixed !== room`) to detect a repair.
 * Never mutates the input room.
 *
 * This is a benign normalization — keeps provenance `generated` and must NOT
 * trigger the host's repair/fallback notice. Authored/static/fallback rooms are
 * never passed through this function.
 */
export function repairGeneratedSpawn(room: LoadedRoom): LoadedRoom {
  const bounds = computePlayableBounds(room.shell.dimensions, room.shell.wallThickness)
  const [sx, sy, sz] = room.spawn.position

  const cx = halfClamp(sx, bounds.halfX)
  const cz = halfClamp(sz, bounds.halfZ)

  const [fx, fz] = findSafeSpawn(cx, cz, room.objects, bounds)

  if (fx === sx && fz === sz) return room
  return {
    ...room,
    spawn: { ...room.spawn, position: [fx, sy, fz] },
  }
}

/**
 * Searches a small, deterministic candidate set for a spawn position that is
 * inside the playable area and not crowded by any spawn-blocking object.
 * Falls back to (cx, cz) when all candidates are crowded — best effort.
 */
function findSafeSpawn(
  cx: number,
  cz: number,
  objects: RoomObject[],
  bounds: PlayableBounds,
): [number, number] {
  const candidates: [number, number][] = [
    [cx, cz],
    [0, 0],
    [0, SPAWN_STEP],
    [0, -SPAWN_STEP],
    [SPAWN_STEP, 0],
    [-SPAWN_STEP, 0],
  ]
  for (const [x, z] of candidates) {
    if (!isInsidePlayableBounds([x, 0, z], bounds)) continue
    if (!isSpawnCrowded(x, z, objects)) return [x, z]
  }
  return [cx, cz]
}

/** Returns true when any spawn-blocking object is within SPAWN_CLEARANCE of (x, z). */
function isSpawnCrowded(x: number, z: number, objects: RoomObject[]): boolean {
  return objects.some(
    (obj) =>
      GENERATED_SPAWN_BLOCKING_TYPES.has(obj.type) &&
      Math.hypot(obj.position[0] - x, obj.position[2] - z) < LIMITS.SPAWN_CLEARANCE,
  )
}

/**
 * Returns true when `obj` carries a navigable exit in its interaction.
 * Used to identify which objects need wall-edge snapping in repairGeneratedExits.
 */
function hasExitInteraction(obj: RoomObject): boolean {
  return 'interaction' in obj && obj.interaction != null && obj.interaction.exit != null
}

/**
 * Snaps [x, y, z] to the nearest room wall face (±halfW for east/west,
 * ±halfD for north/south). The cross-axis is clamped to the wall extent.
 * Y is unchanged. Ties are broken north > south > east > west.
 */
function snapExitToNearestWall(
  position: [number, number, number],
  halfW: number,
  halfD: number,
): [number, number, number] {
  const [x, y, z] = position
  const candidates: { dist: number; idx: number; result: [number, number, number] }[] = [
    { dist: Math.abs(z + halfD), idx: 0, result: [halfClamp(x, halfW), y, -halfD] }, // north
    { dist: Math.abs(z - halfD), idx: 1, result: [halfClamp(x, halfW), y, halfD] },  // south
    { dist: Math.abs(x - halfW), idx: 2, result: [halfW, y, halfClamp(z, halfD)] },  // east
    { dist: Math.abs(x + halfW), idx: 3, result: [-halfW, y, halfClamp(z, halfD)] }, // west
  ]
  candidates.sort((a, b) => a.dist - b.dist || a.idx - b.idx)
  return candidates[0]!.result
}

/**
 * Snaps each exit-carrying object's position to the nearest room wall face
 * for generated rooms only. An exit-carrying object is any object with a
 * non-null `interaction.exit` (typically an arch, but any type may carry one).
 *
 * Repair rule: find the wall face nearest to the current [x, z] position
 * (north: z = -halfD, south: z = +halfD, east: x = +halfW, west: x = -halfW),
 * set the axis for that wall to its face coordinate, and clamp the cross-axis
 * to the wall extent. Y (height) is unchanged.
 *
 * Returns the SAME object reference when the snap produces the same coordinates
 * (i.e. the object is already on a wall face), and the SAME room reference when
 * no exit object needed repair. Never mutates the input room.
 *
 * This is a benign normalization — keeps provenance `generated` and must NOT
 * trigger the host's repair/fallback notice. Authored/static/fallback rooms are
 * never passed through this function.
 */
export function repairGeneratedExits(room: LoadedRoom): LoadedRoom {
  const { width, depth } = room.shell.dimensions
  const halfW = width / 2
  const halfD = depth / 2

  let anyMoved = false
  const repairedObjects = room.objects.map((obj) => {
    if (!hasExitInteraction(obj)) return obj
    const [x, y, z] = obj.position
    const [sx, sy, sz] = snapExitToNearestWall([x, y, z], halfW, halfD)
    if (sx === x && sy === y && sz === z) return obj
    anyMoved = true
    return { ...obj, position: [sx, sy, sz] as [number, number, number] } as RoomObject
  })

  if (!anyMoved) return room
  return { ...room, objects: repairedObjects }
}
