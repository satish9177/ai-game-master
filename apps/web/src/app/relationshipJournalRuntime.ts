import type { JournalView } from '../domain/journal/projectJournal'
import type { FamiliarityBucket } from '../domain/npcRelationship/dialogueContext'
import {
  buildRelationshipJournalCandidate,
  renderRelationshipJournalText,
} from '../domain/npcRelationship/relationshipJournalCandidate'

export const RELATIONSHIP_JOURNAL_MAX_ENTRIES = 32

export type RelationshipJournalRuntimeEntry = Readonly<{
  id: string
  text: string
  dedupeKey: string
}>

export type RelationshipJournalState = Readonly<{
  entries: readonly RelationshipJournalRuntimeEntry[]
  nextEntryOrdinal: number
}>

export type AccumulateRelationshipJournalInput = Readonly<{
  worldId: string
  sessionId: string
  npcId: string
  prevBucket: FamiliarityBucket
  nextBucket: FamiliarityBucket
}>

export const INITIAL_RELATIONSHIP_JOURNAL_STATE: RelationshipJournalState = Object.freeze({
  entries: Object.freeze([]),
  nextEntryOrdinal: 0,
})

export function accumulateRelationshipJournal(
  state: RelationshipJournalState,
  input: AccumulateRelationshipJournalInput,
): RelationshipJournalState {
  const candidate = buildRelationshipJournalCandidate({
    worldId: input.worldId,
    sessionId: input.sessionId,
    npcId: input.npcId,
    fromBucket: input.prevBucket,
    toBucket: input.nextBucket,
  })

  if (candidate === null) return state

  if (state.entries.some((entry) => entry.dedupeKey === candidate.dedupeKey)) {
    return state
  }

  const nextEntry: RelationshipJournalRuntimeEntry = Object.freeze({
    id: `relationship-journal-entry-${ordinalToSafeLetters(state.nextEntryOrdinal)}`,
    text: renderRelationshipJournalText(candidate),
    dedupeKey: candidate.dedupeKey,
  })
  const entries = [...state.entries, nextEntry].slice(-RELATIONSHIP_JOURNAL_MAX_ENTRIES)

  return Object.freeze({
    entries: Object.freeze(entries),
    nextEntryOrdinal: state.nextEntryOrdinal + 1,
  })
}

export function toRelationshipJournalView(state: RelationshipJournalState): JournalView {
  return {
    journalId: 'relationship-journal',
    title: 'Relationships',
    entries: state.entries.map((entry) => ({
      id: entry.id,
      text: entry.text,
    })),
  }
}

function ordinalToSafeLetters(ordinal: number): string {
  let value = Math.max(0, Math.trunc(ordinal))
  let label = ''

  do {
    label = String.fromCharCode(97 + (value % 26)) + label
    value = Math.floor(value / 26) - 1
  } while (value >= 0)

  return label
}
