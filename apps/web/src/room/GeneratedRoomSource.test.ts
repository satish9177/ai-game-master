import { describe, it, expect } from 'vitest'
import { GeneratedRoomSource } from './GeneratedRoomSource'
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
})
