import type { RoomSource, RoomLoadResult } from '../domain/ports/RoomSource'
import type { RoomGenerator } from '../domain/ports/RoomGenerator'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import type { Logger } from '../platform/logger/Logger'

/**
 * A RoomSource that turns a prompt into a room via a RoomGenerator, validated
 * through the SAME loadRoomSpec boundary every source uses (ADR-0001, ADR-0007
 * stage 1; FAILURE-MODES.md case 4). It depends on the RoomGenerator *port*, so
 * the deterministic fake today and a real LLM client later are interchangeable
 * with no change here.
 *
 * This is a composition-layer adapter, not domain (like StaticRoomSource): it
 * wires a concrete generator to the loader and maps outcomes to the typed
 * RoomLoadResult the host already understands. The RoomSource port is unchanged.
 *
 * THE TRUST BOUNDARY. The generator returns raw, untrusted JSON *text*. It is
 * DATA, never behavior: we `JSON.parse` it (never `eval`) and then `loadRoomSpec`
 * it before anything reaches the renderer. Malformed JSON, a bad envelope, or
 * hostile content is just data that fails validation and becomes a typed error —
 * there is no path to execution.
 */
export class GeneratedRoomSource implements RoomSource {
  // Fields declared explicitly (not constructor parameter-properties, which
  // erasableSyntaxOnly forbids).
  private readonly generator: RoomGenerator
  private readonly prompt: string
  private readonly log: Logger

  constructor(generator: RoomGenerator, prompt: string, logger: Logger) {
    this.generator = generator
    this.prompt = prompt
    // Bind promptLength once so every line carries it. The prompt TEXT is never
    // logged (it is user content; ADR-0003, FAILURE-MODES case 4) — only its length.
    this.log = logger.child({ promptLength: prompt.length })
  }

  async getRoom(): Promise<RoomLoadResult> {
    // 1. Generate. A throw/reject here is an infrastructure failure (today: never;
    //    later: a network/LLM error) → `unavailable`. The error message is an
    //    infra detail, not model output, so it is safe to log.
    let raw: string
    try {
      raw = await this.generator.generate(this.prompt)
    } catch (err) {
      this.log.error('room generation failed', { error: describeError(err) })
      return fail('unavailable', GENERATION_UNAVAILABLE_MESSAGE)
    }

    // 2. Parse the untrusted text. We do NOT log the raw text or the parse-error
    //    detail — it is model-derived and could echo prompt content; the stable
    //    code is enough (FAILURE-MODES case 4: never log full prompts).
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.log.error('generated spec is not valid json', { code: 'invalid-room' })
      return fail('invalid-room', INVALID_ROOM_MESSAGE)
    }

    // 3. Validate at the boundary. A bad envelope throws (FAILURE-MODES case 1) →
    //    `invalid-room`. Bad *objects* don't throw — they are skipped leniently
    //    and surface as warnings/skipped on a successful room (case 2).
    let room: LoadedRoom
    try {
      room = loadRoomSpec(parsed)
    } catch {
      this.log.error('generated spec failed validation', { code: 'invalid-room' })
      return fail('invalid-room', INVALID_ROOM_MESSAGE)
    }

    // 4. Success — including the lenient case where some objects were skipped. One
    //    info line with safe counts; the host separately surfaces the skipped
    //    objects, so we don't warn here too (avoid double-logging).
    this.log.info('room generated', {
      objectCount: room.objects.length,
      skippedCount: room.skipped.length,
      warningCount: room.warnings.length,
    })
    return { ok: true, room }
  }
}

/** Safe, user-facing copy — detail goes to the log, never to the user. */
const INVALID_ROOM_MESSAGE = 'This room could not be loaded.'
const GENERATION_UNAVAILABLE_MESSAGE = 'Could not generate a room. Please try again.'

/** Build a typed failure result. */
function fail(code: 'invalid-room' | 'unavailable', message: string): RoomLoadResult {
  return { ok: false, error: { code, message } }
}

/** Log-safe summary of an unknown thrown value (mirrors the host). */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
