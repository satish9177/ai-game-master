import type { ReadableRecord } from '../domain/livingWorldProof/evidenceRecords'

/**
 * The Belief-Driven NPC Dialogue Slice v0 leakage instrument (S1.3).
 *
 * Counts assertions in a transcript that fall outside a holder's
 * observation scope, per the Observation Scope Contract §2.6 anti-leakage
 * invariant and experiment §5.1. Purely mechanical: closed-vocabulary,
 * deterministic string matching against an entity lexicon and per-holder
 * entitlements BOTH DERIVED FROM THE SPINE RECORD UNIVERSE ITSELF -- there
 * is no model call, no scoring, and no human judgment anywhere in this
 * module. Same inputs always yield the same count.
 *
 * Categories (experiment plan §3 S1.3):
 * - `named-zombie` -- the sentence names the real attacker (the actor of a
 *   truth event whose action is `attacked`) that the holder is not
 *   entitled to name.
 * - `named-real-attacker` -- the sentence asserts the real attacker doing
 *   violence (attack verb co-occurring with the unentitled attacker name).
 * - `unentitled-entity` -- the sentence names any closed-world entity the
 *   holder cannot know (generalizes the two categories above; e.g. NPC_A
 *   naming `guard_malik` from a scream alone).
 * - `unseen-location-contents` -- the sentence asserts interior contents
 *   of a location the holder has no sight-channel knowledge of ("there was
 *   blood inside the cellar"). Sentences that only carry a sound the
 *   holder actually heard are exempt.
 * - `other-mind-without-transmission` -- the sentence asserts another
 *   holder's belief/knowledge/reporting when no RumorTransmission from
 *   that holder to this holder exists (depth-1 attribution through a real
 *   transmission chain stays legal).
 *
 * Categories intentionally overlap (a leaking sentence can fire several);
 * the count is the total number of findings. v0 scope notes: entities are
 * matched by whole-word, case-insensitive match of their spine ids plus a
 * digit-suffix lemma alias (`zombie_17` also matches "a zombie"); belief
 * chains are direct transmissions only.
 */

export type LeakageCategory =
  | 'named-zombie'
  | 'named-real-attacker'
  | 'unentitled-entity'
  | 'unseen-location-contents'
  | 'other-mind-without-transmission'

export interface LeakageFinding {
  category: LeakageCategory
  sentence: string
  /** The offending entity, when the finding is entity-scoped. */
  entity?: string
}

export interface HolderEntitlement {
  /** Closed-world proper nouns this holder may name (spine-derived). */
  readonly allowedEntities: ReadonlySet<string>
  /** Holders whose belief-state this holder may reference (direct transmission received). */
  readonly allowedBeliefSources: ReadonlySet<string>
  /** Locations whose interior contents this holder may assert (sight-channel only). */
  readonly sightSeenLocations: ReadonlySet<string>
  /** Sound signatures the holder actually heard (contents-rule exemption). */
  readonly heardSounds: ReadonlySet<string>
}

const ATTACK_VERBS = /\b(?:attacks?|attacked|attacking|kills?|killed|killing|slew|slays?|murders?|murdered|murdering|mauls?|mauled|mauling|slaughtered?|slaughters?)\b/i

const EXISTENCE_FRAMES = /\b(?:there\s+(?:is|was|are|were)|i\s+saw|i\s+found|i\s+checked|it\s+contains|it\s+held|full\s+of)\b/i

const MIND_VERBS = /\b(?:believes?|believed|thinks?|thought|knows?|knew|realizes?|realized|told|says?|said|claims?|claimed|heard|witnessed|saw|admits?|admitted)\b/i

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Digit-suffixed spine ids gain a natural-language lemma alias (`zombie_17` -> `zombie`). */
function aliasesOf(name: string): readonly string[] {
  const lemma = /^([a-z]+)[_-]\d+$/i.exec(name)
  if (lemma === null || lemma[1] === undefined) return [name]
  return [name, lemma[1]]
}

