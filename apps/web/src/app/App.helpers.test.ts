import { describe, expect, it } from 'vitest'
import type { FamiliarityBucket } from '../domain/npcRelationship/dialogueContext'
import {
  INITIAL_RELATIONSHIP_FEEDBACK_STATE,
  relationshipFeedbackAfterReduction,
  relationshipFeedbackOnRoomEntry,
  selectTransientFeedbackMessage,
  type RelationshipFeedbackState,
} from './App.helpers'
import { MEMORY_CREATED_MESSAGE, MEMORY_RECALLED_MESSAGE } from './memoryFeedback'
import { RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE } from './relationshipFeedback'

describe('relationshipFeedbackAfterReduction', () => {
  it('sets the message on an upward familiarity bucket crossing', () => {
    const next = relationshipFeedbackAfterReduction(INITIAL_RELATIONSHIP_FEEDBACK_STATE, {
      prevBucket: 'none',
      nextBucket: 'low',
    })
    expect(next).toEqual({ message: RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE })
  })

  it('leaves the state unchanged on a same-bucket turn', () => {
    const state = INITIAL_RELATIONSHIP_FEEDBACK_STATE
    const next = relationshipFeedbackAfterReduction(state, { prevBucket: 'low', nextBucket: 'low' })
    expect(next).toBe(state)
  })

  it('leaves the state unchanged on a downward pair (structurally impossible)', () => {
    const state: RelationshipFeedbackState = { message: RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE }
    const next = relationshipFeedbackAfterReduction(state, { prevBucket: 'high', nextBucket: 'low' })
    expect(next).toBe(state)
  })

  it('overwrites an existing message on a later upward crossing', () => {
    const state: RelationshipFeedbackState = { message: RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE }
    const next = relationshipFeedbackAfterReduction(state, {
      prevBucket: 'low',
      nextBucket: 'medium',
    })
    expect(next).toEqual({ message: RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE })
    expect(next).not.toBe(state)
  })

  it.each(['none', 'low', 'medium', 'high'] satisfies FamiliarityBucket[])(
    'never produces a message other than the closed constant or null (bucket %s)',
    (bucket) => {
      const next = relationshipFeedbackAfterReduction(INITIAL_RELATIONSHIP_FEEDBACK_STATE, {
        prevBucket: bucket,
        nextBucket: bucket,
      })
      expect([null, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE]).toContain(next.message)
    },
  )
})

describe('relationshipFeedbackOnRoomEntry', () => {
  it('clears a set message', () => {
    const state: RelationshipFeedbackState = { message: RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE }
    expect(relationshipFeedbackOnRoomEntry(state)).toEqual({ message: null })
  })

  it('returns the same reference when already null', () => {
    const state = INITIAL_RELATIONSHIP_FEEDBACK_STATE
    expect(relationshipFeedbackOnRoomEntry(state)).toBe(state)
  })
})

describe('selectTransientFeedbackMessage', () => {
  it('prefers memory-created over relationship feedback', () => {
    expect(
      selectTransientFeedbackMessage(MEMORY_CREATED_MESSAGE, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE),
    ).toBe(MEMORY_CREATED_MESSAGE)
  })

  it('prefers memory-recalled over relationship feedback', () => {
    expect(
      selectTransientFeedbackMessage(MEMORY_RECALLED_MESSAGE, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE),
    ).toBe(MEMORY_RECALLED_MESSAGE)
  })

  it('falls back to relationship feedback when both memory slots are null', () => {
    expect(selectTransientFeedbackMessage(null, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE)).toBe(
      RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE,
    )
  })

  it('returns null when both are null', () => {
    expect(selectTransientFeedbackMessage(null, null)).toBeNull()
  })
})
