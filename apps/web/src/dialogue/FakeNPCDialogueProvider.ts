import type { NPCDialogueProvider } from '../domain/ports/NPCDialogueProvider'
import type { NPCDialogueRequest, NPCDialogueResponse, NPCObjectiveKind } from '../domain/dialogue/contracts'
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

export const OBJECTIVE_LINES: Readonly<
  Record<NPCObjectiveKind, Readonly<Record<'active' | 'complete', readonly string[]>>>
> = {
  inspect: {
    active: [
      'Search this room carefully. The useful thing is probably nearby.',
      'Take a close look before you move on.',
      'Anything important here should be found before you leave.',
    ],
    complete: [
      'You found what needed finding.',
      'That search paid off.',
      'Nothing else here demands the same attention.',
    ],
  },
  resolve: {
    active: [
      'Something here still needs to be dealt with before this place is safe.',
      'Stay ready. This room is not settled yet.',
      'Do not leave the matter here unfinished.',
    ],
    complete: [
      'That is dealt with. Keep moving.',
      'This place is safer now.',
      'Good. That needed doing.',
    ],
  },
  reach: {
    active: [
      'Keep your bearings. The way forward matters here.',
      'Do not lose track of where you are headed.',
      'The next step may be beyond this room.',
    ],
    complete: [
      'You reached where you needed to go.',
      'The path has been followed far enough.',
      'That part of the way is behind you.',
    ],
  },
  general: {
    active: [
      'Look around before moving on. This place still has something to tell us.',
      'Take your time here. Something still matters.',
      'Do not rush past what this room is showing you.',
    ],
    complete: [
      'The work here is done.',
      'You can move on from this place.',
      'Nothing here needs to hold you now.',
    ],
  },
}

/**
 * Lowest-priority, non-authoritative memory-awareness tier (Slice G).
 *
 * Keyed by the closed room-memory `kind` (`player_claim` / `room_observation` /
 * `room_note` / `room_summary`; see `domain/memory/roomContracts.ts`). The
 * dialogue-local `RoomMemoryContextEntry.kind` is an untrusted `string`, so any
 * unrecognized/absent value simply misses this table and falls through.
 *
 * Lines are hand-written, finite, and epistemically hedged: a claim stays a
 * claim, an observation is not asserted as truth. They reference remembered
 * context as atmosphere only — never the recalled `text`, ids, room/object/NPC
 * names, or the `kind` string itself — and never override current room/NPC/
 * player state.
 */
export const MEMORY_AWARENESS_LINES: Readonly<Record<string, readonly string[]>> = {
  player_claim: [
    'Someone passing through swore this place held more than it shows.',
    'A traveler once made claims about this room. Believe them or not.',
    'People say things about this place. Take such talk lightly.',
  ],
  room_observation: [
    'This room has been watched before; it does not feel untouched.',
    'Others have taken note of this place already.',
    'Eyes have lingered here before yours.',
  ],
  room_note: [
    'There are notes about this place, for whatever they are worth.',
    'Some record of this room lingers on.',
    'This room has not gone unremarked.',
  ],
  room_summary: [
    'This room already has a story behind it.',
    'There is a history to this place, if you care for it.',
    'This place carries more than what stands in it now.',
  ],
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

    const objectiveNudge = objectiveAwarenessLine(request)
    if (objectiveNudge) return { text: objectiveNudge }

    const personaLines = PERSONA_LINES[key]
    if (personaLines) {
      const promptOffset = request.playerLine ? stableIndex(request.playerLine, personaLines.length) : 0
      const index = (request.context.history.length + promptOffset) % personaLines.length
      return { text: personaLines[index] ?? FALLBACK_LINES[0] }
    }

    const roomGrounded = roomGroundedFallback(request)
    if (roomGrounded) return { text: roomGrounded }

    const memoryAware = memoryAwarenessLine(request)
    if (memoryAware) return { text: memoryAware }

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

function memoryAwarenessLine(request: NPCDialogueRequest): string | undefined {
  const entries = request.context.memory?.entries
  if (!entries || entries.length === 0) return undefined
  for (const entry of entries) {
    const lines = entry.kind ? MEMORY_AWARENESS_LINES[entry.kind] : undefined
    if (lines && lines.length > 0) {
      const index = request.context.history.length % lines.length
      return lines[index]
    }
  }
  return undefined
}

function objectiveAwarenessLine(request: NPCDialogueRequest): string | undefined {
  const objective = request.context.quest?.objective
  if (objective == null) return undefined
  const lines = OBJECTIVE_LINES[objective.kind][objective.status]
  const index = request.context.history.length % lines.length
  return lines[index]
}

function stableIndex(value: string, length: number): number {
  let total = 0
  for (const character of value) total = (total + character.charCodeAt(0)) % length
  return total
}
