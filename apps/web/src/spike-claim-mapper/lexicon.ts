import type { Strength } from './strength'
import { minStrength } from './strength'

/**
 * The deterministic hedge/booster lexicon. This module -- never the LLM --
 * produces a claim's ASSERTED strength (spike brief section 7). It grades
 * only the verbatim quote the trusted validator has already checked; it
 * never sees the packet, the entitlement table, or the model's reasoning.
 *
 * ## Grading rules (precedence, in order)
 *
 * 1. Phrases are matched case-insensitively, LONGEST PHRASE FIRST, on word
 *    boundaries, and each matched span is CONSUMED. This is what makes
 *    "not confirmed" a cap rather than a 'confirmed' boost, and keeps the
 *    'certain' boost from firing inside "uncertain"/"ascertain".
 * 2. Positive-commitment markers (boost/hedge/rumour classes) each carry a
 *    level. If any are present, the BASE strength is the MINIMUM level
 *    among them -- the most hedged positive commitment wins. So
 *    "I heard it's confirmed clear" grades 'rumoured': relaying a rumour of
 *    a confirmation is not a confirmation.
 * 3. If NO positive marker is present, the base is the PLAIN-ASSERTION
 *    default: 'probable'. Calibration decision, documented: an operator
 *    stating something as bare fact commits above 'possible' but has not
 *    used a confirmation protocol word, so bare assertions never license
 *    'confirmed' language and yet are stronger than explicit hedges. (The
 *    strict alternative -- plain -> 'confirmed' -- is a one-constant
 *    change; the spike measures the lexicon as specified here.)
 * 4. Cap markers only ever LOWER the result: the final asserted strength is
 *    min(base, all caps). 'not confirmed'-style status caps limit to
 *    'probable'; 'cannot confirm'-style speaker disclaimers and explicit
 *    uncertainty limit to 'possible'.
 *
 * Worked example (the brief's): "They probably left, but it is not
 * confirmed." -> positive marker 'probably' (probable); cap 'not confirmed'
 * (probable); min(probable, probable) = 'probable'. The claim asserts
 * departure at probable and explicitly disclaims confirmed -- which the
 * grade preserves.
 *
 * Out of scope, measured rather than handled: free negation of hedges
 * ("not likely"), sarcasm, scope of negation across clauses. Polarity is
 * NOT this module's job -- the extractor proposes polarity and the gold
 * labels judge it.
 */

export const LEXICON_VERSION = 'hedge-lexicon-v0' as const

export type MarkerClass =
  | 'boost-confirmed'
  | 'hedge-probable'
  | 'hedge-possible'
  | 'rumour-mark'
  | 'cap-not-confirmed'
  | 'cap-disclaim'
  | 'cap-uncertain'

interface LexiconEntry {
  phrase: string
  markerClass: MarkerClass
}

const POSITIVE_LEVEL: Partial<Record<MarkerClass, Strength>> = {
  'boost-confirmed': 'confirmed',
  'hedge-probable': 'probable',
  'hedge-possible': 'possible',
  'rumour-mark': 'rumoured',
}

const CAP_LEVEL: Partial<Record<MarkerClass, Strength>> = {
  'cap-not-confirmed': 'probable',
  'cap-disclaim': 'possible',
  'cap-uncertain': 'possible',
}

export const PLAIN_ASSERTION_DEFAULT: Strength = 'probable'

