import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom, SkippedObjectReasonCounts } from './loadRoomSpec'
import { repairRoom } from './repairRoom'
import { validateRoom } from './validateRoom'
import type { RoomIssueCode, RoomValidationResult } from './validateRoom'
import { clampGeneratedShell, repairGeneratedObjects, repairGeneratedSpawn, repairGeneratedExits } from './generatedRoomLayout'
import { composeGeneratedRoom } from './generatedRoomComposition'
import { repairGeneratedAliases } from './generatedRoomAliases'
import { repairGeneratedObjectTransforms } from './generatedRoomObjectTransforms'
import { assignGeneratedObjectPurpose } from './generatedRoomObjectPurpose'
import { ensureGeneratedNpcPresence } from './ensureGeneratedNpcPresence'
import { ensureGeneratedExitNavigation } from './ensureGeneratedExitNavigation'
import { ensureGeneratedObjectiveTarget } from './generatedRoomObjectiveTarget'
import { sanitizeGeneratedDisplayText } from './sanitizeGeneratedDisplayText'
import { buildGeneratedMechanicalGate } from './generatedMechanicalGate'
import type { GeneratedRoomVisualTheme } from './generatedRoomThemeVocabulary'
import type { GeneratedStoryThreadKind } from './generatedStoryThread'

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
  /** Whether the returned generated room has at least one stable usable exit. */
  exitNavigationEnsured: boolean
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
  /**
   * Number of object entries whose `type` was rewritten from a known
   * natural-language alias to a canonical RoomSpec type at Stage 1.5
   * (before loadRoomSpec). Always 0 for all fallback paths; the alias strings
   * themselves are never logged.
   */
  aliasesRepaired: number
  /**
   * Number of object entries whose malformed optional transform fields
   * (`rotationY` / `scale`) were removed before loadRoomSpec so schema defaults
   * could apply. Count-only: raw values are never stored or logged. Always 0 for
   * all fallback paths.
   */
  objectTransformsRepaired: number
  /**
   * Number of generated room objects that received a safe, presentation-only
   * interaction purpose. Count-only: never object names, ids, prompts, raw JSON,
   * or generated text. Always 0 for all fallback paths.
   */
  purposesAssigned: number
  /** Whether one safe generated NPC was inserted from an explicit boolean request. */
  npcInserted: boolean
  /**
   * Whether one existing generated object was promoted to objective-ready.
   * Boolean-only; never carries object ids, text, names, or generated content.
   */
  objectiveTargetEnriched: boolean
  /**
   * Whether generated structural ids were removed from allowlisted player-facing
   * display text. Count-only; never carries the strings that were sanitized.
   */
  displayTextSanitized: boolean
  /**
   * Number of allowlisted display string fields changed by display-text
   * sanitization. Counts fields, not token occurrences.
   */
  displayTextSanitizationCount: number
  /**
   * Aggregate count of skipped object entries by validation failure reason,
   * as classified by the lenient loader. Count-only: no raw type strings or
   * field values are stored. For fallback rooms the counts reflect the authored
   * fallback room's load (always all-zero for a well-authored fallback).
   */
  skippedObjectReasonCounts: SkippedObjectReasonCounts
  /**
   * Whether a contract-valid, satisfiable mechanical gate can be derived from
   * the returned generated room. Boolean-only; never carries gate ids, room ids,
   * object ids, flag keys, exit targets, raw gate JSON, prompts, or generated text.
   */
  mechanicalGateAvailable: boolean
}

export type AssembledRoom = {
  room: LoadedRoom
  diagnostics: RoomDiagnostics
}

export type AssembleRoomOptions = {
  requestsNpc?: boolean
  enrichObjectiveTarget?: boolean
  deriveMechanicalGateDiagnostic?: boolean
  themePack?: GeneratedRoomVisualTheme
  storyKind?: GeneratedStoryThreadKind
}

