import { describe, expect, it } from 'vitest'
import type { FamiliarityBucket } from '../domain/npcRelationship/dialogueContext'
import { RELATIONSHIP_JOURNAL_TEMPLATES } from '../domain/npcRelationship/relationshipJournalCandidate'
import {
  INITIAL_RELATIONSHIP_JOURNAL_STATE,
  RELATIONSHIP_JOURNAL_MAX_ENTRIES,
  accumulateRelationshipJournal,
  toRelationshipJournalView,
  type AccumulateRelationshipJournalInput,
  type RelationshipJournalState,
} from './relationshipJournalRuntime'

const WORLD_ID = 'world-relationship-scope'
const SESSION_ID = 'session-relationship-scope'
const NPC_ID = 'npc-relationship-scope'
const DIALOGUE_TEXT = 'player dialogue text should stay out'
const PROVIDER_TEXT = 'provider output should stay out'
const EFFECT_PAYLOAD_TEXT = 'effect payload should stay out'

const input = (
  prevBucket: FamiliarityBucket,
  nextBucket: FamiliarityBucket,
  overrides: Partial<AccumulateRelationshipJournalInput> = {},
): AccumulateRelationshipJournalInput => ({
  worldId: WORLD_ID,
  sessionId: SESSION_ID,
  npcId: NPC_ID,
  prevBucket,
  nextBucket,
  ...overrides,
})

describe('accumulateRelationshipJournal', () => {
  it('adds one frozen safe text entry for none -> low', () => {
    const state = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, input('none', 'low'))
    const view = toRelationshipJournalView(state)

    expect(view.entries).toHaveLength(1)
    expect(view.entries[0]).toEqual({
      id: 'relationship-journal-entry-a',
      text: RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased,
    })
    expect(view.entries[0]?.text).toBe('Someone here seems more familiar with you.')
  })

  it('returns the identical state reference for the same bucket', () => {
    const state = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, input('low', 'low'))

    expect(state).toBe(INITIAL_RELATIONSHIP_JOURNAL_STATE)
  })

  it('returns the identical state reference for a downward bucket change', () => {
    const state = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, input('medium', 'low'))

    expect(state).toBe(INITIAL_RELATIONSHIP_JOURNAL_STATE)
  })

  it('dedupes the same candidate to one entry', () => {
    const first = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, input('none', 'low'))
    const second = accumulateRelationshipJournal(first, input('none', 'low'))

    expect(second).toBe(first)
    expect(toRelationshipJournalView(second).entries).toHaveLength(1)
  })

  it('accumulates distinct crossings in chronological order', () => {
    const first = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, input('none', 'low'))
    const second = accumulateRelationshipJournal(first, input('low', 'medium'))
    const third = accumulateRelationshipJournal(second, input('medium', 'high'))

    expect(toRelationshipJournalView(third).entries).toEqual([
      { id: 'relationship-journal-entry-a', text: RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased },
      { id: 'relationship-journal-entry-b', text: RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased },
      { id: 'relationship-journal-entry-c', text: RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased },
    ])
  })

  it('caps entries at 32, drops the oldest, and never exceeds the cap', () => {
    let state: RelationshipJournalState = INITIAL_RELATIONSHIP_JOURNAL_STATE

    for (let index = 0; index < RELATIONSHIP_JOURNAL_MAX_ENTRIES + 3; index += 1) {
      state = accumulateRelationshipJournal(
        state,
        input('none', 'low', {
          npcId: `npc-${index}`,
        }),
      )
      expect(toRelationshipJournalView(state).entries.length).toBeLessThanOrEqual(
        RELATIONSHIP_JOURNAL_MAX_ENTRIES,
      )
    }

    const view = toRelationshipJournalView(state)
    expect(view.entries).toHaveLength(RELATIONSHIP_JOURNAL_MAX_ENTRIES)
    expect(view.entries[0]?.id).toBe('relationship-journal-entry-d')
    expect(view.entries.at(-1)?.id).toBe('relationship-journal-entry-ai')
  })

  it('dedupes multiple NPCs independently while rendered ids remain scope-free', () => {
    const first = accumulateRelationshipJournal(
      INITIAL_RELATIONSHIP_JOURNAL_STATE,
      input('none', 'low', { npcId: 'npc-one' }),
    )
    const second = accumulateRelationshipJournal(first, input('none', 'low', { npcId: 'npc-two' }))
    const duplicateFirst = accumulateRelationshipJournal(
      second,
      input('none', 'low', { npcId: 'npc-one' }),
    )
    const view = toRelationshipJournalView(duplicateFirst)

    expect(duplicateFirst).toBe(second)
    expect(view.entries).toHaveLength(2)
    expect(view.entries.map((entry) => entry.id)).toEqual([
      'relationship-journal-entry-a',
      'relationship-journal-entry-b',
    ])
    expect(JSON.stringify(view)).not.toContain('npc-one')
    expect(JSON.stringify(view)).not.toContain('npc-two')
  })

  it('does not mutate input state', () => {
    const original = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, input('none', 'low'))
    const originalSnapshot = JSON.stringify(original)

    const next = accumulateRelationshipJournal(original, input('low', 'medium'))

    expect(next).not.toBe(original)
    expect(JSON.stringify(original)).toBe(originalSnapshot)
    expect(toRelationshipJournalView(original).entries).toHaveLength(1)
  })
})

describe('toRelationshipJournalView', () => {
  it('returns the fixed journal id and title', () => {
    const state = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, input('none', 'low'))
    const view = toRelationshipJournalView(state)

    expect(view.journalId).toBe('relationship-journal')
    expect(view.title).toBe('Relationships')
  })

  it('projects only opaque ids and frozen safe text', () => {
    const state = accumulateRelationshipJournal(INITIAL_RELATIONSHIP_JOURNAL_STATE, input('none', 'low'))
    const view = toRelationshipJournalView(state)

    expect(view.entries).toEqual([
      {
        id: 'relationship-journal-entry-a',
        text: RELATIONSHIP_JOURNAL_TEMPLATES.familiarity_increased,
      },
    ])
    expect(view.entries[0]).not.toHaveProperty('dedupeKey')
  })

  it('serialized view leaks no scope ids, raw keys, digits, buckets, scores, dialogue, provider, or effect text', () => {
    const state = accumulateRelationshipJournal(
      INITIAL_RELATIONSHIP_JOURNAL_STATE,
      input('none', 'low', {
        worldId: WORLD_ID,
        sessionId: SESSION_ID,
        npcId: NPC_ID,
      }),
    )
    const serializedView = JSON.stringify(toRelationshipJournalView(state))
    const rawDedupeKey = `relationship-journal:${WORLD_ID}:${SESSION_ID}:${NPC_ID}:familiarity:increased:low`

    expect(serializedView).not.toContain(WORLD_ID)
    expect(serializedView).not.toContain(SESSION_ID)
    expect(serializedView).not.toContain(NPC_ID)
    expect(serializedView).not.toContain(rawDedupeKey)
    expect(serializedView).not.toMatch(/\d/)
    expect(serializedView).not.toMatch(/none|low|medium|high/i)
    expect(serializedView).not.toMatch(/score/i)
    expect(serializedView).not.toMatch(/delta/i)
    expect(serializedView).not.toContain(DIALOGUE_TEXT)
    expect(serializedView).not.toContain(PROVIDER_TEXT)
    expect(serializedView).not.toContain(EFFECT_PAYLOAD_TEXT)
    expect(serializedView).not.toMatch(/relationship_feedback|structuredDialogueEffect|effect payload/i)
  })
})