export const LEXICON: readonly LexiconEntry[] = [
  // Caps first in source order for readability; matching is length-sorted anyway.
  { phrase: 'not been confirmed', markerClass: 'cap-not-confirmed' },
  { phrase: 'yet to be confirmed', markerClass: 'cap-not-confirmed' },
  { phrase: 'awaiting confirmation', markerClass: 'cap-not-confirmed' },
  { phrase: 'no confirmation', markerClass: 'cap-not-confirmed' },
  { phrase: 'not confirmed', markerClass: 'cap-not-confirmed' },
  { phrase: 'unconfirmed', markerClass: 'cap-not-confirmed' },
  { phrase: 'not verified', markerClass: 'cap-not-confirmed' },
  { phrase: 'unverified', markerClass: 'cap-not-confirmed' },

  { phrase: 'cannot confirm', markerClass: 'cap-disclaim' },
  { phrase: "can't confirm", markerClass: 'cap-disclaim' },
  { phrase: 'unable to confirm', markerClass: 'cap-disclaim' },
  { phrase: 'not able to confirm', markerClass: 'cap-disclaim' },
  { phrase: 'no way to confirm', markerClass: 'cap-disclaim' },
  { phrase: 'cannot verify', markerClass: 'cap-disclaim' },
  { phrase: "can't verify", markerClass: 'cap-disclaim' },

  { phrase: 'uncertain', markerClass: 'cap-uncertain' },
  { phrase: 'unsure', markerClass: 'cap-uncertain' },
  { phrase: 'not sure', markerClass: 'cap-uncertain' },
  { phrase: 'unclear', markerClass: 'cap-uncertain' },
  { phrase: 'not clear whether', markerClass: 'cap-uncertain' },
  { phrase: 'hard to say', markerClass: 'cap-uncertain' },
  { phrase: "don't know", markerClass: 'cap-uncertain' },
  { phrase: 'do not know', markerClass: 'cap-uncertain' },
  { phrase: 'no idea', markerClass: 'cap-uncertain' },

  { phrase: 'confirmed', markerClass: 'boost-confirmed' },
  { phrase: 'verified', markerClass: 'boost-confirmed' },
  { phrase: 'definitely', markerClass: 'boost-confirmed' },
  { phrase: 'certainly', markerClass: 'boost-confirmed' },
  { phrase: 'certain', markerClass: 'boost-confirmed' },
  { phrase: 'without a doubt', markerClass: 'boost-confirmed' },
  { phrase: 'beyond doubt', markerClass: 'boost-confirmed' },
  { phrase: 'guaranteed', markerClass: 'boost-confirmed' },
  { phrase: 'for sure', markerClass: 'boost-confirmed' },
  { phrase: '100 percent', markerClass: 'boost-confirmed' },
  { phrase: '100%', markerClass: 'boost-confirmed' },
  { phrase: 'positive', markerClass: 'boost-confirmed' },

  { phrase: 'almost certainly', markerClass: 'hedge-probable' },
  { phrase: 'in all likelihood', markerClass: 'hedge-probable' },
  { phrase: 'most likely', markerClass: 'hedge-probable' },
  { phrase: 'probably', markerClass: 'hedge-probable' },
  { phrase: 'likely', markerClass: 'hedge-probable' },

  { phrase: 'possibly', markerClass: 'hedge-possible' },
  { phrase: 'might', markerClass: 'hedge-possible' },
  { phrase: 'may have', markerClass: 'hedge-possible' },
  { phrase: 'may be', markerClass: 'hedge-possible' },
  { phrase: 'could have', markerClass: 'hedge-possible' },
  { phrase: 'could be', markerClass: 'hedge-possible' },
  { phrase: 'appears to', markerClass: 'hedge-possible' },
  { phrase: 'appears', markerClass: 'hedge-possible' },
  { phrase: 'looks like', markerClass: 'hedge-possible' },
  { phrase: 'seems', markerClass: 'hedge-possible' },
  { phrase: 'seemingly', markerClass: 'hedge-possible' },
  { phrase: 'perhaps', markerClass: 'hedge-possible' },
  { phrase: 'potentially', markerClass: 'hedge-possible' },
  { phrase: 'suggests', markerClass: 'hedge-possible' },

  { phrase: 'reportedly', markerClass: 'rumour-mark' },
  { phrase: 'rumoured', markerClass: 'rumour-mark' },
  { phrase: 'rumored', markerClass: 'rumour-mark' },
  { phrase: 'rumour', markerClass: 'rumour-mark' },
  { phrase: 'rumor', markerClass: 'rumour-mark' },
  { phrase: 'hearsay', markerClass: 'rumour-mark' },
  { phrase: 'heard', markerClass: 'rumour-mark' },
  { phrase: 'word is', markerClass: 'rumour-mark' },
  { phrase: 'someone said', markerClass: 'rumour-mark' },
  { phrase: 'they say', markerClass: 'rumour-mark' },
  { phrase: 'according to', markerClass: 'rumour-mark' },
  { phrase: 'secondhand', markerClass: 'rumour-mark' },
  { phrase: 'neighbour said', markerClass: 'rumour-mark' },
  { phrase: 'neighbor said', markerClass: 'rumour-mark' },
  { phrase: 'told us', markerClass: 'rumour-mark' },
  { phrase: 'told me', markerClass: 'rumour-mark' },
]

export interface MarkerMatch {
  phrase: string
  markerClass: MarkerClass
  index: number
}

export interface StrengthGrade {
  strength: Strength
  markers: readonly MarkerMatch[]
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[a-z0-9]/i.test(char)
}

/** Longest-first, word-bounded, consuming matcher over the lowercased quote. */
export function findMarkers(quote: string): MarkerMatch[] {
  const lower = quote.toLowerCase()
  const consumed = new Array<boolean>(lower.length).fill(false)
  const byLengthDesc = [...LEXICON].sort(
    (a, b) => b.phrase.length - a.phrase.length || a.phrase.localeCompare(b.phrase),
  )
  const matches: MarkerMatch[] = []

  for (const entry of byLengthDesc) {
    const phrase = entry.phrase.toLowerCase()
    let searchFrom = 0
    for (;;) {
      const index = lower.indexOf(phrase, searchFrom)
      if (index === -1) break
      searchFrom = index + 1

      // Word boundaries: the phrase must not extend a surrounding word.
      // '%' is allowed as a phrase edge (for '100%').
      const before = lower[index - 1]
      const after = lower[index + phrase.length]
      const startsWithWord = isWordChar(phrase[0])
      const endsWithWord = isWordChar(phrase[phrase.length - 1])
      if ((startsWithWord && isWordChar(before)) || (endsWithWord && isWordChar(after))) continue

      // Consumption: no character may belong to two markers.
      let overlaps = false
      for (let i = index; i < index + phrase.length; i += 1) {
        if (consumed[i] === true) {
          overlaps = true
          break
        }
      }
      if (overlaps) continue

      for (let i = index; i < index + phrase.length; i += 1) {
        consumed[i] = true
      }
      matches.push({ phrase: entry.phrase, markerClass: entry.markerClass, index })
    }
  }

  return matches.sort((a, b) => a.index - b.index)
}

/** The deterministic strength grader. Pure and total over any string. */
export function gradeAssertedStrength(quote: string): StrengthGrade {
  const markers = findMarkers(quote)

  let base: Strength | undefined
  for (const marker of markers) {
    const level = POSITIVE_LEVEL[marker.markerClass]
    if (level !== undefined) {
      base = base === undefined ? level : minStrength(base, level)
    }
  }
  let strength: Strength = base ?? PLAIN_ASSERTION_DEFAULT

  for (const marker of markers) {
    const cap = CAP_LEVEL[marker.markerClass]
    if (cap !== undefined) {
      strength = minStrength(strength, cap)
    }
  }

  return { strength, markers }
}
