import { describe, it, expect } from 'vitest'
import { GeneratedRoomSource } from './GeneratedRoomSource'
import { FakeRoomGenerator } from '../generation/FakeRoomGenerator'
import type { RoomGenerator } from '../domain/ports/RoomGenerator'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { RoomObject } from '../domain/roomSpec'
import { fallbackRoom } from '../domain/examples/fallbackRoom'
import type { AssembleRoomOptions } from '../domain/assembleRoom'
import { shouldShowFallbackNotice } from '../app/fallbackNotice'
import type { Logger, LogContext, LogLevel } from '../platform/logger/Logger'

/* ---------- test doubles ---------- */

type Entry = { level: LogLevel; message: string; context: LogContext }

function nonExitObjects(room: LoadedRoom): RoomObject[] {
  return room.objects.filter((object) => {
    const interaction = 'interaction' in object ? object.interaction : undefined
    return interaction?.exit == null
  })
}

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

const newSource = (
  gen: RoomGenerator,
  prompt: string,
  logger: Logger,
  options: AssembleRoomOptions = {},
) => new GeneratedRoomSource(gen, prompt, logger, FALLBACK, options)

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
const SPEC_WITH_BAD_TRANSFORMS = JSON.stringify({
  ...base,
  objects: [
    { type: 'book', position: [1, 0, 1], rotationY: 'SECRET-ROTATION', scale: 'SECRET-SCALE' },
  ],
})
const BAD_ENVELOPE = JSON.stringify({ schemaVersion: 1, id: 'x' }) // missing name/shell/spawn/objects
const MALFORMED_JSON = '{ not valid json'

