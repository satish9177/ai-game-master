import { computePlayableBounds, objectFootprintRadius } from './generatedRoomLayout'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

export type EnsureGeneratedNpcPresenceOptions = {
  requested: boolean
}

export type EnsureGeneratedNpcPresenceResult = {
  room: LoadedRoom
  npcInserted: boolean
}

type NpcObject = Extract<RoomObject, { type: 'npc' }>

const GENERATED_NPC_BASE_ID = 'generated-npc'
const GENERATED_NPC_NAME = 'Mira'
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

const NPC_TEMPLATE: Omit<NpcObject, 'id' | 'position'> = {
  type: 'npc',
  name: GENERATED_NPC_NAME,
  color: GENERATED_NPC_COLOR,
  rotationY: 0,
  scale: 1,
  interaction: {
    key: 'F',
    prompt: `Press F to talk to ${GENERATED_NPC_NAME}`,
    body: `${GENERATED_NPC_NAME} keeps watch, ready to answer quietly.`,
    dialogue: {
      persona: 'generated-room-guide',
      greeting: `Stay close. I am ${GENERATED_NPC_NAME}.`,
      prompts: [
        { id: 'ask-room', label: 'What do you notice here?' },
        { id: 'ask-help', label: 'Can you help me?' },
      ],
    },
  },
}

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
    ...NPC_TEMPLATE,
    id: nextNpcId(room.objects),
    position,
  }

  return {
    room: { ...room, objects: [...room.objects, npc] },
    npcInserted: true,
  }
}

function nextNpcId(objects: RoomObject[]): string {
  const ids = new Set(objects.map((object) => object.id).filter((id): id is string => id != null))
  if (!ids.has(GENERATED_NPC_BASE_ID)) return GENERATED_NPC_BASE_ID
  for (let index = 2; ; index += 1) {
    const candidate = `${GENERATED_NPC_BASE_ID}-${index}`
    if (!ids.has(candidate)) return candidate
  }
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