function compileMatchers(name: string): readonly RegExp[] {
  return aliasesOf(name).map((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i'))
}

function mentionsAny(sentence: string, matchers: readonly RegExp[]): boolean {
  return matchers.some((matcher) => matcher.test(sentence))
}

/**
 * The closed-world lexicon: every proper noun that exists anywhere in this
 * universe -- truth-event participants and locations, observation
 * perceivers and perceived actor/target/location values, and every
 * transmission party. Nothing outside this set can be named by anyone.
 */
export function entityLexicon(universe: readonly ReadableRecord[]): readonly string[] {
  const names = new Set<string>()
  for (const entry of universe) {
    switch (entry.kind) {
      case 'truth':
        names.add(entry.record.actor)
        names.add(entry.record.target)
        names.add(entry.record.location.node)
        break
      case 'observation':
        names.add(entry.record.observer)
        for (const key of ['actor', 'target', 'location'] as const) {
          const value = entry.record.perceived[key]
          if (value !== undefined) names.add(value)
        }
        break
      case 'rumor':
        names.add(entry.record.from)
        names.add(entry.record.to)
        break
      default:
        break
    }
  }
  return [...names]
}

/** The actors of committed attack events -- "the real attacker" of the scenario. */
function attackerEntities(universe: readonly ReadableRecord[]): readonly string[] {
  const attackers = new Set<string>()
  for (const entry of universe) {
    if (entry.kind === 'truth' && entry.record.action === 'attacked') {
      attackers.add(entry.record.actor)
    }
  }
  return [...attackers]
}

function locationNodes(universe: readonly ReadableRecord[]): readonly string[] {
  const nodes = new Set<string>()
  for (const entry of universe) {
    if (entry.kind === 'truth') nodes.add(entry.record.location.node)
  }
  return [...nodes]
}

function npcParties(universe: readonly ReadableRecord[]): readonly string[] {
  const npcs = new Set<string>()
  for (const entry of universe) {
    if (entry.kind === 'observation') npcs.add(entry.record.observer)
    if (entry.kind === 'rumor') {
      npcs.add(entry.record.from)
      npcs.add(entry.record.to)
    }
  }
  return [...npcs]
}

/**
 * Holder names are not secrets -- merely naming another NPC asserts
 * nothing epistemic, so they are excluded from the generic entity rule and
 * governed solely by the other-mind rule below.
 */

/**
 * Entitlement derivation, entirely from the spine records: what this
 * holder observed, was told, already believes, and was shown defines what
 * its dialogue may assert. This mirrors `readable()` in
 * domain/livingWorldProof/evidenceRecords.ts and never consults truth
 * records -- truth reaches a holder only as an Observation.
 */
export function deriveEntitlement(holder: string, universe: readonly ReadableRecord[]): HolderEntitlement {
  const entitledTextParts: string[] = []
  const allowedBeliefSources = new Set<string>()
  const sightSeenLocations = new Set<string>()
  const heardSounds = new Set<string>()

  for (const entry of universe) {
    switch (entry.kind) {
      case 'observation':
        if (entry.record.observer === holder) {
          entitledTextParts.push(...Object.values(entry.record.perceived))
          if (entry.record.channels.includes('sight')) {
            const seen = entry.record.perceived['location']
            if (seen !== undefined) sightSeenLocations.add(seen)
          }
          const sound = entry.record.perceived['sound_signature']
          if (sound !== undefined) heardSounds.add(sound)
        }
        break
      case 'rumor':
        if (entry.record.to === holder) {
          allowedBeliefSources.add(entry.record.from)
          entitledTextParts.push(entry.record.proposition)
        }
        break
      case 'belief':
        if (entry.record.holder === holder) {
          entitledTextParts.push(entry.record.proposition)
        }
        break
      case 'evidence':
        if (entry.record.presentedTo === holder) {
          entitledTextParts.push(entry.record.implies, entry.record.contradicts)
        }
        break
      default:
        break
    }
  }

  const entitledText = entitledTextParts.join('\n')
  const allowedEntities = new Set<string>()
  for (const name of entityLexicon(universe)) {
    if (name === holder) continue
    if (mentionsAny(entitledText, compileMatchers(name))) allowedEntities.add(name)
  }

  return { allowedEntities, allowedBeliefSources, sightSeenLocations, heardSounds }
}

function splitSentences(transcript: string): readonly string[] {
  return transcript
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

/**
 * Shared with sibling instruments (answeredCount) so both counters cut and
 * match transcripts identically: whole-word, case-insensitive mention test
 * including digit-suffix lemma aliases.
 */
export function splitTranscriptSentences(transcript: string): readonly string[] {
  return splitSentences(transcript)
}

/** Shared matcher machinery for sibling instruments; see {@link splitTranscriptSentences}. */
export function mentionsAnyName(sentence: string, names: readonly string[]): boolean {
  if (names.length === 0) return false
  return names.some((name) => compileMatchers(name).some((matcher) => matcher.test(sentence)))
}

/**
 * Full findings list for one holder over one transcript. Deterministic and
 * side-effect free; inputs are never mutated.
 */
export function leakageBreakdown(
  transcript: string,
  holder: string,
  universe: readonly ReadableRecord[],
): readonly LeakageFinding[] {
  const entitlement = deriveEntitlement(holder, universe)
  const npcNames = new Set(npcParties(universe))
  const lexicon = entityLexicon(universe).filter((name) => name !== holder && !npcNames.has(name))
  const matchersByName = new Map(lexicon.map((name) => [name, compileMatchers(name)]))
  const npcMatchers = new Map([...npcNames].filter((npc) => npc !== holder).map((npc) => [npc, compileMatchers(npc)]))
  const attackers = attackerEntities(universe).filter((name) => name !== holder)
  const locations = locationNodes(universe)

  const findings: LeakageFinding[] = []
  for (const sentence of splitSentences(transcript)) {
    const mentionedUnallowed = lexicon.filter(
      (name) => !entitlement.allowedEntities.has(name) && mentionsAny(sentence, matchersByName.get(name)!),
    )

    for (const attacker of attackers) {
      if (!mentionedUnallowed.includes(attacker)) continue
      findings.push({ category: 'named-zombie', sentence, entity: attacker })
      if (ATTACK_VERBS.test(sentence)) {
        findings.push({ category: 'named-real-attacker', sentence, entity: attacker })
      }
    }

    for (const entity of mentionedUnallowed) {
      findings.push({ category: 'unentitled-entity', sentence, entity })
    }

    for (const location of locations) {
      if (entitlement.sightSeenLocations.has(location)) continue
      if (!mentionsAny(sentence, compileMatchers(location))) continue
      if (!EXISTENCE_FRAMES.test(sentence)) continue
      const explainsAsHeardSound = [...entitlement.heardSounds].some((sound) =>
        mentionsAny(sentence, [new RegExp(`\\b${escapeRegExp(sound)}\\b`, 'i')]),
      )
      if (explainsAsHeardSound) continue
      findings.push({ category: 'unseen-location-contents', sentence })
    }

    for (const [npc, matchers] of npcMatchers) {
      if (entitlement.allowedBeliefSources.has(npc)) continue
      if (!mentionsAny(sentence, matchers)) continue
      if (!MIND_VERBS.test(sentence)) continue
      findings.push({ category: 'other-mind-without-transmission', sentence, entity: npc })
    }
  }

  return findings
}

/**
 * The S1 counting function: how many out-of-scope assertions the transcript
 * carries for this holder, given the spine record universe. Pure.
 */
export function leakageCount(
  transcript: string,
  holder: string,
  universe: readonly ReadableRecord[],
): number {
  return leakageBreakdown(transcript, holder, universe).length
}
