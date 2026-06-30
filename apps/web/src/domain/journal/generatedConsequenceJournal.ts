import type { LoadedRoom } from '../loadRoomSpec'
import { resolvedObjectIds } from '../interactions/resolvedObjects'
import type {
  GeneratedStoryRoomContext,
  GeneratedStoryRoomRole,
  GeneratedStoryThreadKind,
} from '../generatedStoryThread'
import type { QuestView } from '../quests/evaluateQuest'
import type { WorldState } from '../world/worldState'
import type { JournalView } from './projectJournal'

export type GeneratedConsequenceJournalInput = {
  state: WorldState
  room: LoadedRoom
  quest: QuestView | null
  storyContext?: GeneratedStoryRoomContext
}

const STORY_JOURNAL_PHRASES: Readonly<
  Record<GeneratedStoryThreadKind, Readonly<Record<GeneratedStoryRoomRole, string>>>
> = {
  escape: {
    threshold: 'A way forward is starting to matter.',
    developing: 'The path ahead is narrowing.',
    deeper: 'Every passage carries weight now.',
  },
  investigate: {
    threshold: 'The first signs are starting to align.',
    developing: 'The pattern is becoming clearer.',
    deeper: 'The answer feels close now.',
  },
  survive: {
    threshold: 'The danger is close enough to feel.',
    developing: 'The pressure around you is rising.',
    deeper: 'Endurance is all that matters now.',
  },
  rescue: {
    threshold: 'A distant need pulls you onward.',
    developing: 'You are closing the distance.',
    deeper: 'Time feels short now.',
  },
  'recover-item': {
    threshold: 'Something important is still missing.',
    developing: 'The trail is getting stronger.',
    deeper: 'The goal feels almost within reach.',
  },
}

export function buildGeneratedConsequenceJournal(
  input: GeneratedConsequenceJournalInput,
): JournalView {
  const entries: JournalView['entries'] = []
  const { state, room, quest, storyContext } = input

  if (storyContext !== undefined) {
    entries.push({
      id: 'story-context',
      text: STORY_JOURNAL_PHRASES[storyContext.kind][storyContext.role],
    })
  }

  const visitedCount = Object.values(state.roomStates)
    .filter((roomState) => roomState.visited).length
  if (visitedCount > 0) {
    entries.push({
      id: 'rooms-explored',
      text: `You have explored ${visitedCount} chamber(s).`,
    })
  }

  if (quest?.status === 'complete') {
    entries.push({
      id: 'objective-resolved',
      text: "You resolved this chamber's objective.",
    })
  }

  const resolvedCount = resolvedObjectIds(room, state.roomStates[room.id]).size
  if (resolvedCount > 0) {
    entries.push({
      id: 'objects-disturbed',
      text: `You disturbed ${resolvedCount} feature(s) here.`,
    })
  }

  return {
    journalId: 'generated-consequence-journal',
    title: 'Consequences',
    entries,
  }
}
