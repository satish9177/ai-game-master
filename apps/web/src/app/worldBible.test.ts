import { describe, expect, it } from 'vitest'
import type { WorldBibleSeeder } from '../domain/ports/WorldBibleSeeder'
import type { WorldBibleSeed } from '../domain/worldBible/worldBibleSeed'
import { worldBibleToGeneratorSeed } from '../domain/worldBible/worldBibleToSeed'
import type { LogContext, Logger, LogLevel } from '../platform/logger/Logger'
import { prepareGeneratedRoomSeed } from './worldBible'

const SECRET_PROMPT = 'SECRET RAW PROMPT'
const SECRET_ERROR = 'SECRET SEEDER FAILURE DETAIL'

const bible: WorldBibleSeed = {
  schemaVersion: 1,
  title: 'SECRET WORLD TITLE',
  themePack: 'fantasy-keep',
  tone: 'mysterious',
  premise: 'SECRET PREMISE',
  startingLocation: 'SECRET LOCATION',
  majorConflict: 'SECRET CONFLICT',
  factions: ['SECRET FACTION'],
  npcs: [
    { name: 'SECRET NPC ONE', role: 'Warden', disposition: 'ally' },
    { name: 'SECRET NPC TWO', role: 'Archivist', disposition: 'neutral' },
  ],
  locations: [
    { label: 'SECRET PLACE ONE', kind: 'gatehouse' },
    { label: 'SECRET PLACE TWO', kind: 'vault' },
  ],
  generationHints: {
    allowedThemePack: 'fantasy-keep',
    keywords: ['secret-keyword'],
  },
  canonNotes: ['SECRET CANON NOTE'],
  openingArc: {
    pattern: 'investigate',
    hook: 'SECRET ARC HOOK',
    firstObjective: 'SECRET ARC OBJECTIVE',
    pressure: 'SECRET ARC PRESSURE',
  },
}

type Entry = { level: LogLevel; message: string; context: LogContext }

function createCapturingLogger(): { logger: Logger; entries: Entry[] } {
  const entries: Entry[] = []
  const logger: Logger = {
    debug: (message, context = {}) => entries.push({ level: 'debug', message, context }),
    info: (message, context = {}) => entries.push({ level: 'info', message, context }),
    warn: (message, context = {}) => entries.push({ level: 'warn', message, context }),
    error: (message, context = {}) => entries.push({ level: 'error', message, context }),
    child: () => logger,
  }
  return { logger, entries }
}

describe('prepareGeneratedRoomSeed', () => {
  it('projects a seeded bible instead of passing the raw prompt through', async () => {
    const receivedPrompts: string[] = []
    const seeder: WorldBibleSeeder = {
      seed: async (prompt) => {
        receivedPrompts.push(prompt)
        return bible
      },
    }
    const { logger } = createCapturingLogger()

    const result = await prepareGeneratedRoomSeed(SECRET_PROMPT, seeder, logger)

    expect(receivedPrompts).toEqual([SECRET_PROMPT])
    expect(result).toEqual({
      generatorSeed: worldBibleToGeneratorSeed(bible),
      worldBible: bible,
    })
    expect(result.generatorSeed).not.toBe(SECRET_PROMPT)
  })

  it('logs only approved enums, counts, and derived length on success', async () => {
    const seeder: WorldBibleSeeder = { seed: async () => bible }
    const { logger, entries } = createCapturingLogger()

    await prepareGeneratedRoomSeed(SECRET_PROMPT, seeder, logger)

    expect(entries).toEqual([{
      level: 'info',
      message: 'world bible seeded',
      context: {
        themePack: 'fantasy-keep',
        tone: 'mysterious',
        npcCount: 2,
        locationCount: 2,
        factionCount: 1,
        keywordCount: 1,
        seedLength: worldBibleToGeneratorSeed(bible).length,
      },
    }])
    const logDump = JSON.stringify(entries)
    for (const secret of [
      SECRET_PROMPT,
      worldBibleToGeneratorSeed(bible),
      bible.title,
      bible.premise,
      bible.majorConflict,
      bible.openingArc.hook,
      bible.openingArc.firstObjective,
      bible.openingArc.pressure,
      bible.npcs[0]!.name,
      bible.factions[0]!,
      bible.locations[0]!.label,
      bible.generationHints.keywords[0]!,
    ]) {
      expect(logDump).not.toContain(secret)
    }
  })

  it('degrades to the raw prompt and safe warning when seeding fails', async () => {
    const seeder: WorldBibleSeeder = {
      seed: async () => {
        throw new Error(SECRET_ERROR)
      },
    }
    const { logger, entries } = createCapturingLogger()

    const result = await prepareGeneratedRoomSeed(SECRET_PROMPT, seeder, logger)

    expect(result).toEqual({ generatorSeed: SECRET_PROMPT })
    expect('worldBible' in result).toBe(false)
    expect(entries).toEqual([{
      level: 'warn',
      message: 'world bible unavailable',
      context: { code: 'world-bible-unavailable' },
    }])
    const logDump = JSON.stringify(entries)
    expect(logDump).not.toContain(SECRET_PROMPT)
    expect(logDump).not.toContain(SECRET_ERROR)
  })
})
