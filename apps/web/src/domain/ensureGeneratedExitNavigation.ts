import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

export type EnsureGeneratedExitNavigationResult = {
  room: LoadedRoom
  exitNavigationEnsured: boolean
}

export type ExitSide = LoadedRoom['shell']['exits'][number]['side']
type ArchObject = Extract<RoomObject, { type: 'arch' }>

const EXIT_PROMPT = 'Enter next room'
const DEFAULT_EXIT_WIDTH = 3
const SIDES: ExitSide[] = ['north', 'south', 'east', 'west']

export function buildGeneratedExitTargetId(roomId: string, side: ExitSide): string {
  return `${roomId}:exit:${side}`
}

export function ensureGeneratedExitNavigation(
  room: LoadedRoom,
): EnsureGeneratedExitNavigationResult {
  if (hasUsableExit(room)) return { room, exitNavigationEnsured: true }

  const side = chooseExitSide(room)
  const shellExits = ensureShellExit(room, side)
  const toRoomId = buildGeneratedExitTargetId(room.id, side)
  const id = uniqueExitId(room.objects, room.id, side)
  const existingArchIndex = room.objects.findIndex((object) => object.type === 'arch')

  if (existingArchIndex >= 0) {
    const objects = room.objects.map((object, index) => {
      if (index !== existingArchIndex || object.type !== 'arch') return object
      return makeNavigableArch(object, id, side, room, toRoomId)
    })
    return {
      room: {
        ...room,
        shell: { ...room.shell, exits: shellExits },
        objects,
      },
      exitNavigationEnsured: true,
    }
  }

  const arch: ArchObject = {
    type: 'arch',
    id,
    position: positionForSide(room, side),
    rotationY: rotationForSide(side),
    scale: 1,
    width: DEFAULT_EXIT_WIDTH,
    height: 3.5,
    color: '#9a9488',
    interaction: {
      key: 'E',
      prompt: EXIT_PROMPT,
      exit: { toRoomId },
    },
  }

  return {
    room: {
      ...room,
      shell: { ...room.shell, exits: shellExits },
      objects: [...room.objects, arch],
    },
    exitNavigationEnsured: true,
  }
}

function hasUsableExit(room: LoadedRoom): boolean {
  return room.objects.some((object) => {
    const id = object.id
    const interaction = 'interaction' in object ? object.interaction : undefined
    return (
      typeof id === 'string' &&
      id.trim() !== '' &&
      interaction?.exit?.toRoomId != null &&
      interaction.exit.toRoomId.trim() !== ''
    )
  })
}

function chooseExitSide(room: LoadedRoom): ExitSide {
  const existing = room.shell.exits.find((exit) => SIDES.includes(exit.side))
  return existing?.side ?? 'north'
}

function ensureShellExit(
  room: LoadedRoom,
  side: ExitSide,
): LoadedRoom['shell']['exits'] {
  if (room.shell.exits.some((exit) => exit.side === side)) return room.shell.exits
  return [...room.shell.exits, { side, width: DEFAULT_EXIT_WIDTH }]
}

function makeNavigableArch(
  arch: ArchObject,
  id: string,
  side: ExitSide,
  room: LoadedRoom,
  toRoomId: string,
): ArchObject {
  return {
    ...arch,
    id,
    position: positionForSide(room, side),
    rotationY: rotationForSide(side),
    interaction: {
      key: 'E',
      prompt: EXIT_PROMPT,
      exit: { toRoomId },
    },
  }
}

function uniqueExitId(objects: RoomObject[], roomId: string, side: ExitSide): string {
  const ids = new Set(objects.map((object) => object.id).filter((id): id is string => id != null))
  const base = `${roomId}:generated-exit:${side}`
  if (!ids.has(base)) return base
  for (let index = 2; ; index += 1) {
    const candidate = `${base}:${index}`
    if (!ids.has(candidate)) return candidate
  }
}

export function positionForSide(room: LoadedRoom, side: ExitSide): [number, number, number] {
  const { width, depth } = room.shell.dimensions
  switch (side) {
    case 'south':
      return [0, 0, depth / 2]
    case 'east':
      return [width / 2, 0, 0]
    case 'west':
      return [-width / 2, 0, 0]
    case 'north':
    default:
      return [0, 0, -depth / 2]
  }
}

export function rotationForSide(side: ExitSide): number {
  switch (side) {
    case 'south':
      return 180
    case 'east':
      return 90
    case 'west':
      return -90
    case 'north':
    default:
      return 0
  }
}
