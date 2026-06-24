import { describe, it, expect } from 'vitest'
import { GeneratedRoomSource } from './GeneratedRoomSource'
import { FakeRoomGenerator } from '../generation/FakeRoomGenerator'
import type { RoomGenerator } from '../domain/ports/RoomGenerator'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import { fallbackRoom } from '../domain/examples/fallbackRoom'
import { shouldShowFallbackNotice } from '../app/fallbackNotice'
import type { Logger, LogContext, LogLevel } from '../platform/logger/Logger'

/* ---------- test doubles ---------- */

type Entry = { level: LogLevel; message: string; context: LogContext }

/**
 * A recording Logger. `child` merges bindings and writes to the SAME entries
 * array, so a test can inspect everything the source logged (including the
 * promptLength bound in the constructor).
 */
function createSpyLogger(): { logger: Logger; entries: Entry[] } {
  const entries: Entry[] = []
  const build = (bindings: LogContext): Logger => {
    const record =
      (level: LogLevel) =>
      (message: string, context: LogContext = {}) => {
        entries.push({ level, message, context: { ...bindings, ...context } })
      }
    return {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      child: (childBindings: LogContext) => build({ ...bindings, ...childBindings }),
    }
  }
  return { logger: build({}), entries }
}

// Stub generators — the port only, never FakeRoomGenerator, so each path is
// controlled. They ignore the prompt; the source's job is generate + assemble + map.
const generatorReturning = (text: string): RoomGenerator => ({
  generate: () => Promise.resolve(text),
})
const generatorRejecting = (err: unknown): RoomGenerator => ({
  generate: () => Promise.reject(err),
})

/** The trusted fallback, validated once (as the App injects it). */
const FALLBACK: LoadedRoom = loadRoomSpec(fallbackRoom)

const newSource = (gen: RoomGenerator, prompt: string, logger: Logger) =>
  new GeneratedRoomSource(gen, prompt, logger, FALLBACK)

// Dimensions within the generated-room contract [14..24] so tests that expect
// provenance 'generated' are not affected by dimension repair.
const base = {
  schemaVersion: 1,
  id: 'stub-room',
  name: 'Stub Room',
  shell: { dimensions: { width: 18, depth: 18, height: 4 }, exits: [{ side: 'north', width: 3 }] },
  spawn: { position: [0, 1.7, 4] },
}
const VALID_SPEC = JSON.stringify({ ...base, objects: [{ type: 'pillar', position: [4, 0, -2] }] })
const SPEC_WITH_BAD_OBJECT = JSON.stringify({
  ...base,
  objects: [
    { type: 'pillar', position: [4, 0, -2] }, // valid
    { type: 'pillar', position: 'not-a-vec' }, // invalid → skipped leniently
  ],
})
const BAD_ENVELOPE = JSON.stringify({ schemaVersion: 1, id: 'x' }) // missing name/shell/spawn/objects
const MALFORMED_JSON = '{ not valid json'

// Schema-valid but NOT playable, and REPAIRABLE: a spawn far outside a normal-size
// room → fatal `spawn-out-of-bounds`, which repairRoom clamps back into bounds.
const REPAIRABLE_SPEC = JSON.stringify({ ...base, spawn: { position: [100, 1.7, 0] }, objects: [] })
// height=400 exceeds LIMITS.MAX_ROOM_DIM (300) → fatal `room-too-large`.
// clampGeneratedShell does not touch height; repairRoom does not resize → fallback.
const UNREPAIRABLE_SPEC = JSON.stringify({
  schemaVersion: 1,
  id: 'unrepairable-room',
  name: 'Unrepairable Room',
  shell: { dimensions: { width: 18, depth: 18, height: 400 }, exits: [{ side: 'north', width: 3 }] },
  spawn: { position: [0, 1.7, 0] },
  objects: [],
})

/* ---------- tests ---------- */

