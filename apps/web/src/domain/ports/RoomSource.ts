import type { LoadedRoom } from '../loadRoomSpec'

/**
 * RoomSource port (ARCHITECTURE.md "Future plug-in points", FAILURE-MODES.md).
 *
 * The seam that answers "give me a room to render." It is async and
 * result-typed by contract so the host treats every source identically — the
 * static room today, a generated room or a fetched room later — and the
 * loading/error handling never has to change when the implementation does.
 *
 * Domain-pure: a contract only. No I/O, no React, no Three.js. Implementations
 * (StaticRoomSource today; GeneratedRoomSource/an API client later) live in the
 * composition layer, not here.
 */

/**
 * An expected, modeled room-load failure — returned as data, never thrown
 * (ADR-0003: problems as data; FAILURE-MODES.md cases 1 and 5). The host turns
 * it into a calm fallback screen and a structured log line.
 */
export type RoomLoadError = {
  /**
   * Stable, machine-readable cause.
   * - `invalid-room`: the spec failed envelope validation (FAILURE-MODES case 1).
   * - `unavailable`: the source could not produce a room — e.g. a future
   *   network/generation failure (FAILURE-MODES case 5).
   */
  code: 'invalid-room' | 'unavailable'
  /** Short, user-safe summary. Never a stack trace, internal path, or secret. */
  message: string
}

/**
 * The outcome of a room load: a validated room, or a typed failure. A typed
 * result (rather than a thrown error for expected failures) keeps the host's
 * branch handling explicit; genuine bugs may still throw and reach the host's
 * error boundary.
 */
export type RoomLoadResult =
  | { ok: true; room: LoadedRoom }
  | { ok: false; error: RoomLoadError }

export interface RoomSource {
  /** Produce a room to render. Resolves to a typed result, not a throw. */
  getRoom(): Promise<RoomLoadResult>
}
