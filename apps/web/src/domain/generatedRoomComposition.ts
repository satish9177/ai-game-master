import { computePlayableBounds, objectFootprintRadius } from './generatedRoomLayout'
import type { PlayableBounds } from './generatedRoomLayout'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

/**
 * Generated-room composition (generated-room-composition-v0, stage 2.7).
 *
 * Deterministic, pure, non-mutating layout composer for generated rooms only.
 * Runs after object-legality repair (stage 2.6) and before spawn/exit repair
 * (stages 2.8–2.9), so spawn and exit wall-snap get the final safety say.
 *
 * Contract:
 * - Relocates existing objects only.  Never adds, removes, or edits any non-position
 *   field (id, name, interaction, prompt, body, effect, encounter, color, scale, …).
 * - Object count is always preserved (composition ≠ drop).
 * - All relocated positions are footprint-clamped inside the playable floor.
 * - Returns the SAME room reference when nothing needed relocation (mirrors the
 *   same-reference discipline used by every other generated-room normalizer).
 * - Pure: no I/O, no logger, no randomness, no mutation of inputs.
 * - Provenance stays 'generated'; diagnostics are safe to log (no content).
 * - Authored/static/fallback rooms are never passed through this function.
 *
 * Conventions: Y-up, meters, −Z = north.
 */

// ─── types ─────────────────────────────────────────────────────────────────────

/**
 * Composition role for generated-room layout (finer-grained than ObjectImportance).
 * Classifies what zone an object belongs in for composition purposes.
 *
 * - 'anchor'       — throne: primary story focal point → north-center anchor zone.
 * - 'npc'          — npc: placed off corridor in a mid-room flank.
 * - 'interactable' - scroll; document/practical/resource objects with non-exit
 *                    interaction: placed in a visible reachable flank.
 * - 'exit'         — any object carrying interaction.exit: left for stage 2.8.
 * - 'structural'   — torch only: composition leaves wall-lights in place.
 * - 'decorative'   - pillar, arch (no exit), prop, rug, visual-only documents,
 *                    practical props, and resource objects without interaction:
 *                    relocated to side zones when in the corridor.
 */
export type CompositionRole =
  | 'anchor'
  | 'npc'
  | 'interactable'
  | 'exit'
  | 'structural'
  | 'decorative'

/** Composition diagnostics — safe to log (no names, prompts, or content). */
export type CompositionDiagnostics = {
  /** True when at least one object was relocated. */
  composed: boolean
  /** True when the room contains no story anchor (no throne). */
  lacksAnchor: boolean
  /** True when the room contains no interactable clue or resource object. */
  lacksInteractable: boolean
}

export type ComposedRoom = {
  room: LoadedRoom
  diagnostics: CompositionDiagnostics
}

// ─── constants ─────────────────────────────────────────────────────────────────

/**
 * Zone constants for generated-room composition. All spatial targets are expressed
 * as fractions of the playable half-extents (halfX / halfZ from computePlayableBounds),
 * so they scale correctly across the [14..24] m generated-room size envelope.
 */
export const COMPOSITION = {
  /**
   * Half-width (m) of the central north-south corridor to keep clear of decorative
   * clutter. Objects with |x| < CORRIDOR_HALF are moved to the east/west side zones.
   */
  CORRIDOR_HALF: 2.0,

  /**
   * Anchor zone — throne target z as fraction of halfZ (negative = north).
   * The throne is placed at z = -(ANCHOR_Z_TARGET_FRAC × halfZ), footprint-clamped.
   */
  ANCHOR_Z_TARGET_FRAC: 0.70,

  /**
   * Anchor zone already-placed threshold. A throne is considered composed when
   * z ≤ -(ANCHOR_Z_THRESHOLD × halfZ). Used to detect same-reference eligibility.
   * Must be < ANCHOR_Z_TARGET_FRAC so a throne at the exact target passes.
   */
  ANCHOR_Z_THRESHOLD: 0.45,

  /** NPC flank target: |x| = NPC_X_TARGET_FRAC × halfX, preserving east/west side. */
  NPC_X_TARGET_FRAC: 0.55,

  /**
   * Interactable flank target: |x| = INTERACTABLE_X_TARGET_FRAC × halfX.
   * Slightly less than NPC so clue/resource objects sit a touch closer to center
   * and read as discoverable without blocking the walking path.
   */
  INTERACTABLE_X_TARGET_FRAC: 0.50,

  /**
   * Decorative clutter target: |x| = CLUTTER_X_TARGET_FRAC × halfX.
   * Greater than NPC/INTERACTABLE so clutter reads as wall dressing, not part of
   * the navigable story space.
   */
  CLUTTER_X_TARGET_FRAC: 0.72,
} as const

