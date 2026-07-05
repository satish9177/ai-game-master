import type { FamiliarityBucket } from '../domain/npcRelationship/dialogueContext'

export const RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE = 'They seem more familiar with you.'

export type RelationshipFeedbackMessage = typeof RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE

const FAMILIARITY_BUCKET_RANK: Record<FamiliarityBucket, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
}

/**
 * Pure gate: fires only on a strictly upward familiarity bucket crossing.
 * Reads two closed-enum bucket values only -- never raw scores/deltas.
 */
export function decideRelationshipFeedback(
  prevBucket: FamiliarityBucket,
  nextBucket: FamiliarityBucket,
): RelationshipFeedbackMessage | null {
  const prevRank = FAMILIARITY_BUCKET_RANK[prevBucket]
  const nextRank = FAMILIARITY_BUCKET_RANK[nextBucket]

  if (prevRank === undefined || nextRank === undefined) return null
  if (nextRank <= prevRank) return null

  return RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE
}
