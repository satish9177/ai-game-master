import { selectGeneratedStoryAnchorIndex } from './generatedRoomComposition'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

export type RoomSummaryDirection = 'north' | 'south' | 'east' | 'west' | 'center'

export type RoomSummaryMention = {
  type: RoomObject['type']
  direction: RoomSummaryDirection
}

export type RoomSummary = {
  text: string
  focal?: RoomSummaryMention
  mentions: RoomSummaryMention[]
}

const CENTER_EPSILON = 1

const STORY_ANCHOR_TYPES = new Set<RoomObject['type']>([
  'throne',
  'altar',
  'statue',
  'corpse',
  'machine',
  'artifact',
  'chest',
  'table',
  'map',
  'book',
  'paper',
])

const INTERACTIVE_SUPPORT_PRIORITY = 0
const NPC_SUPPORT_PRIORITY = 1
const ANCHOR_SUPPORT_PRIORITY = 2

const NOUNS: Record<RoomObject['type'], string> = {
  throne: 'a throne',
  pillar: 'a pillar',
  rug: 'a rug',
  torch: 'a torch',
  arch: 'an arch',
  scroll: 'a scroll',
  book: 'a book',
  paper: 'scattered papers',
  map: 'a map',
  chest: 'a chest',
  corpse: 'a corpse',
  table: 'a table',
  altar: 'an altar',
  statue: 'a statue',
  machine: 'a broken machine',
  artifact: 'a strange artifact',
  candle: 'a candle',
  npc: 'a figure',
  prop: 'an object',
  crate: 'a crate',
  barrel: 'a barrel',
  debris: 'debris',
  barricade: 'a barricade',
  zombie: 'a figure',
}

export function buildRoomSummary(room: LoadedRoom): RoomSummary | null {
  const focalIndex = selectFocalIndex(room.objects)
  if (focalIndex === -1) return null

  const focalObject = room.objects[focalIndex]
  if (!focalObject) return null

  const supportIndexes = selectSupportIndexes(room.objects, focalIndex)
  const mentions = [focalIndex, ...supportIndexes].map((index) => mentionFor(room.objects[index]!))
  const focal = mentions[0]
  if (!focal) return null

  return {
    text: buildSummaryText(room.name, focalObject, supportIndexes.map((index) => room.objects[index]!)),
    focal,
    mentions,
  }
}

function selectFocalIndex(objects: RoomObject[]): number {
  const storyAnchorIndex = selectGeneratedStoryAnchorIndex(objects)
  if (storyAnchorIndex !== -1) return storyAnchorIndex
  return objects.findIndex(isUsefulFallbackObject)
}

function selectSupportIndexes(objects: RoomObject[], focalIndex: number): number[] {
  return objects
    .map((object, index) => ({ index, priority: supportPriority(object) }))
    .filter(hasSupportPriority)
    .filter((candidate) => candidate.index !== focalIndex)
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .slice(0, 2)
    .map((candidate) => candidate.index)
}

function hasSupportPriority(
  candidate: { index: number; priority: number | null },
): candidate is { index: number; priority: number } {
  return candidate.priority !== null
}

function supportPriority(object: RoomObject): number | null {
  if (object.type === 'npc') return NPC_SUPPORT_PRIORITY
  if (hasNonExitInteraction(object)) return INTERACTIVE_SUPPORT_PRIORITY
  if (STORY_ANCHOR_TYPES.has(object.type)) return ANCHOR_SUPPORT_PRIORITY
  return null
}

function isUsefulFallbackObject(object: RoomObject): boolean {
  return hasNonExitInteraction(object) || object.type === 'npc'
}

function hasNonExitInteraction(object: RoomObject): boolean {
  return 'interaction' in object && object.interaction != null && object.interaction.exit == null
}

function mentionFor(object: RoomObject): RoomSummaryMention {
  return {
    type: object.type,
    direction: directionFor(object.position),
  }
}

function directionFor(position: RoomObject['position']): RoomSummaryDirection {
  const [x, , z] = position
  if (Math.abs(x) <= CENTER_EPSILON && Math.abs(z) <= CENTER_EPSILON) return 'center'
  if (Math.abs(x) > Math.abs(z)) return x > 0 ? 'east' : 'west'
  return z < 0 ? 'north' : 'south'
}

function buildSummaryText(roomName: string, focal: RoomObject, supports: RoomObject[]): string {
  const intro = `You enter ${introRoomNoun(roomName)}.`
  const focalText = capitalize(NOUNS[focal.type])
  const supportText = supports.length > 0
    ? ` near ${formatSupportList(supports)}`
    : ''
  return `${intro} ${focalText} ${verbFor(focal.type)} ${directionPhrase(directionFor(focal.position))}${supportText}.`
}

export function introRoomNoun(roomName: string): string {
  const trimmed = roomName.trim()
  if (trimmed.length === 0) return 'the room'
  if (/^generated room\b/i.test(trimmed)) return 'the room'

  const pipeIndex = trimmed.indexOf('|')
  if (pipeIndex !== -1) {
    const leading = trimmed.slice(0, pipeIndex).trim()
    return leading.length > 0 ? withArticle(leading) : 'the room'
  }

  return withArticle(trimmed)
}

function withArticle(roomName: string): string {
  const trimmed = roomName.trim()
  if (trimmed.length === 0) return 'the room'
  if (/^(a|an|the)\s/i.test(trimmed)) return trimmed
  return `the ${trimmed}`
}

function verbFor(type: RoomObject['type']): string {
  switch (type) {
    case 'corpse':
    case 'rug':
    case 'paper':
    case 'debris':
      return 'lies'
    case 'npc':
    case 'zombie':
      return 'waits'
    default:
      return 'stands'
  }
}

function directionPhrase(direction: RoomSummaryDirection): string {
  return direction === 'center' ? 'near the center' : `to the ${direction}`
}

function formatSupportList(supports: RoomObject[]): string {
  const nouns = supports.map((object) => NOUNS[object.type])
  return nouns.length === 1 ? nouns[0]! : `${nouns[0]} and ${nouns[1]}`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
