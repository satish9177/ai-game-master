import type { RoomSource, RoomLoadResult } from '../domain/ports/RoomSource'
import type { RoomGenerator } from '../domain/ports/RoomGenerator'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import { assembleRoom } from '../domain/assembleRoom'
import type { RoomDiagnostics } from '../domain/assembleRoom'
import type { Logger } from '../platform/logger/Logger'

/**
 * A RoomSource that turns a prompt into a room via a RoomGenerator, then through
 * the deterministic assembly pipeline (ADR-0007; FAILURE-MODES.md cases 4 / 4b).
 * It depends on the RoomGenerator *port*, so the deterministic fake today and a
 * real LLM client later are interchangeable with no change here.
 *
 * This is a composition-layer adapter, not domain (like StaticRoomSource): it
 * wires a concrete generator to the pure `assembleRoom` core and maps the outcome
 * to the typed RoomLoadResult the host already understands.
 *
 * THE TRUST BOUNDARY. The generator returns raw, untrusted JSON *text*. It is
 * DATA, never behavior: `assembleRoom` runs it through `JSON.parse` (never
 * `eval`) → `loadRoomSpec` → `validateRoom` → a single deterministic repair → a
 * trusted fallback, and ALWAYS yields a valid, playable room. So malformed JSON,
 * a bad envelope, or an unrepairable room is no longer a load failure: it becomes
 * a `repaired` or `fallback` room (`ok: true`) the renderer can safely show.
 *
 * Two outcomes only:
 * - The generator THROWS/REJECTS (an infrastructure failure — today never; later
 *   a network/LLM error) → `unavailable`, the retry path. The error message is an
 *   infra detail, not model output, so it is safe to log.
 * - The generator returns text → `assembleRoom` → always `ok: true`, with
 *   `provenance` telling the host whether to show the safe fallback notice.
 */
export class GeneratedRoomSource implements RoomSource {
  // Fields declared explicitly (not constructor parameter-properties, which
  // erasableSyntaxOnly forbids).
  private readonly generator: RoomGenerator
  private readonly prompt: string
  private readonly fallbackRoom: LoadedRoom
  private readonly log: Logger

  constructor(
    generator: RoomGenerator,
    prompt: string,
    logger: Logger,
    fallbackRoom: LoadedRoom,
  ) {
    this.generator = generator
    this.prompt = prompt
    this.fallbackRoom = fallbackRoom
    // Bind promptLength once so every line carries it. The prompt TEXT is never
    // logged (it is user content; ADR-0003, FAILURE-MODES case 4) — only its length.
    this.log = logger.child({ promptLength: prompt.length })
  }

  async getRoom(): Promise<RoomLoadResult> {
    // 1. Generate. A throw/reject here is an infrastructure failure → `unavailable`.
    let raw: string
    try {
      raw = await this.generator.generate(this.prompt)
    } catch (err) {
      this.log.error('room generation failed', { error: describeError(err) })
      return fail('unavailable', GENERATION_UNAVAILABLE_MESSAGE)
    }

    // 2. Assemble. The pure pipeline parses + validates + repairs + falls back,
    //    always returning a valid room. We never log the raw text or any parse /
    //    schema error detail — it is model-derived and could echo prompt content.
    //    The diagnostics are safe by construction (provenance, stage, fixed issue
    //    codes, counts, booleans — never messages/names/raw text).
    const { room, diagnostics } = assembleRoom(raw, this.fallbackRoom)
    this.logAssembly(room, diagnostics)
    return { ok: true, room, provenance: diagnostics.provenance }
  }

  /** One structured line per call, with only log-safe diagnostics. */
  private logAssembly(room: LoadedRoom, diagnostics: RoomDiagnostics): void {
    const context = {
      provenance: diagnostics.provenance,
      failedStage: diagnostics.failedStage,
      sizeRepaired: diagnostics.sizeRepaired,
      repairAttempted: diagnostics.repairAttempted,
      initialFatalCodes: diagnostics.initialFatalCodes,
      residualFatalCodes: diagnostics.residualFatalCodes,
      objectCount: room.objects.length,
      skippedObjectCount: diagnostics.skippedObjectCount,
      warningCount: diagnostics.warningCount,
    }
    // A clean generated room is the happy path (info); a repair or fallback is a
    // degraded outcome worth a warn so it stands out in the logs.
    if (diagnostics.provenance === 'generated') {
      this.log.info('room generated', context)
    } else {
      this.log.warn('room assembled via repair or fallback', context)
    }
  }
}

/** Safe, user-facing copy — detail goes to the log, never to the user. */
const GENERATION_UNAVAILABLE_MESSAGE = 'Could not generate a room. Please try again.'

/** Build a typed failure result. */
function fail(code: 'invalid-room' | 'unavailable', message: string): RoomLoadResult {
  return { ok: false, error: { code, message } }
}

/** Log-safe summary of an unknown thrown value (mirrors the host). */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