describe('GeneratedRoomSource', () => {
  it('valid JSON spec → ok:true, provenance generated', async () => {
    const { logger } = createSpyLogger()
    const result = await newSource(generatorReturning(VALID_SPEC), 'a calm room', logger).getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provenance).toBe('generated')
      expect(result.room.id).toBe('stub-room')
      expect(result.room.objects).toHaveLength(1)
    }
  })

  it('malformed JSON → ok:true with the fallback room (provenance fallback)', async () => {
    const { logger } = createSpyLogger()
    const result = await newSource(generatorReturning(MALFORMED_JSON), 'p', logger).getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provenance).toBe('fallback')
      expect(result.room.id).toBe('fallback-room')
    }
  })

  it('schema-invalid envelope → ok:true with the fallback room (provenance fallback)', async () => {
    const { logger } = createSpyLogger()
    const result = await newSource(generatorReturning(BAD_ENVELOPE), 'p', logger).getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provenance).toBe('fallback')
      expect(result.room.id).toBe('fallback-room')
    }
  })

  it('repairable semantic fatal → ok:true, provenance repaired (generated room kept)', async () => {
    const { logger } = createSpyLogger()
    const result = await newSource(generatorReturning(REPAIRABLE_SPEC), 'p', logger).getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provenance).toBe('repaired')
      expect(result.room.id).toBe('stub-room') // the repaired generated room, not the fallback
    }
  })

  it('unrepairable semantic fatal → ok:true with the fallback room (provenance fallback)', async () => {
    const { logger } = createSpyLogger()
    const result = await newSource(generatorReturning(UNREPAIRABLE_SPEC), 'p', logger).getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provenance).toBe('fallback')
      expect(result.room.id).toBe('fallback-room')
    }
  })

  it('generator rejects → ok:false, code unavailable (the retry path)', async () => {
    const { logger } = createSpyLogger()
    const result = await newSource(
      generatorRejecting(new Error('network down')),
      'p',
      logger,
    ).getRoom()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('unavailable')
      expect(result.error.message).toBe('Could not generate a room. Please try again.')
    }
  })

  it('lenient bad object → ok:true generated, warnings/skipped preserved', async () => {
    const { logger } = createSpyLogger()
    const result = await newSource(generatorReturning(SPEC_WITH_BAD_OBJECT), 'p', logger).getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provenance).toBe('generated')
      expect(result.room.objects).toHaveLength(1)
      expect(result.room.skipped).toHaveLength(1)
      expect(result.room.warnings).toHaveLength(1)
    }
  })

  it('logs safe diagnostics (promptLength + provenance + counts) at info on a clean room', async () => {
    const { logger, entries } = createSpyLogger()
    const prompt = 'a haunted hall'
    await newSource(generatorReturning(VALID_SPEC), prompt, logger).getRoom()
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.level).toBe('info')
    expect(entry.context.promptLength).toBe(prompt.length)
    expect(entry.context.provenance).toBe('generated')
    expect(entry.context.objectCount).toBe(1)
    expect(entry.context.skippedObjectCount).toBe(0)
    expect(typeof entry.context.warningCount).toBe('number')
  })

  it('logs a repaired/fallback outcome once at warn with safe diagnostics', async () => {
    const { logger, entries } = createSpyLogger()
    await newSource(generatorReturning(UNREPAIRABLE_SPEC), 'p', logger).getRoom()
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.level).toBe('warn')
    expect(entry.context.provenance).toBe('fallback')
    expect(entry.context.failedStage).toBe('semantic')
    expect(entry.context.repairAttempted).toBe(true)
    expect(entry.context.residualFatalCodes).toEqual(['room-too-large'])
  })

  it('never leaks the prompt, raw JSON, story text, or object names on any path', async () => {
    const prompt = 'TOP-SECRET-PROMPT-do-not-leak-42'
    // A valid room carrying unique story/name sentinels we must never see in logs.
    const STORY_SPEC = JSON.stringify({
      ...base,
      objects: [
        {
          type: 'npc',
          name: 'SECRET-NPC-NAME-9000',
          position: [4, 0, -3],
          interaction: {
            key: 'F',
            prompt: 'SECRET-PROMPT-LABEL',
            body: 'SECRET-STORY-BODY-TEXT',
          },
        },
      ],
    })
    const RAW_WITH_SENTINEL = '{ broken json SECRET-RAW-CONTENT-7777'
    const cases = [
      generatorReturning(VALID_SPEC),
      generatorReturning(STORY_SPEC),
      generatorReturning(REPAIRABLE_SPEC),
      generatorReturning(UNREPAIRABLE_SPEC),
      generatorReturning(RAW_WITH_SENTINEL),
      generatorReturning(BAD_ENVELOPE),
      generatorRejecting(new Error('boom')),
    ]
    for (const gen of cases) {
      const { logger, entries } = createSpyLogger()
      await newSource(gen, prompt, logger).getRoom()
      expect(entries.length).toBeGreaterThan(0) // every path logs at least once
      const dump = JSON.stringify(entries)
      expect(dump).not.toContain(prompt)
      expect(dump).not.toContain('SECRET-NPC-NAME-9000')
      expect(dump).not.toContain('SECRET-PROMPT-LABEL')
      expect(dump).not.toContain('SECRET-STORY-BODY-TEXT')
      expect(dump).not.toContain('SECRET-RAW-CONTENT-7777')
    }
  })

  it('every FakeRoomGenerator output is generated and playable (no repair/fallback)', async () => {
    // FakeRoomGenerator emits width 10–19 m and depth 12–23 m. Outputs below the
    // generated-room MIN_SIZE (14) are size-clamped UP into the contract — a benign
    // normalization that keeps provenance 'generated' (no repairRoom, no notice).
    // Clamping only enlarges the room, so spawn/objects stay in bounds: none ever
    // needs a real repair or the fallback.
    const prompts = [
      'a calm throne room',
      'haunted hall of echoes',
      'tiny candlelit shrine',
      'grand cathedral of light',
      'dark dripping crypt',
      'sunlit marble atrium',
      'cluttered wizard study',
      '',
    ]
    for (const prompt of prompts) {
      const { logger } = createSpyLogger()
      const result = await newSource(new FakeRoomGenerator(), prompt, logger).getRoom()
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.provenance).toBe('generated')
    }
  })

  it('size-only clamp stays generated, logs at info, and shows NO fallback notice', async () => {
    // A schema-valid room below the contract MIN_SIZE: width/depth are clamped UP,
    // but that is a benign normalization — not a repair. The host must not show the
    // "couldn't build that exactly" notice for it.
    const SUB_CONTRACT_SPEC = JSON.stringify({
      ...base,
      shell: { dimensions: { width: 10, depth: 12, height: 4 }, exits: [{ side: 'north', width: 3 }] },
      objects: [],
    })
    const { logger, entries } = createSpyLogger()
    const result = await newSource(generatorReturning(SUB_CONTRACT_SPEC), 'p', logger).getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provenance).toBe('generated')
      expect(shouldShowFallbackNotice(result.provenance)).toBe(false) // no misleading notice
      expect(result.room.shell.dimensions.width).toBe(14) // clamped into contract
      expect(result.room.shell.dimensions.depth).toBe(14)
    }
    // Logged as a clean room (info) with the clamp recorded in safe diagnostics.
    expect(entries).toHaveLength(1)
    expect(entries[0]!.level).toBe('info')
    expect(entries[0]!.context.sizeRepaired).toBe(true)
  })

  it('a real repairRoom repair still surfaces the fallback notice (provenance repaired)', () => {
    // Regression guard for the notice decision: a genuine repair must still notify.
    expect(shouldShowFallbackNotice('repaired')).toBe(true)
    expect(shouldShowFallbackNotice('fallback')).toBe(true)
    expect(shouldShowFallbackNotice('generated')).toBe(false)
  })
})
