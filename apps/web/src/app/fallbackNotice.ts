import type { RoomProvenance } from '../domain/assembleRoom'

/**
 * The App-level "safe fallback" notice (room-generation-repair-fallback v0).
 *
 * When a generated room could not be built exactly as asked — it had to be
 * deterministically repaired, or replaced by the trusted fallback room — the
 * host shows a small, dismissable notice. The copy is STATIC and prompt-free: it
 * never echoes the prompt, the raw output, or any diagnostic detail (those stay
 * in the source's structured logs, per FAILURE-MODES.md cases 4 / 4b).
 */
export const FALLBACK_NOTICE =
  "This room needed a safe fallback, so you're seeing a stable version. You can keep exploring or try a different idea."

/**
 * Show the notice only when the room did not come through cleanly. A `generated`
 * room (or an unset provenance, e.g. a static/preloaded source) shows nothing.
 */
export function shouldShowFallbackNotice(provenance?: RoomProvenance): boolean {
  return provenance === 'repaired' || provenance === 'fallback'
}
