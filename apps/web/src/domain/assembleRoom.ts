import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import { repairRoom } from './repairRoom'
import { validateRoom } from './validateRoom'
import type { RoomIssueCode, RoomValidationResult } from './validateRoom'
import { clampGeneratedShell, repairGeneratedObjects, repairGeneratedSpawn, repairGeneratedExits } from './generatedRoomLayout'
import { composeGeneratedRoom } from './generatedRoomComposition'

/**
 * Room assembly pipeline (room-generation-repair-fallback v0). A pure,
 * synchronous domain function that turns raw, untrusted generated text into a
 * room the renderer can safely consume — the deterministic core of the ADR-0007
 * "schema → code validator → bounded repair → safe fallback" pipeline
 * (FAILURE-MODES.md cases 4 / 4b). The real LLM, the LLM reviewer, an attempt
 * budget, and adjacent-room pre-generation stay future and live elsewhere.
 *
 * It composes the existing boundaries in order, each failure narrowing to the
 * trusted fallback:
 *   1. `JSON.parse`   — malformed text            → fallback, failedStage `json`
 *   2. `loadRoomSpec` — bad envelope (throws)     → fallback, failedStage `schema`
 *   3. `validateRoom` — fatal playability issue   → try `repairRoom`, re-validate
 *   4. still fatal after repair                   → fallback, failedStage `semantic`
 *
 * Guarantees:
 * - It ALWAYS returns a valid `LoadedRoom` with zero fatal semantic issues, so
 *   the renderer never receives an unplayable room (the caller supplies a
 *   trusted, pre-validated `fallbackRoom`).
 * - It is pure: no logging, no I/O, no mutation of `rawText` or `fallbackRoom`.
 *   Problems come back as DATA in `diagnostics` and the caller decides what to
 *   log (ADR-0003 — the domain never logs).
 * - Diagnostics are SAFE to log or surface: provenance, the failed stage, fixed
 *   `RoomIssueCode` values, booleans, and counts only. They never carry raw
 *   JSON, prompt/story text, object names, or free-form error messages.
 *
 * Conventions: Y-up, meters, -Z = north.
 */
/**
 * Where the returned room came from — a coarse, host-facing signal that decides
 * whether to show the safe "couldn't build that exactly" notice:
 * - `generated` — built from the model output as-is, OR with only a benign
 *   floor-size clamp into the contract (reported separately via `sizeRepaired`).
 *   No playability repair was needed, so the host shows NO notice.
 * - `repaired`  — a deterministic `repairRoom` pass fixed a fatal playability
 *   issue (spawn clamp, budget truncation). The host shows its safe notice.
 * - `fallback`  — assembly failed; the trusted fallback room was substituted.
 *   The host shows its safe notice.
 */
export type RoomProvenance = 'generated' | 'repaired' | 'fallback'

/** The pipeline stage whose failure forced the fallback (absent on success). */
export type RoomAssemblyStage = 'json' | 'schema' | 'semantic'

