import type { NPCDialogueRequest, RoomMemoryContextEntry } from '../domain/dialogue/contracts'
import type { ChatMessage } from './llmRoomPrompt'

export const MAX_MEMORY_ENTRIES = 3
export const MAX_MEMORY_LINE_CHARS = 160
const MAX_RECENT_TURNS = 6
const MAX_DIALOGUE_LINE_CHARS = 240

const MEMORY_HEDGE_PREFIX: Readonly<Record<string, string>> = {
  player_claim: 'Someone claimed',
  room_observation: 'Previously observed',
  room_note: 'A note here says',
  room_summary: 'This place is remembered as',
}

export const DEFAULT_MEMORY_HEDGE_PREFIX = 'It is rumored'

export const DIALOGUE_SYSTEM_PROMPT = [
  'You voice one NPC in a solo RPG scene.',
  'Reply with 1-3 sentences of in-character dialogue only.',
  'No markdown.',
  'No JSON.',
  'No executable code.',
  'No SQL.',
  'No renderer instructions.',
  'Do not claim world events or state mutations happened, and do not instruct any state mutation.',
  'Current and authoritative facts override background memory.',
  'Background memory may be incomplete, stale, false, or only a prior observation.',
  'If background conflicts with current facts, ignore the background.',
].join('\n')

export function buildDialoguePromptMessages(request: NPCDialogueRequest): ChatMessage[] {
  return [
    { role: 'system', content: DIALOGUE_SYSTEM_PROMPT },
    { role: 'user', content: buildUserDigest(request) },
  ]
}

function buildUserDigest(request: NPCDialogueRequest): string {
  const sections = [
    buildNpcSection(request),
    buildCurrentRoomSection(request),
    buildQuestSection(request),
    buildPlayerSection(request),
    buildRecentConversationSection(request),
  ]
  const memorySection = buildMemorySection(request.context.memory?.entries)
  if (memorySection !== undefined) sections.push(memorySection)

  return sections.join('\n\n')
}

function buildNpcSection(request: NPCDialogueRequest): string {
  const { npcName, persona } = request.context
  return [
    'NPC',
    `name: ${npcName}`,
    `persona: ${persona ?? 'unspecified'}`,
  ].join('\n')
}

function buildCurrentRoomSection(request: NPCDialogueRequest): string {
  const room = request.context.room
  if (room === undefined) {
    return ['CURRENT ROOM', 'focus: none', 'features: none', 'affordances: none', 'npcCount: 0'].join('\n')
  }

  return [
    'CURRENT ROOM',
    `focus: ${room.focus === undefined ? 'none' : `${room.focus.type} ${room.focus.direction}`}`,
    `features: ${room.features.length === 0 ? 'none' : room.features.map((feature) => `${feature.type} ${feature.direction}`).join(', ')}`,
    `affordances: ${room.affordances.length === 0 ? 'none' : room.affordances.join(', ')}`,
    `npcCount: ${room.npcCount}`,
  ].join('\n')
}

function buildQuestSection(request: NPCDialogueRequest): string {
  const quest = request.context.quest
  if (quest === undefined) return ['QUEST', 'status: none'].join('\n')

  const lines = ['QUEST', `status: ${quest.status}`]
  if (quest.objective !== undefined) {
    lines.push(`objective: ${quest.objective.status} ${quest.objective.kind}`)
  }
  if (quest.hint !== undefined) lines.push(`hint: ${quest.hint}`)
  if (quest.completionHint !== undefined) lines.push(`completionHint: ${quest.completionHint}`)
  return lines.join('\n')
}

function buildPlayerSection(request: NPCDialogueRequest): string {
  const { player } = request.context
  return [
    'PLAYER',
    `health: ${player.health.current}/${player.health.max}`,
    `status: ${player.status.length === 0 ? 'none' : player.status.join(', ')}`,
    `inventoryCount: ${player.inventoryItemIds.length}`,
  ].join('\n')
}

function buildRecentConversationSection(request: NPCDialogueRequest): string {
  const historyLines = request.context.history.slice(-MAX_RECENT_TURNS).map((turn) => {
    return `${turn.speaker}: ${clampText(turn.text, MAX_DIALOGUE_LINE_CHARS)}`
  })
  const playerLine = request.playerLine === undefined
    ? []
    : [`player: ${clampText(request.playerLine, MAX_DIALOGUE_LINE_CHARS)}`]
  const lines = [...historyLines, ...playerLine]

  return ['RECENT CONVERSATION', ...(lines.length === 0 ? ['none'] : lines)].join('\n')
}

function buildMemorySection(entries: RoomMemoryContextEntry[] | undefined): string | undefined {
  if (entries === undefined || entries.length === 0) return undefined

  const lines = entries.slice(0, MAX_MEMORY_ENTRIES).map((entry) => {
    return `${hedgePrefix(entry.kind)}: ${clampText(entry.text, MAX_MEMORY_LINE_CHARS)}`
  })

  return ['BACKGROUND ROOM MEMORY - NON-AUTHORITATIVE', ...lines].join('\n')
}

function hedgePrefix(kind: string | undefined): string {
  if (kind === undefined) return DEFAULT_MEMORY_HEDGE_PREFIX
  return MEMORY_HEDGE_PREFIX[kind] ?? DEFAULT_MEMORY_HEDGE_PREFIX
}

function clampText(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text
}
