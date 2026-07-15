import { projectPlayerHud } from '../renderer/ui/playerHud'
import type { PlayerHudView } from '../renderer/ui/playerHud'
import { evaluateQuest } from '../domain/quests/evaluateQuest'
import type { QuestView } from '../domain/quests/evaluateQuest'
import type { QuestSpec } from '../domain/quests/questSpec'
import { projectJournal } from '../domain/journal/projectJournal'
import type { JournalView } from '../domain/journal/projectJournal'
import type { JournalSpec } from '../domain/journal/journalSpec'
import { buildGeneratedConsequenceJournal } from '../domain/journal/generatedConsequenceJournal'
import type { GeneratedConsequenceJournalInput } from '../domain/journal/generatedConsequenceJournal'
import type { WorldState } from '../domain/world/worldState'

/**
 * The App's read-only derived view caches, projected from authoritative
 * `WorldState`: the player HUD always, and the quest tracker / journal only
 * when their authored specs are attached (the example world). Pure and total —
 * no I/O, no `Date.now`/`Math.random`, no input mutation.
 *
 * This is the single source of the projection logic the App re-applies every
 * time it obtains a fresh `WorldState` (bootstrap, load, navigation, and
 * interaction/encounter resolution), so the refresh sites can never drift.
 */
export type DerivedViews = {
  playerHud: PlayerHudView
  quest: QuestView | null
  journal: JournalView | null
}

export function computeDerivedViews(
  state: WorldState,
  questSpec: QuestSpec | null,
  journalSpec: JournalSpec | null,
  generatedJournalInput?: GeneratedConsequenceJournalInput,
  meaningfulObjectProgression = false,
): DerivedViews {
  return {
    playerHud: projectPlayerHud(state),
    quest: questSpec
      ? evaluateQuest(questSpec, state, { meaningfulObjectProgression })
      : null,
    journal: generatedJournalInput !== undefined
      ? buildGeneratedConsequenceJournal(generatedJournalInput)
      : journalSpec ? projectJournal(journalSpec, state) : null,
  }
}
