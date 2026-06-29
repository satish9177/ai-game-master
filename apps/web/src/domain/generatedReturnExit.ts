import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'
import {
  type ExitSide,
  positionForSide,
  rotationForSide,
} from './ensureGeneratedExitNavigation'

export type GeneratedExitTarget = {
  parentId: string
  side: ExitSide
}

export type EnsureGeneratedReturnExitResult = {
  room: LoadedRoom
  returnExitEnsured: boolean
}

type ArchObject = Extract<RoomObject, { type: 'arch' }>

export const RETURN_EXIT_ID_INFIX = ':return-exit:'
export const RETURN_EXIT_ARCH_COLOR = '#c084fc'

const RETURN_PROMPT = 'Return to previous room'
const DEFAULT_EXIT_WIDTH = 3
const FALLBACK_SIDES: ExitSide[] = ['south', 'west', 'east', 'north']
const SIDES: ExitSide[] = ['north', 'south', 'east', 'west']

export function isReturnExitObject(object: RoomObject): boolean {
  return typeof object.id === 'string' && object.id.includes(RETURN_EXIT_ID_INFIX)
}

export function parseGeneratedExitTargetId(id: string): GeneratedExitTarget | null {
  const match = /^(.*):exit:(north|south|east|west)$/.exec(id)
  if (!match) return null

  const parentId = match[1]
  const side = match[2] as ExitSide
  if (parentId == null || parentId.trim() === '') return null

  return { parentId, side }
}

export function opposite(side: ExitSide): ExitSide {
  switch (side) {
    case 'north':
      return 'south'
    case 'south':
      return 'north'
    case 'east':
      return 'west'
    case 'west':
      return 'east'
  }
}

export function ensureGeneratedReturnExit(
  room: LoadedRoom,
  parentRoomId: string,
  entrySide: ExitSide,
): EnsureGeneratedReturnExitResult {
  if (hasUsableExitTo(room, parentRoomId)) return { room, returnExitEnsured: true }

  const side = chooseReturnSide(room, opposite(entrySide))
  const shellExits = ensureShellExit(room, side)
  const id = uniqueReturnExitId(room.objects, room.id, side)
  const arch: ArchObject = {
    type: 'arch',
    id,
    position: positionForSide(room, side),
    rotationY: rotationForSide(side),
    scale: 1,
    width: DEFAULT_EXIT_WIDTH,
    height: 3.5,
    color: RETURN_EXIT_ARCH_COLOR,
    interaction: {
      key: 'E',
      prompt: RETURN_PROMPT,
      exit: { toRoomId: parentRoomId },
    },
  }

  return {
    room: {
      ...room,
      shell: { ...room.shell, exits: shellExits },
      objects: [...room.objects, arch],
    },
    returnExitEnsured: true,
  }
}

function hasUsableExitTo(room: LoadedRoom, parentRoomId: string): boolean {
  return room.objects.some((object) => {
    const interaction = 'interaction' in object ? object.interaction : undefined
    return interaction?.exit?.toRoomId === parentRoomId
  })
}

function chooseReturnSide(room: LoadedRoom, preferred: ExitSide): ExitSide {
  const occupied = occupiedExitSides(room)
  if (!occupied.has(preferred)) return preferred

  return FALLBACK_SIDES.find((side) => !occupied.has(side)) ?? preferred
}

function occupiedExitSides(room: LoadedRoom): Set<ExitSide> {
  const occupied = new Set<ExitSide>()

  for (const object of room.objects) {
    const interaction = 'interaction' in object ? object.interaction : undefined
    if (interaction?.exit?.toRoomId == null) continue

    occupied.add(sideForPosition(room, object.position))
  }

  return occupied
}

function sideForPosition(room: LoadedRoom, position: [number, number, number]): ExitSide {
  const [x, , z] = position
  const { width, depth } = room.shell.dimensions
  const distances: Record<ExitSide, number> = {
    north: Math.abs(z + depth / 2),
    south: Math.abs(z - depth / 2),
    east: Math.abs(x - width / 2),
    west: Math.abs(x + width / 2),
  }

  return SIDES.reduce((closest, side) => (
    distances[side] < distances[closest] ? side : closest
  ))
}

function ensureShellExit(
  room: LoadedRoom,
  side: ExitSide,
): LoadedRoom['shell']['exits'] {
  if (room.shell.exits.some((exit) => exit.side === side)) return room.shell.exits
  return [...room.shell.exits, { side, width: DEFAULT_EXIT_WIDTH }]
}

function uniqueReturnExitId(objects: RoomObject[], roomId: string, side: ExitSide): string {
  const ids = new Set(objects.map((object) => object.id).filter((id): id is string => id != null))
  const base = `${roomId}${RETURN_EXIT_ID_INFIX}${side}`
  if (!ids.has(base)) return base
  for (let index = 2; ; index += 1) {
    const candidate = `${base}:${index}`
    if (!ids.has(candidate)) return candidate
  }
}