// ─── classification ────────────────────────────────────────────────────────────

/**
 * Classifies a room object by its generated-room composition role.
 * Uses only object type and structural interaction presence — never reads
 * names, prompt text, body text, or any narrative content.
 */
export function classifyGeneratedCompositionRole(obj: RoomObject): CompositionRole {
  // Exit interaction takes highest priority — position is handled by stage 2.8 wall-snap.
  if (hasExitInteraction(obj)) return 'exit'

  switch (obj.type) {
    case 'throne':
    case 'altar':
    case 'statue':
      return 'anchor'
    case 'npc':
      return 'npc'
    case 'scroll':
      return 'interactable'
    case 'book':
    case 'paper':
    case 'map':
    case 'chest':
    case 'corpse':
    case 'table':
      return hasNonExitInteraction(obj) ? 'interactable' : 'decorative'
    case 'crate':
    case 'barrel':
    case 'debris':
    case 'barricade':
    case 'zombie':
      return hasNonExitInteraction(obj) ? 'interactable' : 'decorative'
    case 'pillar':
    case 'arch':
      return 'decorative'
    case 'torch':
      return 'structural'
    case 'rug':
      return 'decorative'
    case 'prop':
    default:
      return hasNonExitInteraction(obj) ? 'interactable' : 'decorative'
  }
}

// ─── zone info (informational; actual per-object positions use footprint clamp) ──

/**
 * Informational zone parameters derived from the playable bounds.
 * Targets here are raw (before per-object footprint clamping) and are useful
 * for tests and debugging. Actual positions in composeGeneratedRoom are
 * additionally clamped by objectFootprintRadius per object.
 */
export type GeneratedCompositionZones = {
  /** Half-width of the central corridor (m). Objects with |x| < corridorHalf are off-path. */
  corridorHalf: number
  /** Target x for story anchor (always 0 = center). */
  anchorTargetX: number
  /** Target z for story anchor (negative = north). */
  anchorTargetZ: number
  /** Target |x| for NPCs placed off the corridor. */
  npcTargetAbsX: number
  /** Target |x| for interactables placed off the corridor. */
  interactableTargetAbsX: number
  /** Target |x| for decorative clutter pushed to side zones. */
  clutterTargetAbsX: number
}

/** Derives the composition zone parameters for a room's playable bounds. */
export function computeGeneratedCompositionZones(
  bounds: PlayableBounds,
): GeneratedCompositionZones {
  return {
    corridorHalf: COMPOSITION.CORRIDOR_HALF,
    anchorTargetX: 0,
    anchorTargetZ: -(COMPOSITION.ANCHOR_Z_TARGET_FRAC * bounds.halfZ),
    npcTargetAbsX: COMPOSITION.NPC_X_TARGET_FRAC * bounds.halfX,
    interactableTargetAbsX: COMPOSITION.INTERACTABLE_X_TARGET_FRAC * bounds.halfX,
    clutterTargetAbsX: COMPOSITION.CLUTTER_X_TARGET_FRAC * bounds.halfX,
  }
}

// ─── composer ─────────────────────────────────────────────────────────────────

/**
 * Deterministic generated-room composition normalizer (stage 2.7 in assembleRoom).
 *
 * Re-arranges existing objects into a readable layout:
 *  1. The first throne (story anchor) is placed in the north-center anchor zone.
 *  2. NPCs are moved off the central corridor to a mid-room flank.
 *  3. Interactable clues/resources in the corridor are moved to a visible flank.
 *  4. Decorative clutter in the corridor is pushed to the east/west side zones.
 *  5. Structural objects (pillars, torches, non-exit arches) are left in place.
 *  6. Exit-carrying objects are left for stage 2.9 (wall-snap).
 *
 * Returns the SAME room reference when no object needed relocation.
 * Never mutates the input room or its objects.
 */
