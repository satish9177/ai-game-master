import type { NpcRelationshipState } from './contracts'

/**
 * Read-only, bucketed, closed-enum hint of one NPC's relationship toward the
 * player, for dialogue tone only. It is never raw scores, never persisted,
 * and never authoritative -- a compact hint a provider may use for tone, not
 * a fact it can act on or mutate.
 *
 * v0 behavior: only familiarity ever moves (see reducer.ts / the frozen
 * RELATIONSHIP_EFFECT_DELTA_TABLE), so trust/respect/fear stay at their
 * single neutral/none value by construction. This shape only widens if a
 * future, separately approved slice makes valenced effect kinds emittable.
 */

export const NPC_RELATIONSHIP_DIALOGUE_CONTEXT_SCHEMA_VERSION = 1 as const

export type FamiliarityBucket = 'none' | 'low' | 'medium' | 'high'

export type RelationshipDialogueContext = {
  schemaVersion: typeof NPC_RELATIONSHIP_DIALOGUE_CONTEXT_SCHEMA_VERSION
  subject: 'npc'
  object: 'player'
  familiarityBucket: FamiliarityBucket
  trustBucket: 'neutral'
  respectBucket: 'neutral'
  fearBucket: 'none'
}

/** Pure, deterministic bucketing of the raw familiarity axis. */
export function familiarityBucket(familiarity: number): FamiliarityBucket {
  if (familiarity <= 0) return 'none'
  if (familiarity <= 33) return 'low'
  if (familiarity <= 66) return 'medium'
  return 'high'
}

const NEUTRAL_RELATIONSHIP_DIALOGUE_CONTEXT: RelationshipDialogueContext = {
  schemaVersion: NPC_RELATIONSHIP_DIALOGUE_CONTEXT_SCHEMA_VERSION,
  subject: 'npc',
  object: 'player',
  familiarityBucket: 'none',
  trustBucket: 'neutral',
  respectBucket: 'neutral',
  fearBucket: 'none',
}

/**
 * Projects the ephemeral relationship projection into a bounded dialogue
 * hint. Missing state (no projection held yet for this NPC) degrades to the
 * neutral/no-familiarity context -- never an error, never a leak from a
 * different NPC or session.
 */
export function projectRelationshipDialogueContext(
  state: NpcRelationshipState | undefined,
): RelationshipDialogueContext {
  if (state === undefined) return NEUTRAL_RELATIONSHIP_DIALOGUE_CONTEXT

  return {
    schemaVersion: NPC_RELATIONSHIP_DIALOGUE_CONTEXT_SCHEMA_VERSION,
    subject: 'npc',
    object: 'player',
    familiarityBucket: familiarityBucket(state.axes.familiarity),
    trustBucket: 'neutral',
    respectBucket: 'neutral',
    fearBucket: 'none',
  }
}
