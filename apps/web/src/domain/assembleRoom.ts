import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import { repairRoom } from './repairRoom'
import { validateRoom } from './validateRoom'
import type { RoomIssueCode, RoomValidationResult } from './validateRoom'

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
export type RoomProvenance = 'generated' | 'repaired' | 'fallback'

/** The pipeline stage whose failure forced the fallback (absent on success). */
export type RoomAssemblyStage = 'json' | 'schema' | 'semantic'

export type RoomDiagnostics = {
  /** Where the returned room came from. */
  provenance: RoomProvenance
  /** Set only when the room came from the fallback. */
  failedStage?: RoomAssemblyStage
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

  // Stage 3 — semantic playability. No fatal issue → accept as generated.
  const initial = validateRoom(loaded)
  if (initial.ok) {
    return {
      room: loaded,
      diagnostics: {
        provenance: 'generated',
        initialFatalCodes: [],
        repairAttempted: false,
        residualFatalCodes: [],
        skippedObjectCount: loaded.skipped.length,
        warningCount: countWarnings(initial),
      },
    }
  }

  // Stage 4 — one deterministic repair pass, then re-validate.
  const initialFatalCodes = distinctFatalCodes(initial)
  const repaired = repairRoom(loaded)
  const revalidated = validateRoom(repaired)
  if (revalidated.ok) {
    return {
      room: repaired,
      diagnostics: {
        provenance: 'repaired',
        initialFatalCodes,
        repairAttempted: true,
        residualFatalCodes: [],
        skippedObjectCount: repaired.skipped.length,
        warningCount: countWarnings(revalidated),
      },
    }
  }

  // A fatal issue survived repair (e.g. an unrepairable room size) → fallback.
  return {
    room: fallbackRoom,
    diagnostics: {
      provenance: 'fallback',
      failedStage: 'semantic',
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
