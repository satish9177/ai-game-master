import type { WorldState } from '../world/worldState'
import { evaluateCondition } from '../quests/evaluateQuest'
import type { JournalSpec } from './journalSpec'

export type JournalEntryView = { id: string; text: string }

export type JournalView = {
  journalId: string
  title: string
  entries: JournalEntryView[]
}

export function projectJournal(spec: JournalSpec, state: WorldState): JournalView {
  const entries: JournalEntryView[] = []
  for (const entry of spec.entries) {
    if (evaluateCondition(entry.condition, state)) {
      entries.push({ id: entry.id, text: entry.text })
    }
  }
  return { journalId: spec.journalId, title: spec.title, entries }
}
