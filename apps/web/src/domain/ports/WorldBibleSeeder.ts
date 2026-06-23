import type { WorldBibleSeed } from '../worldBible/worldBibleSeed'

/** Turn a user prompt into compact, validated initial canon. Never executable code. */
export interface WorldBibleSeeder {
  seed(prompt: string): Promise<WorldBibleSeed>
}
