import { describe, expect, it } from 'vitest'
import type { FamiliarityBucket } from '../domain/npcRelationship/dialogueContext'
import {
  decideRelationshipFeedback,
  RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE,
  type RelationshipFeedbackMessage,
} from './relationshipFeedback'

const BUCKETS: FamiliarityBucket[] = ['none', 'low', 'medium', 'high']

describe('decideRelationshipFeedback', () => {
  it.each([
    ['none', 'low'],
    ['low', 'medium'],
    ['medium', 'high'],
    ['none', 'medium'],
    ['none', 'high'],
    ['low', 'high'],
  ] satisfies [FamiliarityBucket, FamiliarityBucket][])(
    'returns the message on an upward crossing from %s to %s',
    (prev, next) => {
      expect(decideRelationshipFeedback(prev, next)).toBe(RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE)
    },
  )

  it.each(BUCKETS)('returns null when the bucket stays at %s', (bucket) => {
    expect(decideRelationshipFeedback(bucket, bucket)).toBeNull()
  })

  it.each([
    ['low', 'none'],
    ['medium', 'low'],
    ['medium', 'none'],
    ['high', 'medium'],
    ['high', 'low'],
    ['high', 'none'],
  ] satisfies [FamiliarityBucket, FamiliarityBucket][])(
    'returns null on a downward move from %s to %s',
    (prev, next) => {
      expect(decideRelationshipFeedback(prev, next)).toBeNull()
    },
  )

  it('returns null for an unrecognized prev bucket', () => {
    expect(
      decideRelationshipFeedback('wary' as unknown as FamiliarityBucket, 'high'),
    ).toBeNull()
  })

  it('returns null for an unrecognized next bucket', () => {
    expect(
      decideRelationshipFeedback('none', 'devoted' as unknown as FamiliarityBucket),
    ).toBeNull()
  })

  it('can return only null or the one closed message constant', () => {
    const outputs: (RelationshipFeedbackMessage | null)[] = []
    for (const prev of BUCKETS) {
      for (const next of BUCKETS) {
        outputs.push(decideRelationshipFeedback(prev, next))
      }
    }

    for (const output of outputs) {
      expect([null, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE]).toContain(output)
    }
  })
})
