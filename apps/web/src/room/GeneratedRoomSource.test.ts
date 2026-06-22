import { describe, it, expect } from 'vitest'
import { GeneratedRoomSource } from './GeneratedRoomSource'
import { FakeRoomGenerator } from '../generation/FakeRoomGenerator'
import type { RoomGenerator } from '../domain/ports/RoomGenerator'
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
// controlled. They ignore the prompt; the source's job is parse + validate + map.
const generatorReturning = (text: string): RoomGenerator => ({
  generate: () => Promise.resolve(text),
})
const generatorRejecting = (err: unknown): RoomGenerator => ({
  generate: () => Promise.reject(err),
})

const base = {
  schemaVersion: 1,
  id: 'stub-room',
  name: 'Stub Room',
  shell: { dimensions: { width: 10, depth: 12, height: 4 } },
  spawn: { position: [0, 1.7, 4] },
}
const VALID_SPEC = JSON.stringify({ ...base, objects: [{ type: 'pillar', position: [0, 0, 0] }] })
const SPEC_WITH_BAD_OBJECT = JSON.stringify({
  ...base,
  objects: [
    { type: 'pillar', position: [0, 0, 0] }, // valid
    { type: 'pillar', position: 'not-a-vec' }, // invalid → skipped leniently
  ],
})
const BAD_ENVELOPE = JSON.stringify({ schemaVersion: 1, id: 'x' }) // missing name/shell/spawn/objects
const MALFORMED_JSON = '{ not valid json'

// Schema-valid (loadRoomSpec succeeds) but NOT playable: a 2×2 m room is below
// the minimum walkable size → a fatal `room-too-small` semantic issue. Exits are
// declared so the only fatal/warning in play is the one under test.
const SEMANTIC_FATAL_SPEC = JSON.stringify({
  schemaVersion: 1,
  id: 'tiny-room',
  name: 'Tiny Room',
  shell: { dimensions: { width: 2, depth: 2, height: 4 }, exits: [{ side: 'north', width: 3 }] },
  spawn: { position: [0, 1.7, 0] },
  objects: [],
})
// Schema-valid AND playable, but with a single semantic *warning*: a pillar
// anchored far outside the footprint → `object-out-of-bounds` (warning, not fatal).
const SEMANTIC_WARNING_SPEC = JSON.stringify({
  schemaVersion: 1,
  id: 'warn-room',
  name: 'Warn Room',
  shell: { dimensions: { width: 10, depth: 12, height: 4 }, exits: [{ side: 'north', width: 3 }] },
  spawn: { position: [0, 1.7, 4] },
  objects: [{ type: 'pillar', position: [100, 0, 0] }],
})

/* ---------- tests ---------- */

