import { computePlayableBounds, objectFootprintRadius } from './generatedRoomLayout'
import { selectGeneratedStoryAnchorIndex } from './generatedRoomComposition'
import type { NPCDialogueSpec } from './dialogue/contracts'
import type { GeneratedRoomVisualTheme } from './generatedRoomThemeVocabulary'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

export type EnsureGeneratedNpcPresenceOptions = {
  requested: boolean
  themePack?: GeneratedRoomVisualTheme
}

export type EnsureGeneratedNpcPresenceResult = {
  room: LoadedRoom
  npcInserted: boolean
}

export type EnsureGeneratedNpcDialogueOptions = {
  themePack?: GeneratedRoomVisualTheme
}

export type EnsureGeneratedNpcDialogueResult = {
  room: LoadedRoom
  npcDialogueNormalizedCount: number
}

type NpcObject = Extract<RoomObject, { type: 'npc' }>
type ThemeBucket = GeneratedRoomVisualTheme | 'default'

const GENERATED_NPC_BASE_ID = 'generated-npc'
const GENERATED_NPC_COLOR = '#597a9b'
const GENERATED_NPC_FOOTPRINT = 0.45

const NPC_BLOCKING_TYPES = new Set<RoomObject['type']>([
  'throne',
  'pillar',
  'npc',
  'prop',
  'crate',
  'barrel',
  'chest',
  'corpse',
  'table',
  'altar',
  'statue',
  'machine',
  'artifact',
  'barricade',
  'debris',
  'zombie',
])

const NPC_NAMES: Readonly<Record<ThemeBucket, readonly string[]>> = {
  default: Object.freeze(['Nara', 'Oren', 'Lio', 'Tessa']),
  'fantasy-keep': Object.freeze(['Elian', 'Seris', 'Tovan', 'Maera']),
  'post-apoc': Object.freeze(['Pax', 'Ren', 'Juno', 'Calder']),
}

const NPC_PERSONAS: Readonly<Record<ThemeBucket, readonly string[]>> = {
  default: Object.freeze(['generated-room-guide', 'generated-calm-witness']),
  'fantasy-keep': Object.freeze(['generated-keep-warden', 'generated-archive-aide']),
  'post-apoc': Object.freeze(['generated-wasteland-scout', 'generated-shelter-watch']),
}

const NPC_GREETINGS: Readonly<Record<ThemeBucket, readonly string[]>> = {
  default: Object.freeze([
    'Stay close. I am {name}.',
    'Keep your voice low. I am {name}.',
  ]),
  'fantasy-keep': Object.freeze([
    'Hold a moment. I am {name}, sworn to watch these halls.',
    'Tread softly. I am {name}, and this place still listens.',
  ]),
  'post-apoc': Object.freeze([
    'Stay sharp. I am {name}, and the quiet does not last.',
    'Keep low. I am {name}; the ruins carry every sound.',
  ]),
}

const NPC_BODIES: Readonly<Record<ThemeBucket, readonly string[]>> = {
  default: Object.freeze([
    '{name} watches the room, ready to answer quietly.',
    '{name} studies the surroundings and waits for your question.',
  ]),
  'fantasy-keep': Object.freeze([
    '{name} keeps watch over the chamber, cautious but willing to speak.',
    '{name} listens for movement beyond the walls before answering.',
  ]),
  'post-apoc': Object.freeze([
    '{name} scans the room for danger, ready to trade a few careful words.',
    '{name} checks the shadows, then gives you a brief nod.',
  ]),
}

// Nameless greetings used when normalizing dialogue onto an existing NPC.
const NPC_DIALOGUE_GREETINGS: Readonly<Record<ThemeBucket, readonly string[]>> = {
  default: Object.freeze([
    'Stay close and keep your voice low.',
    'I can answer, but quietly.',
  ]),
  'fantasy-keep': Object.freeze([
    'Hold a moment and tread softly.',
    'Speak softly; this place still listens.',
  ]),
  'post-apoc': Object.freeze([
    'Stay sharp and keep low.',
    'Quiet now; the ruins carry every sound.',
  ]),
}

const ANCHOR_PROMPTS: Partial<Record<RoomObject['type'], readonly string[]>> = {
  throne: Object.freeze(['What authority ruled here?', 'What happened around the throne?']),
  altar: Object.freeze(['What was this altar used for?', 'What kind of ritual happened here?']),
  statue: Object.freeze(['Who does this statue honor?', 'Why is this statue important?']),
  corpse: Object.freeze(['What happened to the body?', 'Is there danger near the body?']),
  machine: Object.freeze(['What is this machine for?', 'Is the machine still dangerous?']),
  artifact: Object.freeze(['What is this artifact?', 'Why does this artifact matter?']),
  chest: Object.freeze(['Is that chest worth checking?', 'What might be stored here?']),
  table: Object.freeze(['What was arranged on the table?', 'Does the table tell us anything?']),
  map: Object.freeze(['What does the map show?', 'Can the map guide us?']),
  book: Object.freeze(['What should I look for in the book?', 'Could the book explain this place?']),
  paper: Object.freeze(['What should I read first?', 'Could these papers matter?']),
}

