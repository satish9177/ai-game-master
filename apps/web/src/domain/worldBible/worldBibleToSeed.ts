import type { WorldBibleSeed } from './worldBibleSeed'

const MAX_GENERATOR_SEED_LENGTH = 160

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