export function assembleRoom(
  rawText: string,
  fallbackRoom: LoadedRoom,
  options: AssembleRoomOptions = {},
): AssembledRoom {
  // Stage 1 — JSON.parse. Never eval; malformed text is just a failed parse.
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return toFallback(fallbackRoom, 'json')
  }

  // Stage 1.5 — alias repair. Pure, deterministic, allowlist-based rewrite of
  // known natural-language noun `type` strings (e.g. "desk", "skeleton") to their
  // canonical RoomSpec type strings before Zod validation runs. Authored/static/
  // fallback rooms never enter assembleRoom, so this only ever touches generated-
  // room JSON. Only the count is kept for diagnostics; alias strings are not logged.
  const { value: aliasesRepairedParsed, count: aliasesRepaired } = repairGeneratedAliases(parsed)

  // Stage 1.6 — optional transform repair. Remove malformed generated-object
  // `rotationY`/`scale` fields before loadRoomSpec so schema defaults apply.
  // This is generated-room-only, benign, count-only, and never coerces values.
  const {
    value: repairedParsed,
    count: objectTransformsRepaired,
  } = repairGeneratedObjectTransforms(aliasesRepairedParsed)

  // Stage 2 — schema boundary. A broken envelope throws; bad objects are skipped
  // leniently (and surface as skippedObjectCount, not a failure).
  let loaded: LoadedRoom
  try {
    loaded = loadRoomSpec(repairedParsed)
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
  const composition = composeGeneratedRoom(objectsFixed, {
    themePack: options.themePack,
    storyKind: options.storyKind,
  })
  const { composed, lacksAnchor, lacksInteractable } = composition.diagnostics

  // Stage 2.8 — clamp and nudge the generated spawn into a safe floor position.
  // Handles spawn outside the playable area, too close to wall, or crowded by a
  // blocking object. Keeps provenance `generated`; reported via `spawnRepaired`.
  const spawnFixed = repairGeneratedSpawn(composition.room)
  const spawnRepaired = spawnFixed !== composition.room

  // Stage 2.9 — ensure at least one stable, usable generated exit exists before
  // wall snapping. Existing usable exits are preserved; otherwise the first arch
  // is upgraded, or a safe wall arch is inserted.
  const exitNavigationResult = ensureGeneratedExitNavigation(spawnFixed)
  const exitNavigationFixed = exitNavigationResult.room
  const { exitNavigationEnsured } = exitNavigationResult

  // Stage 2.10 — snap each exit-carrying object to the nearest wall face
  // (±halfW or ±halfD). Runs after Stage 2.6 so that objects already clamped
  // to the playable interior are moved back to wall positions. Keeps provenance
  // `generated`; reported via `exitsRepaired`.
  const exitsFixed = repairGeneratedExits(exitNavigationFixed)
  const exitsRepaired = exitsFixed !== exitNavigationFixed

  // Stage 2.11 — assign presentation-only purposes to safe generated objects
  // that currently lack an interaction. This is generated-room-only because
  // authored/static/fallback/restored rooms never enter assembleRoom. It does
  // not affect geometry, exits, effects, encounters, quests, inventory, or world
  // state, and it returns only a count for diagnostics.
  const purposeResult = assignGeneratedObjectPurpose(exitsFixed)
  const purposeFixed = purposeResult.room
  const { purposesAssigned } = purposeResult

  // Stage 2.12 — optionally insert one safe generated NPC from a boolean-only
  // prompt classifier signal. No prompt text enters this domain function.
  const npcPresenceResult = ensureGeneratedNpcPresence(purposeFixed, {
    requested: options.requestsNpc ?? false,
  })
  const npcPresenceFixed = npcPresenceResult.room
  const { npcInserted } = npcPresenceResult

  // Stage 2.12.5 - optionally promote one existing eligible generated object to
  // objective-ready. Gated off by default; adds only an inspect effect.
  const objectiveTargetResult = options.enrichObjectiveTarget === true
    ? ensureGeneratedObjectiveTarget(npcPresenceFixed)
    : { room: npcPresenceFixed, objectiveTargetEnriched: false }
  const objectiveTargetFixed = objectiveTargetResult.room
  const { objectiveTargetEnriched } = objectiveTargetResult

  // Stage 2.13 - display sanitization runs after objective target enrichment.
  const displayTextResult = sanitizeGeneratedDisplayText(objectiveTargetFixed)
  const displayTextFixed = displayTextResult.room
  const { displayTextSanitized, displayTextSanitizationCount } = displayTextResult
  const mechanicalGateAvailable = options.deriveMechanicalGateDiagnostic === true
    && buildGeneratedMechanicalGate(displayTextFixed) !== null

  // Stage 3 — semantic playability. No fatal issue → accept as generated. Benign
  // normalizations (Stages 2.5–2.9) keep provenance `generated` and show no notice;
  // they are reported via `sizeRepaired`/`objectsRepaired`/`spawnRepaired`/
  // `exitsRepaired` for logs only. A `repairRoom` pass (Stage 4) is the only
  // thing that yields `repaired`.
  const initial = validateRoom(displayTextFixed)
  if (initial.ok) {
    return {
      room: displayTextFixed,
      diagnostics: {
        provenance: 'generated',
        sizeRepaired,
        objectsRepaired,
        composed,
        lacksAnchor,
        lacksInteractable,
        spawnRepaired,
        exitsRepaired,
        exitNavigationEnsured,
        initialFatalCodes: [],
        repairAttempted: false,
        residualFatalCodes: [],
        skippedObjectCount: exitsFixed.skipped.length,
        warningCount: countWarnings(initial),
        aliasesRepaired,
        objectTransformsRepaired,
        purposesAssigned,
        npcInserted,
        objectiveTargetEnriched,
        displayTextSanitized,
        displayTextSanitizationCount,
        skippedObjectReasonCounts: displayTextFixed.skippedObjectReasonCounts,
        mechanicalGateAvailable,
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
  const repaired = repairRoom(displayTextFixed)
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
        exitNavigationEnsured,
        initialFatalCodes,
        repairAttempted: true,
        residualFatalCodes: [],
        skippedObjectCount: repaired.skipped.length,
        warningCount: countWarnings(revalidated),
        aliasesRepaired,
        objectTransformsRepaired,
        purposesAssigned,
        npcInserted,
        objectiveTargetEnriched,
        displayTextSanitized,
        displayTextSanitizationCount,
        skippedObjectReasonCounts: repaired.skippedObjectReasonCounts,
        mechanicalGateAvailable: false,
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
      exitNavigationEnsured: false,
      initialFatalCodes,
      repairAttempted: true,
      residualFatalCodes: distinctFatalCodes(revalidated),
      skippedObjectCount: fallbackRoom.skipped.length,
      warningCount: countWarnings(validateRoom(fallbackRoom)),
      aliasesRepaired: 0,
      objectTransformsRepaired: 0,
      purposesAssigned: 0,
      npcInserted: false,
      objectiveTargetEnriched: false,
      displayTextSanitized: false,
      displayTextSanitizationCount: 0,
      skippedObjectReasonCounts: fallbackRoom.skippedObjectReasonCounts,
      mechanicalGateAvailable: false,
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
      exitNavigationEnsured: false,
      initialFatalCodes: [],
      repairAttempted: false,
      residualFatalCodes: [],
      skippedObjectCount: fallbackRoom.skipped.length,
      warningCount: countWarnings(validateRoom(fallbackRoom)),
      aliasesRepaired: 0,
      objectTransformsRepaired: 0,
      purposesAssigned: 0,
      npcInserted: false,
      objectiveTargetEnriched: false,
      displayTextSanitized: false,
      displayTextSanitizationCount: 0,
      skippedObjectReasonCounts: fallbackRoom.skippedObjectReasonCounts,
      mechanicalGateAvailable: false,
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