describe('GeneratedRoomSource', () => {
  it('valid JSON spec → ok:true with the loaded room', async () => {
    const { logger } = createSpyLogger()
    const src = new GeneratedRoomSource(generatorReturning(VALID_SPEC), 'a calm room', logger)
    const result = await src.getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.room.id).toBe('stub-room')
      expect(result.room.objects).toHaveLength(1)
      expect(result.room.skipped).toEqual([])
      expect(result.room.warnings).toEqual([])
    }
  })

  it('malformed JSON → ok:false, code invalid-room', async () => {
    const { logger } = createSpyLogger()
    const src = new GeneratedRoomSource(generatorReturning(MALFORMED_JSON), 'p', logger)
    const result = await src.getRoom()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-room')
      expect(result.error.message).toBe('This room could not be loaded.')
    }
  })

  it('schema-invalid envelope → ok:false, code invalid-room', async () => {
    const { logger } = createSpyLogger()
    const src = new GeneratedRoomSource(generatorReturning(BAD_ENVELOPE), 'p', logger)
    const result = await src.getRoom()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-room')
  })

  it('generator rejects → ok:false, code unavailable', async () => {
    const { logger } = createSpyLogger()
    const src = new GeneratedRoomSource(generatorRejecting(new Error('network down')), 'p', logger)
    const result = await src.getRoom()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('unavailable')
      expect(result.error.message).toBe('Could not generate a room. Please try again.')
    }
  })

  it('lenient bad object → ok:true with warnings/skipped preserved', async () => {
    const { logger } = createSpyLogger()
    const src = new GeneratedRoomSource(generatorReturning(SPEC_WITH_BAD_OBJECT), 'p', logger)
    const result = await src.getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.room.objects).toHaveLength(1)
      expect(result.room.skipped).toHaveLength(1)
      expect(result.room.warnings).toHaveLength(1)
    }
  })

  it('logs safe metadata (promptLength + counts) at info on success', async () => {
    const { logger, entries } = createSpyLogger()
    const prompt = 'a haunted hall'
    const src = new GeneratedRoomSource(generatorReturning(VALID_SPEC), prompt, logger)
    await src.getRoom()
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.level).toBe('info')
    expect(entry.context.promptLength).toBe(prompt.length)
    expect(entry.context.objectCount).toBe(1)
    expect(entry.context.skippedCount).toBe(0)
    expect(entry.context.warningCount).toBe(0)
    // VALID_SPEC declares no exits, so the validator raises one `no-exit` warning;
    // the room is still playable and the count rides the success info line.
    expect(entry.context.semanticWarningCount).toBe(1)
  })

  it('logs a failure code without throwing, and only once per call', async () => {
    const { logger, entries } = createSpyLogger()
    const src = new GeneratedRoomSource(generatorReturning(MALFORMED_JSON), 'p', logger)
    await src.getRoom()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.level).toBe('error')
    expect(entries[0]!.context.code).toBe('invalid-room')
  })

  it('never logs the full prompt text on any path', async () => {
    const prompt = 'TOP-SECRET-PROMPT-do-not-leak-42'
    const cases = [
      generatorReturning(VALID_SPEC),
      generatorReturning(SPEC_WITH_BAD_OBJECT),
      generatorReturning(SEMANTIC_WARNING_SPEC),
      generatorReturning(SEMANTIC_FATAL_SPEC),
      generatorReturning(MALFORMED_JSON),
      generatorReturning(BAD_ENVELOPE),
      generatorRejecting(new Error('boom')),
    ]
    for (const gen of cases) {
      const { logger, entries } = createSpyLogger()
      const src = new GeneratedRoomSource(gen, prompt, logger)
      await src.getRoom()
      expect(entries.length).toBeGreaterThan(0) // every path logs at least once
      expect(JSON.stringify(entries)).not.toContain(prompt) // but never the prompt text
    }
  })

  it('schema-valid but semantically fatal room → ok:false, code invalid-room', async () => {
    const { logger } = createSpyLogger()
    const src = new GeneratedRoomSource(generatorReturning(SEMANTIC_FATAL_SPEC), 'p', logger)
    const result = await src.getRoom()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-room')
      expect(result.error.message).toBe('This room could not be loaded.') // reuses safe copy
    }
  })

  it('logs safe semantic-failure metadata once at warn (no issue text)', async () => {
    const { logger, entries } = createSpyLogger()
    const src = new GeneratedRoomSource(generatorReturning(SEMANTIC_FATAL_SPEC), 'p', logger)
    await src.getRoom()
    expect(entries).toHaveLength(1) // one line per call, preserved
    const entry = entries[0]!
    expect(entry.level).toBe('warn')
    expect(entry.context.code).toBe('invalid-room')
    expect(entry.context.fatalCount).toBe(1)
    expect(entry.context.warningCount).toBe(0)
    expect(entry.context.fatalCodes).toEqual(['room-too-small'])
  })

  it('schema-valid room with only semantic warnings → ok:true, room returned', async () => {
    const { logger, entries } = createSpyLogger()
    const src = new GeneratedRoomSource(generatorReturning(SEMANTIC_WARNING_SPEC), 'p', logger)
    const result = await src.getRoom()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.room.id).toBe('warn-room')
    // Success info line carries the semantic warning count (object-out-of-bounds).
    expect(entries).toHaveLength(1)
    expect(entries[0]!.level).toBe('info')
    expect(entries[0]!.context.semanticWarningCount).toBe(1)
  })

  it('every FakeRoomGenerator output is semantically playable (zero fatal)', async () => {
    // The fake may legitimately raise warnings (e.g. a prop near spawn), but must
    // never produce a fatal room — guards both the generator and the validator.
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
      const src = new GeneratedRoomSource(new FakeRoomGenerator(), prompt, logger)
      const result = await src.getRoom()
      expect(result.ok).toBe(true)
    }
  })
})