const GENERIC_ROOM_PROMPTS = Object.freeze([
  'What should I look at first?',
  'What stands out to you here?',
  'What feels important in this room?',
])

const HELP_PROMPTS = Object.freeze([
  'Can you guide me?',
  'What should I do next?',
  'Can you watch my back?',
  'How can you help?',
])

export function ensureGeneratedNpcPresence(
  room: LoadedRoom,
  options: EnsureGeneratedNpcPresenceOptions,
): EnsureGeneratedNpcPresenceResult {
  if (!options.requested) return { room, npcInserted: false }
  if (room.objects.some((object) => object.type === 'npc')) {
    return { room, npcInserted: false }
  }

  const position = findNpcPosition(room)
  if (position === null) return { room, npcInserted: false }

  const npc: NpcObject = {
    ...buildNpcTemplate(room, options),
    id: nextNpcId(room.objects),
    position,
  }

  return {
    room: { ...room, objects: [...room.objects, npc] },
    npcInserted: true,
  }
}

export function ensureGeneratedNpcDialogue(
  room: LoadedRoom,
  options: EnsureGeneratedNpcDialogueOptions = {},
): EnsureGeneratedNpcDialogueResult {
  const usedIds = new Set(room.objects.map((object) => object.id).filter(isNonBlankString))
  let npcDialogueNormalizedCount = 0
  let anyChanged = false

  const objects = room.objects.map((object) => {
    if (object.type !== 'npc') return object

    const needsId = !isNonBlankString(object.id)
    const needsDialogue = object.interaction.dialogue === undefined
    if (!needsId && !needsDialogue) return object

    const id = isNonBlankString(object.id) ? object.id : nextNpcIdFromIds(usedIds)
    usedIds.add(id)
    anyChanged = true

    if (!needsDialogue) {
      return { ...object, id }
    }

    npcDialogueNormalizedCount += 1

    return {
      ...object,
      id,
      interaction: {
        ...object.interaction,
        dialogue: buildNpcDialogue(room, options, id),
      },
    }
  })

  if (!anyChanged) return { room, npcDialogueNormalizedCount }
  return { room: { ...room, objects }, npcDialogueNormalizedCount }
}

function buildNpcTemplate(
  room: LoadedRoom,
  options: EnsureGeneratedNpcPresenceOptions,
): Omit<NpcObject, 'id' | 'position'> {
  const bucket = themeBucket(options.themePack)
  const name = selectFrom(NPC_NAMES[bucket], room.id, 'name')
  const persona = selectFrom(NPC_PERSONAS[bucket], room.id, 'persona')
  const greeting = formatName(selectFrom(NPC_GREETINGS[bucket], room.id, 'greeting'), name)
  const body = formatName(selectFrom(NPC_BODIES[bucket], room.id, 'body'), name)
  const askRoomLabel = selectPromptOne(room, options)
  const askHelpLabel = selectFrom(HELP_PROMPTS, room.id, 'ask-help')

  return {
    type: 'npc',
    name,
    color: GENERATED_NPC_COLOR,
    rotationY: 0,
    scale: 1,
    interaction: {
      key: 'F',
      prompt: `Press F to talk to ${name}`,
      body,
      dialogue: {
        persona,
        greeting,
        prompts: [
          { id: 'ask-room', label: askRoomLabel },
          { id: 'ask-help', label: askHelpLabel },
        ],
      },
    },
  }
}

function buildNpcDialogue(
  room: LoadedRoom,
  options: EnsureGeneratedNpcDialogueOptions,
  npcId: string,
): NPCDialogueSpec {
  const selectionKey = `${room.id}:${npcId}`
  const bucket = themeBucket(options.themePack)
  return {
    persona: selectFrom(NPC_PERSONAS[bucket], selectionKey, 'persona'),
    greeting: selectFrom(NPC_DIALOGUE_GREETINGS[bucket], selectionKey, 'greeting'),
    prompts: [
      { id: 'ask-room', label: selectPromptOneWithKey(room, options, selectionKey) },
      { id: 'ask-help', label: selectFrom(HELP_PROMPTS, selectionKey, 'ask-help') },
    ],
  }
}