export type RoomDiagnostics = {
  /** Where the returned room came from. */
  provenance: RoomProvenance
  /** Set only when the room came from the fallback. */
  failedStage?: RoomAssemblyStage
  /**
   * Whether the returned generated room's floor dimensions (width/depth) were
   * clamped into the product contract [14..24 m]. This is a benign normalization,
   * NOT a playability repair: a size-only clamp keeps provenance `generated` and
   * must NOT trigger the host's repair/fallback notice. Always false for a
   * fallback room (the authored fallback is never clamped).
   */
  sizeRepaired: boolean
  /**
   * Whether any generated room object was normalized for layout: a footprint-aware
   * clamp into the playable floor, a wall-light nudge to a wall-side, a skipped
   * placeholder anchor clamp, or a trim to the generated-room object cap.
   * This is a benign normalization, NOT a playability repair: object repair keeps
   * provenance `generated` and must NOT trigger the host's repair/fallback notice.
   * Always false for a fallback room (the authored fallback objects are untouched).
   */
  objectsRepaired: boolean
  /** Whether composition relocated existing objects. Always false for fallback. */
  composed: boolean
  /** Whether the generated room had no story anchor. False for fallback. */
  lacksAnchor: boolean
  /** Whether the generated room had no interactable. False for fallback. */
  lacksInteractable: boolean
  /**
   * Whether the generated room spawn position was clamped into the playable floor
   * area or nudged away from a spawn-blocking object. This is a benign
   * normalization — keeps provenance `generated` and must NOT trigger the host's
   * repair/fallback notice. Always false for a fallback room.
   */
  spawnRepaired: boolean
  /**
   * Whether any exit-carrying generated room object was snapped to a valid wall
   * face (nearest of north/south/east/west). This is a benign normalization —
   * keeps provenance `generated` and must NOT trigger the host's repair/fallback
   * notice. Always false for a fallback room.
   */
  exitsRepaired: boolean
  /** Distinct fatal codes from the FIRST semantic validation (empty if none ran). */
  initialFatalCodes: RoomIssueCode[]
  /** Whether deterministic repair ran (only when an initial fatal was present). */
  repairAttempted: boolean
  /** Distinct fatal codes that remained AFTER repair (empty unless repair failed). */
  residualFatalCodes: RoomIssueCode[]
  /** Objects dropped by the lenient loader on the returned room. */
  skippedObjectCount: number
  /** Semantic warning count on the returned room. */
  warningCount: number
}

export type AssembledRoom = {
  room: LoadedRoom
  diagnostics: RoomDiagnostics
}

