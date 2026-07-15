import type { WorldEvent } from '../world/events'
import type { JournalEntryView, JournalView } from './projectJournal'

/**
 * Pure, read-only projection of the append-only WorldEvent log into the
 * existing JournalView shape consumed (unchanged) by JournalPanel.
 *
 * Safety contract (see the consequence-journal-from-events-v1 plan):
 * - reads only closed enums (`type`, `op`), numeric signs/counts (`delta` sign),
 *   and `seq` (integer, used only for entry ids and ordering);
 * - never reads or echoes any string/object payload field (seed, room ids, item
 *   names/ids, health reason, raw status strings, flag keys/values);
 * - total and non-throwing: unknown/future event shapes are skipped;
 * - deterministic: no clock, no randomness; identical input → identical output;
 * - no mutation of the input; no logging; no write path to truth.
 */

const MAX_EVENT_JOURNAL_ENTRIES = 15

const EVENT_CONSEQUENCE_JOURNAL_ID = 'event-consequence-journal'
const EVENT_CONSEQUENCE_JOURNAL_TITLE = 'Consequences'

// Closed, hand-written phrase table. Entry text comes exclusively from here —
// never from any event payload field.
const PHRASE_MOVED = 'You pressed on to a new area.'
const PHRASE_ITEM_ADDED = 'You gained something of use.'
const PHRASE_ITEM_DISCOVERED = 'You noticed something worth taking.'
const PHRASE_ITEM_REMOVED = 'You parted with something.'
const PHRASE_HEALTH_HARM = 'You took harm.'
const PHRASE_HEALTH_RECOVER = 'You recovered some vigor.'
const PHRASE_STATUS_ADD = 'A new condition took hold.'
const PHRASE_STATUS_CLEAR = 'A condition lifted.'
const PHRASE_ROOM_MARK = 'Your actions left a mark here.'
const PHRASE_CLUE_DISCOVERED = 'You discovered a clue.'
const PHRASE_OBJECTIVE_ADVANCED = 'You advanced an objective.'
const MEANINGFUL_ENTRY_PREFIX = 'meaningful-'

/**
 * Map a single event to at most one closed phrase. Returns `null` for events
 * that produce no journal entry (session-started, zero-delta health changes,
 * visited-only room-state changes, and any unrecognised/future shape).
 */
function phraseForEvent(event: WorldEvent): string | null {
  switch (event.type) {
    case 'moved-to-room':
      return PHRASE_MOVED
    case 'item-added':
      return PHRASE_ITEM_ADDED
    case 'item-discovered':
      return PHRASE_ITEM_DISCOVERED
    case 'item-removed':
      return PHRASE_ITEM_REMOVED
    case 'health-changed': {
      const delta = event.payload.delta
      if (delta < 0) return PHRASE_HEALTH_HARM
      if (delta > 0) return PHRASE_HEALTH_RECOVER
      return null
    }
    case 'status-changed':
      return event.payload.op === 'add' ? PHRASE_STATUS_ADD : PHRASE_STATUS_CLEAR
    case 'room-state-changed': {
      const flags = event.payload.flags
      const anyFlagTrue = flags !== undefined && Object.values(flags).some((value) => value === true)
      return anyFlagTrue ? PHRASE_ROOM_MARK : null
    }
    case 'session-started':
      return null
    default:
      // Forward-compatible: unrecognised/future event types degrade to skipped.
      return null
  }
}

export function buildEventConsequenceJournal(events: WorldEvent[]): JournalView {
  const qualifying: JournalEntryView[] = []

  for (const event of events) {
    const text = phraseForEvent(event)
    if (text === null) continue
    qualifying.push({ id: `evt-${event.seq}`, text })
  }

  // Keep the most-recent N qualifying entries (tail), chronological ascending.
  const entries =
    qualifying.length > MAX_EVENT_JOURNAL_ENTRIES
      ? qualifying.slice(qualifying.length - MAX_EVENT_JOURNAL_ENTRIES)
      : qualifying

  const base = {
    journalId: EVENT_CONSEQUENCE_JOURNAL_ID,
    title: EVENT_CONSEQUENCE_JOURNAL_TITLE,
    entries,
  }
  return mergeMeaningfulObjectConsequenceJournal(
    base,
    buildMeaningfulObjectConsequenceJournal(events),
  ) ?? base
}

export function buildMeaningfulObjectConsequenceJournal(events: WorldEvent[]): JournalView {
  const qualifying: JournalEntryView[] = []
  const seenClues = new Set<string>()
  const seenObjectives = new Set<string>()

  for (const event of events) {
    if (event.type !== 'meaningful-object-applied') continue
    if (event.payload.clueId !== undefined && !seenClues.has(event.payload.clueId)) {
      seenClues.add(event.payload.clueId)
      qualifying.push({
        id: `${MEANINGFUL_ENTRY_PREFIX}${event.seq}-clue`,
        text: PHRASE_CLUE_DISCOVERED,
      })
    }
    if (event.payload.objective !== undefined) {
      const identity = JSON.stringify([
        event.payload.objective.questId,
        event.payload.objective.objectiveId,
        event.payload.objective.toStage,
      ])
      if (!seenObjectives.has(identity)) {
        seenObjectives.add(identity)
        qualifying.push({
          id: `${MEANINGFUL_ENTRY_PREFIX}${event.seq}-objective`,
          text: PHRASE_OBJECTIVE_ADVANCED,
        })
      }
    }
  }

  return {
    journalId: EVENT_CONSEQUENCE_JOURNAL_ID,
    title: EVENT_CONSEQUENCE_JOURNAL_TITLE,
    entries: qualifying.length > MAX_EVENT_JOURNAL_ENTRIES
      ? qualifying.slice(qualifying.length - MAX_EVENT_JOURNAL_ENTRIES)
      : qualifying,
  }
}

export function mergeMeaningfulObjectConsequenceJournal(
  base: JournalView | null,
  meaningful: JournalView,
): JournalView | null {
  if (meaningful.entries.length === 0) return base
  const baseEntries = base?.entries.filter((entry) => !entry.id.startsWith(MEANINGFUL_ENTRY_PREFIX)) ?? []
  const entries = [...baseEntries, ...meaningful.entries]
  return {
    journalId: base?.journalId ?? meaningful.journalId,
    title: base?.title ?? meaningful.title,
    entries: entries.length > MAX_EVENT_JOURNAL_ENTRIES
      ? entries.slice(entries.length - MAX_EVENT_JOURNAL_ENTRIES)
      : entries,
  }
}