// Schema-valid with spawn far outside bounds. After Slice 4, repairGeneratedSpawn
// (Stage 2.7) clamps the spawn before the semantic validator runs → provenance
// 'generated', not 'repaired' (benign normalization, not a real repair).
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
      expect(nonExitObjects(result.room)).toHaveLength(1)
    }
  })

  it('passes requestsNpc boolean into assembleRoom when configured', async () => {
    const { logger, entries } = createSpyLogger()
    const result = await newSource(
      generatorReturning(VALID_SPEC),
      'seed without npc words',
      logger,
      { requestsNpc: true },
    ).getRoom()

    expect(result.ok).toBe(true)
    if (result.ok) {
      const npc = result.room.objects.find((object) => object.type === 'npc')
      expect(npc?.type).toBe('npc')
      expect(npc && 'interaction' in npc ? npc.interaction.dialogue : undefined).toBeDefined()
    }
    expect(entries[0]!.context.npcInserted).toBe(true)
  })

  it('defaults requestsNpc to false and does not insert an NPC', async () => {
    const { logger, entries } = createSpyLogger()
    const result = await newSource(generatorReturning(VALID_SPEC), 'someone to talk to', logger).getRoom()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.room.objects.some((object) => object.type === 'npc')).toBe(false)
    }
    expect(entries[0]!.context.npcInserted).toBe(false)
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

  it('spawn out-of-bounds is clamped at Stage 2.7 → ok:true, provenance generated (benign normalization)', async () => {
    const { logger } = createSpyLogger()
    const result = await newSource(generatorReturning(REPAIRABLE_SPEC), 'p', logger).getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provenance).toBe('generated')
      expect(result.room.id).toBe('stub-room') // the generated room, not the fallback
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
    const { logger, entries } = createSpyLogger()
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
    expect(entries).toHaveLength(1)
    expect(entries[0]!.context.purposesAssigned).toBe(0)
  })

  it('lenient bad object → ok:true generated, warnings/skipped preserved', async () => {
    const { logger } = createSpyLogger()
    const result = await newSource(generatorReturning(SPEC_WITH_BAD_OBJECT), 'p', logger).getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provenance).toBe('generated')
      expect(nonExitObjects(result.room)).toHaveLength(1)
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
    expect(typeof entry.context.composed).toBe('boolean')
    expect(typeof entry.context.lacksAnchor).toBe('boolean')
    expect(typeof entry.context.lacksInteractable).toBe('boolean')
    expect(entry.context.objectCount).toBe(2)
    expect(entry.context.skippedObjectCount).toBe(0)
    expect(typeof entry.context.warningCount).toBe('number')
    expect(typeof entry.context.aliasesRepaired).toBe('number')
    expect(typeof entry.context.objectTransformsRepaired).toBe('number')
    expect(typeof entry.context.purposesAssigned).toBe('number')
    expect(typeof entry.context.exitNavigationEnsured).toBe('boolean')
    expect(typeof entry.context.npcInserted).toBe('boolean')
    expect(typeof entry.context.displayTextSanitized).toBe('boolean')
    expect(typeof entry.context.displayTextSanitizationCount).toBe('number')
    expect(typeof entry.context.skippedObjectReasonCounts).toBe('object')
    expect(typeof entry.context.mechanicalGateAvailable).toBe('boolean')
  })

  it('logs mechanical gate availability as a boolean without leaking derived gate details', async () => {
    const GATED_SPEC = JSON.stringify({
      ...base,
      id: 'secret-generated-room',
      objects: [
        {
          type: 'book',
          id: 'secret-book-id',
          name: 'Secret Book Name',
          position: [0, 0, -2],
        },
        {
          type: 'machine',
          id: 'normal-control-id',
          position: [2, 0, -2],
          interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
        },
      ],
    })
    const { logger, entries } = createSpyLogger()

    await newSource(generatorReturning(GATED_SPEC), 'p', logger, {
      enrichObjectiveTarget: true,
      deriveMechanicalGateDiagnostic: true,
    }).getRoom()

    expect(entries).toHaveLength(1)
    expect(entries[0]!.context.mechanicalGateAvailable).toBe(true)
    const dump = JSON.stringify(entries)
    expect(dump).not.toContain('secret-generated-room')
    expect(dump).not.toContain('secret-book-id')
    expect(dump).not.toContain('interaction:secret-book-id')
    expect(dump).not.toContain('mechanical-gate')
    expect(dump).not.toContain('locked-exit')
    expect(dump).not.toContain('unlock-exit')
    expect(dump).not.toContain('adjacent:')
    expect(dump).not.toContain('Secret Book Name')
  })

  it('logs false for an intercepted meaningful document without leaking gate details', async () => {
    const MEANINGFUL_SPEC = JSON.stringify({
      ...base,
      id: 'secret-meaningful-room',
      objects: [{
        type: 'book',
        id: 'secret-document-id',
        name: 'Secret Document Name',
        position: [0, 0, -2],
      }],
    })
    const { logger, entries } = createSpyLogger()

    await newSource(generatorReturning(MEANINGFUL_SPEC), 'p', logger, {
      enrichObjectiveTarget: true,
      deriveMechanicalGateDiagnostic: true,
    }).getRoom()

    expect(entries).toHaveLength(1)
    expect(entries[0]!.context.mechanicalGateAvailable).toBe(false)
    const dump = JSON.stringify(entries)
    expect(dump).not.toContain('secret-meaningful-room')
    expect(dump).not.toContain('secret-document-id')
    expect(dump).not.toContain('Secret Document Name')
    expect(dump).not.toContain('mechanical-gate')
    expect(dump).not.toContain('interaction:secret-document-id')
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
      await newSource(gen, prompt, logger, { themePack: 'post-apoc' }).getRoom()
      expect(entries.length).toBeGreaterThan(0) // every path logs at least once
      const dump = JSON.stringify(entries)
      expect(dump).not.toContain(prompt)
      expect(dump).not.toContain('post-apoc')
      expect(dump).not.toContain('SECRET-NPC-NAME-9000')
      expect(dump).not.toContain('SECRET-PROMPT-LABEL')
      expect(dump).not.toContain('SECRET-STORY-BODY-TEXT')
      expect(dump).not.toContain('SECRET-RAW-CONTENT-7777')
    }
  })

  it('logs display sanitization diagnostics without leaking before or after display text', async () => {
    const token = 'adjacent:gen-1234abcd:exit:north'
    const CONTAMINATED_DISPLAY_SPEC = JSON.stringify({
      ...base,
      id: token,
      name: `Generated room - ${token}`,
      objects: [
        {
          type: 'arch',
          id: token,
          position: [0, 0, -9],
          interaction: {
            key: 'E',
            prompt: `Enter ${token}`,
            exit: { toRoomId: token },
          },
        },
        {
          type: 'scroll',
          id: 'scroll-with-display-text',
          position: [3, 0, -2],
          interaction: {
            key: 'E',
            prompt: 'Read',
            title: `Title ${token}`,
            body: `The scroll reads: "${token}"`,
          },
        },
      ],
    })
    const { logger, entries } = createSpyLogger()

    await newSource(generatorReturning(CONTAMINATED_DISPLAY_SPEC), 'p', logger).getRoom()

    expect(entries).toHaveLength(1)
    expect(entries[0]!.context.displayTextSanitized).toBe(true)
    expect(typeof entries[0]!.context.displayTextSanitizationCount).toBe('number')
    expect(entries[0]!.context.displayTextSanitizationCount).toBeGreaterThan(0)

    const dump = JSON.stringify(entries)
    expect(dump).not.toContain(token)
    expect(dump).not.toContain('Generated room')
    expect(dump).not.toContain('a nearby room')
    expect(dump).not.toContain('The scroll reads')
    expect(dump).not.toContain('Title')
    expect(dump).not.toContain('Enter')
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

  it('logs aliasesRepaired count (integer, not alias strings) when aliases are rewritten', async () => {
    const WITH_ALIASES = JSON.stringify({
      ...base,
      objects: [
        { type: 'desk', position: [2, 0, 2] },     // → table
        { type: 'skeleton', position: [-2, 0, -2] }, // → corpse
      ],
    })
    const { logger, entries } = createSpyLogger()
    await newSource(generatorReturning(WITH_ALIASES), 'p', logger).getRoom()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.context.aliasesRepaired).toBe(2)
    // Raw alias strings must never appear in any log entry
    const dump = JSON.stringify(entries)
    expect(dump).not.toContain('"desk"')
    expect(dump).not.toContain('"skeleton"')
  })

  it('logs objectTransformsRepaired count only and does not log raw transform values', async () => {
    const { logger, entries } = createSpyLogger()
    const result = await newSource(generatorReturning(SPEC_WITH_BAD_TRANSFORMS), 'p', logger).getRoom()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.provenance).toBe('generated')
      expect(nonExitObjects(result.room)).toHaveLength(1)
      expect(result.room.skipped).toHaveLength(0)
    }
    expect(entries).toHaveLength(1)
    expect(entries[0]!.context.objectTransformsRepaired).toBe(1)
    const dump = JSON.stringify(entries)
    expect(dump).not.toContain('SECRET-ROTATION')
    expect(dump).not.toContain('SECRET-SCALE')
  })

  it('logs skippedObjectReasonCounts as integer counts with no raw type strings', async () => {
    // Three objects: one unknown type ("chair"), one missing scroll interaction,
    // one valid pillar. Expect 2 skipped, counts logged as integers only.
    const WITH_SKIPS = JSON.stringify({
      ...base,
      objects: [
        { type: 'chair', position: [1, 0, 1] },             // unknownType
        { type: 'scroll', position: [2, 0, 2] },             // invalidInteraction (missing)
        { type: 'pillar', position: [3, 0, 3] },             // valid
      ],
    })
    const { logger, entries } = createSpyLogger()
    await newSource(generatorReturning(WITH_SKIPS), 'p', logger).getRoom()
    expect(entries).toHaveLength(1)
    const counts = entries[0]!.context.skippedObjectReasonCounts
    expect(typeof counts).toBe('object')
    for (const val of Object.values(counts as Record<string, unknown>)) {
      expect(typeof val).toBe('number')
    }
    // Raw object type strings must never appear in log context (only bucket names + integers)
    const dump = JSON.stringify(entries)
    expect(dump).not.toContain('"chair"')
  })

  it('aliasesRepaired is 0 on fallback paths', async () => {
    for (const spec of [MALFORMED_JSON, BAD_ENVELOPE, UNREPAIRABLE_SPEC]) {
      const { logger, entries } = createSpyLogger()
      await newSource(generatorReturning(spec), 'p', logger).getRoom()
      const entry = entries.find((e) => e.context.provenance === 'fallback')
      expect(entry).toBeDefined()
      expect(entry!.context.aliasesRepaired).toBe(0)
      expect(entry!.context.objectTransformsRepaired).toBe(0)
      expect(entry!.context.purposesAssigned).toBe(0)
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
