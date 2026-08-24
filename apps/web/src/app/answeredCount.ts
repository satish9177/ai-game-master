import type { ReadableRecord } from '../domain/livingWorldProof/evidenceRecords'
import { deriveEntitlement, mentionsAnyName, splitTranscriptSentences } from './leakageCount'

/**
 * The second deterministic counter for the Belief-Driven NPC Dialogue Slice
 * (binding carry-forward: "zero leaks by silence is a failure, not a
 * result"). `leakageCount` alone cannot distinguish an arm that scores zero
 * because the NPC says nothing useful from one that scores zero while still
 * talking. This instrument makes silence visible.
 *
 * Per scripted player question it asks, mechanically: does the measured
 * dialogue surface assert anything this holder IS entitled to assert? An
 * assertion is detected as a sentence mentioning at least one closed-world
 * entity the holder may name, or one sound signature the holder actually
 * heard — entitlement derived from the spine record universe by exactly the
 * machinery `deriveEntitlement` uses for leakage. No model call, no scoring,
 * no human judgment; same inputs always yield the same answer.
 *
 * The surface is caller-chosen so one function serves both measurement
 * stages without modification:
 * - S2 gate (pre-model): the composed prompt's background sections (room
 *   memory + belief), with the echoed player question excluded — what the
 *   NPC is given to speak FROM.
 * - S5 (live arms): the model's reply text — what the NPC actually said.
 *
 * `answeredCount` sums satisfied questions; per-question booleans are
 * available via {@link assertsEntitledContent} so a 0 is attributable.
 */

/** True when `text` carries at least one entitled assertion for `holder`. */
export function assertsEntitledContent(
  text: string,
  holder: string,
  universe: readonly ReadableRecord[],
): boolean {
  const entitlement = deriveEntitlement(holder, universe)
  const entitledNames = [...entitlement.allowedEntities]
  const heardSounds = [...entitlement.heardSounds]
  return splitTranscriptSentences(text).some(
    (sentence) => mentionsAnyName(sentence, entitledNames) || mentionsAnyName(sentence, heardSounds),
  )
}

export interface AnsweredStep {
  readonly index: number
  readonly answered: boolean
}

/**
 * Counts how many of the scripted questions were matched with an entitled
 * assertion on their corresponding surface. Inputs are paired positionally;
 * inputs are never mutated.
 */
export function answeredCount(
  surfaces: readonly { index: number; text: string }[],
  holderForIndex: Readonly<Record<number, string>> | ((index: number) => string),
  universe: readonly ReadableRecord[],
): number {
  const holderOf = typeof holderForIndex === 'function' ? holderForIndex : (index: number) => holderForIndex[index]!
  return surfaces.filter((surface) => assertsEntitledContent(surface.text, holderOf(surface.index), universe)).length
}

/**
 * Extracts the body lines under exact section headers from a composed
 * prompt, preserving order and excluding the headers themselves. Mechanical:
 * closed-vocabulary header matching only, so the S2 counter measures exactly
 * the background context and never the structural scaffolding or the echoed
 * player line.
 */
export function extractSectionBodies(promptText: string, headers: readonly string[]): string {
  const lines = promptText.split(/\r?\n/)
  const kept: string[] = []
  let collecting = false
  for (const line of lines) {
    if (headers.includes(line.trim())) {
      collecting = true
      continue
    }
    // A blank line ends any section; prompt sections are separated by them.
    if (collecting && line.trim() === '') collecting = false
    if (collecting) kept.push(line)
  }
  return kept.join('\n')
}
