import type { WorldBibleSeeder } from '../domain/ports/WorldBibleSeeder'
import type { WorldBibleSeed } from '../domain/worldBible/worldBibleSeed'
import { worldBibleToGeneratorSeed } from '../domain/worldBible/worldBibleToSeed'
import type { Logger } from '../platform/logger/Logger'

type GeneratedRoomSeed = {
  generatorSeed: string
  worldBible?: WorldBibleSeed
}

/**
 * Build the prompt-path generator input. World-bible failures are deliberately
 * non-blocking: callers receive the original prompt and no initial canon.
 */
export async function prepareGeneratedRoomSeed(
  prompt: string,
  seeder: WorldBibleSeeder,
  logger: Logger,
): Promise<GeneratedRoomSeed> {
  try {
    const worldBible = await seeder.seed(prompt)
    const generatorSeed = worldBibleToGeneratorSeed(worldBible)
    logger.info('world bible seeded', {
      themePack: worldBible.themePack,
      tone: worldBible.tone,
      npcCount: worldBible.npcs.length,
      locationCount: worldBible.locations.length,
      factionCount: worldBible.factions.length,
      keywordCount: worldBible.generationHints.keywords.length,
      seedLength: generatorSeed.length,
    })
    return { generatorSeed, worldBible }
  } catch {
    logger.warn('world bible unavailable', { code: 'world-bible-unavailable' })
    return { generatorSeed: prompt }
  }
}
