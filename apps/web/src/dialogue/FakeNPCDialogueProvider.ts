import type { NPCDialogueProvider } from '../domain/ports/NPCDialogueProvider'
import type { NPCDialogueRequest, NPCDialogueResponse } from '../domain/dialogue/contracts'
import type { RoomObject } from '../domain/roomSpec'

const PERSONA_LINES: Readonly<Record<string, readonly string[]>> = {
  'friendly-aide': [
    'The hall has seen quieter days, but you are welcome here.',
    'The north arch leads to a shelter beyond the ruined quarter.',
    'Keep your courage close. These rooms remember every visitor.',
  ],
  survivor: [
    'You made it inside. That is more than most manage.',
    'Supplies are thin, so take only what keeps you moving.',
    'Listen at every doorway before you cross it.',
  ],
}

const PROMPT_LINES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'friendly-aide': {
    'ask-hall': 'The court scattered when the roads fell silent.',
    'ask-exit': 'Beyond the north arch is a safehouse, battered but standing.',
  },
}

const FALLBACK_LINES = [
  'The stranger offers a cautious nod.',
  'For now, there is little more to tell.',
  'Some answers are safer shared face to face.',
] as const

const QUEST_CLUE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'friendly-aide': {
    'claim-tribute-coin': 'The tribute coffer sits somewhere in this hall. Find it and take the coin inside.',
    'get-past-steward-malik': 'The coin is yours — well done. Now Steward Malik stands between you and the door.',
    'enter-the-safehouse': 'Malik has been dealt with. Follow the north arch; it leads to the safehouse.',
  },
}

const QUEST_COMPLETION_LINES: Readonly<Record<string, string>> = {
  'friendly-aide': "You made it through. The steward's toll is paid.",
}

const ROOM_FOCUS_LINES: Partial<Record<RoomObject['type'], string>> = {
  corpse: 'A body lies here. Watch your step.',
  altar: 'That altar makes this place feel important.',
  statue: 'That statue is hard to ignore.',
  throne: 'The throne says plenty about who once ruled here.',
  chest: 'That chest may matter, but do not rush.',
  map: 'That map could be useful if you study the room.',
  book: 'Books like that often outlast their owners.',
  paper: 'Loose papers can reveal more than they seem.',
  scroll: 'A scroll in a place like this is rarely accidental.',
  machine: 'That machine looks worth noticing.',
  artifact: 'That artifact draws attention for a reason.',
  table: 'Even an ordinary table can hold clues.',
  barricade: 'A barricade usually means someone expected trouble.',
  debris: 'The debris says this place has seen damage.',
  zombie: 'That thing makes this room dangerous.',
}

/** Deterministic, in-process provider. It performs no logging or network I/O. */
export class FakeNPCDialogueProvider implements NPCDialogueProvider {
  async reply(request: NPCDialogueRequest): Promise<NPCDialogueResponse> {
    const key = request.context.persona ?? request.context.npcId
    const prompted = request.playerLine
      ? PROMPT_LINES[key]?.[request.playerLine]
      : undefined
    if (prompted) return { text: prompted }

    const questClue = questClueLine(request, key)
    if (questClue) return { text: questClue }

    const personaLines = PERSONA_LINES[key]
    if (personaLines) {
      const promptOffset = request.playerLine ? stableIndex(request.playerLine, personaLines.length) : 0
      const index = (request.context.history.length + promptOffset) % personaLines.length
      return { text: personaLines[index] ?? FALLBACK_LINES[0] }
    }

    const roomGrounded = roomGroundedFallback(request)
    if (roomGrounded) return { text: roomGrounded }

    const lines = FALLBACK_LINES
    const promptOffset = request.playerLine ? stableIndex(request.playerLine, lines.length) : 0
    const identityOffset = stableIndex(key, lines.length)
    const index = (request.context.history.length + promptOffset + identityOffset) % lines.length
    return { text: lines[index] ?? FALLBACK_LINES[0] }
  }
}

function questClueLine(request: NPCDialogueRequest, key: string): string | undefined {
  const quest = request.context.quest
  if (!quest) return undefined
  if (quest.status === 'complete' && quest.activeObjectiveId === null) {
    return quest.completionHint ?? QUEST_COMPLETION_LINES[key]
  }
  if (quest.activeObjectiveId !== null) {
    if (quest.hint) return quest.hint
    return QUEST_CLUE[key]?.[quest.activeObjectiveId]
  }
  return undefined
}

function roomGroundedFallback(request: NPCDialogueRequest): string | undefined {
  const focusType = request.context.room?.focus?.type
  return focusType ? ROOM_FOCUS_LINES[focusType] : undefined
}

function stableIndex(value: string, length: number): number {
  let total = 0
  for (const character of value) total = (total + character.charCodeAt(0)) % length
  return total
}
