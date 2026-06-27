import type { WorldBibleSeed } from './worldBibleSeed'

const MAX_GENERATOR_SEED_LENGTH = 160
export const MAX_ADJACENT_THEME_SEED_LENGTH = 120

export function worldBibleToGeneratorSeed(bible: WorldBibleSeed): string {
  return [
    bible.title,
    bible.themePack,
    bible.tone,
    `${bible.openingArc.pattern}:${bible.openingArc.firstObjective}`,
    bible.premise,
    bible.generationHints.keywords.join(','),
  ]
    .join(' | ')
    .slice(0, MAX_GENERATOR_SEED_LENGTH)
}

export function worldBibleToAdjacentThemeSeed(bible: WorldBibleSeed): string {
  const keywords = bible.generationHints.keywords.join(', ')

  return [bible.themePack, bible.tone, keywords]
    .filter((part) => part.length > 0)
    .join(' | ')
    .slice(0, MAX_ADJACENT_THEME_SEED_LENGTH)
}