export function assembleRoom(
  rawText: string,
  fallbackRoom: LoadedRoom,
): AssembledRoom {
  // Stage 1 — JSON.parse. Never eval; malformed text is just a failed parse.
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return toFallback(fallbackRoom, 'json')
  }

  // Stage 2 — schema boundary. A broken envelope throws; bad objects are skipped
  // leniently (and surface as skippedObjectCount, not a failure).
  let loaded: LoadedRoom
  try {
    loaded = loadRoomSpec(parsed)
  } catch {
    return toFallback(fallbackRoom, 'schema')
  }

  // Stage 2.5 — clamp generated-room floor dimensions to the product contract
  // [14..24 m]. A same-reference result means no dimension changed. Height is
  // not constrained by the contract and is left as-is. This step runs on every
  // generated room regardless of whether semantic validation passes; the global
  // LIMITS in validateRoom stay loose so authored rooms are unaffected.
  const clamped = clampGeneratedShell(loaded)
  const sizeRepaired = clamped !== loaded

  // Stage 2.6 — clamp object X/Z positions into the playable floor area and cap
  // the object count at GENERATED_ROOM.MAX_OBJECTS. Both are benign normalizations
  // (like sizeRepaired): they keep provenance `generated` and must NOT trigger the
  // host's notice. Authored/fallback rooms never pass through this step.
  const objectsFixed = repairGeneratedObjects(clamped)
  const objectsRepaired = objectsFixed !== clamped

  // Stage 2.7 — arrange existing objects before the finalizers get the final say.
  const composition = composeGeneratedRoom(objectsFixed)
  const { composed, lacksAnchor, lacksInteractable } = composition.diagnostics

  // Stage 2.8 — clamp and nudge the generated spawn into a safe floor position.
  // Handles spawn outside the playable area, too close to wall, or crowded by a
  // blocking object. Keeps provenance `generated`; reported via `spawnRepaired`.
  const spawnFixed = repairGeneratedSpawn(composition.room)
  const spawnRepaired = spawnFixed !== composition.room

  // Stage 2.9 — snap each exit-carrying object to the nearest wall face
  // (±halfW or ±halfD). Runs after Stage 2.6 so that objects already clamped
  // to the playable interior are moved back to wall positions. Keeps provenance
  // `generated`; reported via `exitsRepaired`.
  const exitsFixed = repairGeneratedExits(spawnFixed)
  const exitsRepaired = exitsFixed !== spawnFixed

  // Stage 3 — semantic playability. No fatal issue → accept as generated. Benign
  // normalizations (Stages 2.5–2.9) keep provenance `generated` and show no notice;
  // they are reported via `sizeRepaired`/`objectsRepaired`/`spawnRepaired`/
  // `exitsRepaired` for logs only. A `repairRoom` pass (Stage 4) is the only
  // thing that yields `repaired`.
  const initial = validateRoom(exitsFixed)
  if (initial.ok) {
    return {
      room: exitsFixed,
      diagnostics: {
        provenance: 'generated',
        sizeRepaired,
        objectsRepaired,
        composed,
        lacksAnchor,
        lacksInteractable,
        spawnRepaired,
        exitsRepaired,
        initialFatalCodes: [],
        repairAttempted: false,
        residualFatalCodes: [],
        skippedObjectCount: exitsFixed.skipped.length,
        warningCount: countWarnings(initial),
      },
    }
  }

  // Stage 4 — one deterministic repair pass on the normalized room, then re-validate.
  // NOTE: Stages 2.5–2.9 currently pre-empt every fatal that repairRoom can fix
  // (spawn-out-of-bounds and object/light hard budgets), so the "repaired" branch
  // is intentionally dormant through this pipeline today. It is retained for future
  // repairable fatals that are not covered by generated-room normalizers.
  // repairRoom itself remains unit-tested directly.
  const initialFatalCodes = distinctFatalCodes(initial)
  const repaired = repairRoom(exitsFixed)
  const revalidated = validateRoom(repaired)
  if (revalidated.ok) {
    return {
      room: repaired,
      diagnostics: {
        provenance: 'repaired',
        sizeRepaired,
        objectsRepaired,
        composed,
        lacksAnchor,
        lacksInteractable,
        spawnRepaired,
        exitsRepaired,
        initialFatalCodes,
        repairAttempted: true,
        residualFatalCodes: [],
        skippedObjectCount: repaired.skipped.length,
        warningCount: countWarnings(revalidated),
      },
    }
  }

  // A fatal issue survived repair (e.g. an unrepairable room height) → fallback.
  return {
    room: fallbackRoom,
    diagnostics: {
      provenance: 'fallback',
      failedStage: 'semantic',
      // The returned room is the authored fallback, which is never normalized.
      sizeRepaired: false,
      objectsRepaired: false,
      composed: false,
      lacksAnchor: false,
      lacksInteractable: false,
      spawnRepaired: false,
      exitsRepaired: false,
      initialFatalCodes,
      repairAttempted: true,
      residualFatalCodes: distinctFatalCodes(revalidated),
      skippedObjectCount: fallbackRoom.skipped.length,
      warningCount: countWarnings(validateRoom(fallbackRoom)),
    },
  }
}

/** Build the fallback result for a pre-semantic (json/schema) failure. */
function toFallback(
  fallbackRoom: LoadedRoom,
  failedStage: 'json' | 'schema',
): AssembledRoom {
  return {
    room: fallbackRoom,
    diagnostics: {
      provenance: 'fallback',
      failedStage,
      sizeRepaired: false,
      objectsRepaired: false,
      composed: false,
      lacksAnchor: false,
      lacksInteractable: false,
      spawnRepaired: false,
      exitsRepaired: false,
      initialFatalCodes: [],
      repairAttempted: false,
      residualFatalCodes: [],
      skippedObjectCount: fallbackRoom.skipped.length,
      warningCount: countWarnings(validateRoom(fallbackRoom)),
    },
  }
}

/** Distinct fatal issue codes, in first-seen order (a fixed safe enum). */
function distinctFatalCodes(result: RoomValidationResult): RoomIssueCode[] {
  const codes: RoomIssueCode[] = []
  for (const issue of result.issues) {
    if (issue.severity === 'fatal' && !codes.includes(issue.code)) {
      codes.push(issue.code)
    }
  }
  return codes
}

function countWarnings(result: RoomValidationResult): number {
  return result.issues.filter((issue) => issue.severity === 'warning').length
}