function selectPromptOne(room: LoadedRoom, options: EnsureGeneratedNpcPresenceOptions): string {
  return selectPromptOneWithKey(room, options, room.id)
}

function selectPromptOneWithKey(
  room: LoadedRoom,
  options: EnsureGeneratedNpcDialogueOptions,
  selectionKey: string,
): string {
  const anchorIndex = selectGeneratedStoryAnchorIndex(room.objects, { themePack: options.themePack })
  const anchorType = anchorIndex >= 0 ? room.objects[anchorIndex]?.type : undefined
  const prompts = anchorType !== undefined ? ANCHOR_PROMPTS[anchorType] : undefined
  return selectFrom(prompts ?? GENERIC_ROOM_PROMPTS, selectionKey, `ask-room:${anchorType ?? 'none'}`)
}

function themeBucket(themePack: GeneratedRoomVisualTheme | undefined): ThemeBucket {
  return themePack ?? 'default'
}

function selectFrom<T>(values: readonly T[], roomId: string, salt: string): T {
  return values[stableIndex(`${salt}:${roomId}`, values.length)]!
}

function stableIndex(input: string, modulo: number): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % modulo
}

function formatName(template: string, name: string): string {
  return template.replace('{name}', name)
}

function nextNpcId(objects: RoomObject[]): string {
  const ids = new Set(objects.map((object) => object.id).filter((id): id is string => id != null))
  return nextNpcIdFromIds(ids)
}

function nextNpcIdFromIds(ids: ReadonlySet<string>): string {
  if (!ids.has(GENERATED_NPC_BASE_ID)) return GENERATED_NPC_BASE_ID
  for (let index = 2; ; index += 1) {
    const candidate = `${GENERATED_NPC_BASE_ID}-${index}`
    if (!ids.has(candidate)) return candidate
  }
}

function isNonBlankString(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0
}

function findNpcPosition(room: LoadedRoom): [number, number, number] | null {
  const bounds = computePlayableBounds(room.shell.dimensions, room.shell.wallThickness)
  const safeX = Math.max(0, bounds.halfX - GENERATED_NPC_FOOTPRINT)
  const safeZ = Math.max(0, bounds.halfZ - GENERATED_NPC_FOOTPRINT)
  const candidatePositions: [number, number, number][] = [
    [safeX * 0.5, 0, 0],
    [-safeX * 0.5, 0, 0],
    [safeX * 0.5, 0, -safeZ * 0.35],
    [-safeX * 0.5, 0, -safeZ * 0.35],
    [safeX * 0.5, 0, safeZ * 0.35],
    [-safeX * 0.5, 0, safeZ * 0.35],
    [0, 0, -safeZ * 0.45],
    [0, 0, safeZ * 0.45],
  ]

  for (const position of candidatePositions) {
    if (positionCrowdsSpawn(position, room.spawn.position)) continue
    if (positionCrowdsExit(position, room)) continue
    if (positionCrowdsBlockingObject(position, room.objects)) continue
    return position
  }

  return null
}

function positionCrowdsSpawn(
  position: [number, number, number],
  spawn: [number, number, number],
): boolean {
  return distanceXZ(position, spawn) < 1
}

function positionCrowdsExit(position: [number, number, number], room: LoadedRoom): boolean {
  if (room.objects.some((object) => hasExitInteraction(object) && distanceXZ(position, object.position) < 1.5)) {
    return true
  }

  const { width, depth } = room.shell.dimensions
  return room.shell.exits.some((exit) => {
    const halfWidth = exit.width / 2 + 0.5
    switch (exit.side) {
      case 'north':
        return Math.abs(position[0]) <= halfWidth && position[2] < -(depth / 2 - 2)
      case 'south':
        return Math.abs(position[0]) <= halfWidth && position[2] > depth / 2 - 2
      case 'east':
        return Math.abs(position[2]) <= halfWidth && position[0] > width / 2 - 2
      case 'west':
        return Math.abs(position[2]) <= halfWidth && position[0] < -(width / 2 - 2)
      default:
        return false
    }
  })
}

function positionCrowdsBlockingObject(
  position: [number, number, number],
  objects: RoomObject[],
): boolean {
  return objects.some((object) => {
    if (!NPC_BLOCKING_TYPES.has(object.type)) return false
    return distanceXZ(position, object.position) < GENERATED_NPC_FOOTPRINT + objectFootprintRadius(object)
  })
}

function hasExitInteraction(object: RoomObject): boolean {
  return 'interaction' in object && object.interaction != null && object.interaction.exit != null
}

function distanceXZ(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}
