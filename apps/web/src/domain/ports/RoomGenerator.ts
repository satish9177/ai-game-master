/**
 * RoomGenerator port (ARCHITECTURE.md "Future plug-in points"; ADR-0007
 * generation pipeline, stage 1: "fast LLM → RoomSpec JSON").
 *
 * The seam that turns a user prompt into a room *description*. Its first
 * implementation is a deterministic fake (Generation Foundation v0); a real LLM
 * client comes later. The contract is identical for both, so nothing downstream
 * changes when the fake is swapped for a model.
 *
 * Domain-pure: a contract only. No I/O, no React, no Three.js, no logger.
 * Implementations live in the generation layer, not here.
 *
 * THE TRUST BOUNDARY (ADR-0001). The returned string is **raw, untrusted JSON
 * text** — the same shape a future LLM completion would have. It is DATA, never
 * behavior:
 *
 * - The generator MUST NOT return executable code — no JS/Three.js/React, no
 *   Unity C#/Godot script, no `eval`-able expressions. Only JSON-shaped RoomSpec
 *   data.
 * - The caller MUST parse it with `JSON.parse` (never `eval`), then validate the
 *   parsed value through `loadRoomSpec` before anything reaches the renderer.
 * - Until it has passed `loadRoomSpec` the value is untrusted: malformed JSON, a
 *   schema-invalid envelope, or hostile content is still just data that fails
 *   validation and is rejected or skipped — there is no path to execution
 *   (FAILURE-MODES.md case 4; ADR-0001).
 *
 * Returning text (rather than a parsed object or a typed `RoomSpec`) is
 * deliberate: it models the real LLM honestly and keeps parsing and validation
 * as explicit steps at the trust boundary, where they belong.
 */
export interface RoomGenerator {
  /**
   * Produce a room as raw, untrusted JSON text for the given prompt. Resolves to
   * a string the caller must `JSON.parse` and then validate via `loadRoomSpec`.
   * Never returns executable code.
   */
  generate(prompt: string): Promise<string>
}