export function composeGeneratedRoom(room: LoadedRoom): ComposedRoom {
  const bounds = computePlayableBounds(room.shell.dimensions, room.shell.wallThickness)
  const roles = room.objects.map(classifyGeneratedCompositionRole)

  const anchorIdx = primaryAnchorIndex(room.objects)
  const lacksAnchor = anchorIdx === -1
  const lacksInteractable = !room.objects.some((obj, i) =>
    roles[i] === 'interactable' || isInteractiveStoryAnchor(obj))

  let changed = false

  const newObjects = room.objects.map((obj, i): RoomObject => {
    const role = roles[i]!
    const [x, y, z] = obj.position

    switch (role) {
      case 'anchor': {
        // Extra thrones preserve existing behavior; extra altar/statue candidates
        // behave like ordinary generated props after the primary anchor is chosen.
        if (i !== anchorIdx) {
          if (obj.type === 'throne') return obj
          return relocateFlankObject(
            obj,
            hasNonExitInteraction(obj) ? 'interactable' : 'decorative',
            bounds,
            () => { changed = true },
          )
        }
        const [tx, tz] = anchorTarget(bounds, objectFootprintRadius(obj))
        if (x === tx && z === tz) return obj
        changed = true
        return { ...obj, position: [tx, y, tz] } as RoomObject
      }

      case 'npc': {
        return relocateFlankObject(obj, role, bounds, () => { changed = true })
      }

      case 'interactable': {
        return relocateFlankObject(obj, role, bounds, () => { changed = true })
      }

      case 'decorative': {
        return relocateFlankObject(obj, role, bounds, () => { changed = true })
      }

      // 'exit' | 'structural' — leave in place
      default:
        return obj
    }
  })

  if (!changed) {
    return {
      room,
      diagnostics: { composed: false, lacksAnchor, lacksInteractable },
    }
  }

  return {
    room: { ...room, objects: newObjects },
    diagnostics: { composed: true, lacksAnchor, lacksInteractable },
  }
}

// ─── internal helpers ──────────────────────────────────────────────────────────

function hasExitInteraction(obj: RoomObject): boolean {
  return 'interaction' in obj && obj.interaction != null && obj.interaction.exit != null
}

function hasNonExitInteraction(obj: RoomObject): boolean {
  return 'interaction' in obj && obj.interaction != null && obj.interaction.exit == null
}

function isInteractiveStoryAnchor(obj: RoomObject): boolean {
  return (obj.type === 'altar' || obj.type === 'statue') && hasNonExitInteraction(obj)
}

function primaryAnchorIndex(objects: RoomObject[]): number {
  const throne = objects.findIndex((obj) => obj.type === 'throne')
  if (throne !== -1) return throne
  const altar = objects.findIndex((obj) => obj.type === 'altar')
  if (altar !== -1) return altar
  return objects.findIndex((obj) => obj.type === 'statue')
}

function relocateFlankObject(
  obj: RoomObject,
  role: Extract<CompositionRole, 'npc' | 'interactable' | 'decorative'>,
  bounds: PlayableBounds,
  markChanged: () => void,
): RoomObject {
  const [x, y, z] = obj.position
  if (Math.abs(x) >= COMPOSITION.CORRIDOR_HALF) return obj
  const frac = role === 'npc'
    ? COMPOSITION.NPC_X_TARGET_FRAC
    : role === 'interactable'
      ? COMPOSITION.INTERACTABLE_X_TARGET_FRAC
      : COMPOSITION.CLUTTER_X_TARGET_FRAC
  const tx = flanktargetX(x, frac, bounds.halfX, objectFootprintRadius(obj))
  if (tx === x) return obj
  markChanged()
  return { ...obj, position: [tx, y, z] } as RoomObject
}

/**
 * Computes the target [x, z] for the story anchor (throne): north-center of the room,
 * with the throne's footprint clamped inside the playable bounds on both axes.
 */
function anchorTarget(bounds: PlayableBounds, fp: number): [number, number] {
  const safeZ = Math.max(0, bounds.halfZ - fp)
  const targetZ = -(COMPOSITION.ANCHOR_Z_TARGET_FRAC * bounds.halfZ)
  // Clamp into [-safeZ, +safeZ] (north = negative z, so clamp toward -safeZ)
  const clampedZ = Math.min(Math.max(targetZ, -safeZ), safeZ)
  return [0, clampedZ]
}

/**
 * Computes the target x for an object being relocated to a flank zone.
 * Preserves the east/west side of the current x (positive side as tiebreak for x = 0).
 * Clamps within footprint-adjusted bounds so the full object stays inside the floor.
 */
function flanktargetX(currentX: number, frac: number, halfX: number, fp: number): number {
  const side = currentX < 0 ? -1 : 1
  const target = side * frac * halfX
  const safeMax = halfX - fp
  if (safeMax <= 0) return 0
  return Math.min(Math.max(target, -safeMax), safeMax)
}
