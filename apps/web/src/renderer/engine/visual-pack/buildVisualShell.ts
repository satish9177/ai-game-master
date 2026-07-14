import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import type { RoomObject } from '../../../domain/roomSpec'
import type { ObjectCondition } from '../../../domain/visuals/contracts'
import type { WallSide } from '../builders/shell'

const FLOOR_MODULE_SIZE = 4
const WALL_MODULE_LENGTH = 3.5
const CUTAWAY_HEIGHT = 0.4

/**
 * Projects a validated room envelope into trusted semantic architecture.
 * These records are renderer-owned and still pass through the closed visual
 * pack registry; generated content can never select an asset or bundle path.
 */
export function buildVisualShellRoom(
  room: LoadedRoom,
  cutawaySides: readonly WallSide[] = [],
): LoadedRoom {
  const objects: RoomObject[] = []
  const { width, depth, height } = room.shell.dimensions
  const cutaway = new Set(cutawaySides)

  addFloorModules(objects, room, width, depth)
  addWallModules(objects, room, 'north', width, -depth / 2, height, cutaway)
  addWallModules(objects, room, 'south', width, depth / 2, height, cutaway)
  addWallModules(objects, room, 'east', depth, width / 2, height, cutaway)
  addWallModules(objects, room, 'west', depth, -width / 2, height, cutaway)

  return { ...room, objects }
}

function addFloorModules(
  objects: RoomObject[],
  room: LoadedRoom,
  width: number,
  depth: number,
): void {
  const xSegments = partition(width, FLOOR_MODULE_SIZE)
  const zSegments = partition(depth, FLOOR_MODULE_SIZE)
  for (const x of xSegments) {
    for (const z of zSegments) {
      objects.push({
        type: 'architecture',
        kind: 'floor-section',
        size: [x.length, Math.max(0.08, room.shell.wallThickness / 2), z.length],
        color: room.shell.floorColor,
        accentColor: room.shell.wallColor,
        condition: shellCondition(room),
        position: [x.center, -0.08, z.center],
        rotationY: 0,
        scale: 1,
      })
    }
  }
}

function addWallModules(
  objects: RoomObject[],
  room: LoadedRoom,
  side: WallSide,
  length: number,
  fixedCoordinate: number,
  fullHeight: number,
  cutaway: ReadonlySet<WallSide>,
): void {
  const exitWidth = Math.min(
    room.shell.exits.find((exit) => exit.side === side)?.width ?? 0,
    length,
  )
  const ranges = exitWidth === 0
    ? [{ start: -length / 2, length }]
    : [
        { start: -length / 2, length: (length - exitWidth) / 2 },
        { start: exitWidth / 2, length: (length - exitWidth) / 2 },
      ]
  const wallHeight = cutaway.has(side) ? Math.min(CUTAWAY_HEIGHT, fullHeight) : fullHeight
  const kind = cutaway.has(side) ? 'wall-ruined' as const : 'wall-straight' as const

  for (const range of ranges) {
    for (const segment of partitionRange(range.start, range.length, WALL_MODULE_LENGTH)) {
      const runsAlongX = side === 'north' || side === 'south'
      objects.push({
        type: 'architecture',
        kind,
        size: [segment.length, wallHeight, room.shell.wallThickness],
        color: room.shell.wallColor,
        accentColor: room.shell.floorColor,
        condition: shellCondition(room),
        position: runsAlongX
          ? [segment.center, 0, fixedCoordinate]
          : [fixedCoordinate, 0, segment.center],
        rotationY: runsAlongX ? 0 : 90,
        scale: 1,
      })
    }
  }
}

function shellCondition(room: LoadedRoom): ObjectCondition {
  switch (room.environmentKind) {
    case 'ruins':
      return 'damaged'
    case 'forest-edge':
      return 'overgrown'
    case 'crypt':
    case 'dungeon':
      return 'weathered'
    default:
      return 'intact'
  }
}

function partition(total: number, maximum: number): { center: number; length: number }[] {
  return partitionRange(-total / 2, total, maximum)
}

function partitionRange(
  start: number,
  total: number,
  maximum: number,
): { center: number; length: number }[] {
  if (total <= 0) return []
  const count = Math.max(1, Math.ceil(total / maximum))
  const length = total / count
  return Array.from({ length: count }, (_, index) => ({
    center: start + length * (index + 0.5),
    length,
  }))
}
