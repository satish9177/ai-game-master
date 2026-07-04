import {
  classifyObjectImportance,
  computePlayableBounds,
  objectFootprintRadius,
} from './generatedRoomLayout'
import {
  classifyGeneratedCompositionRole,
  COMPOSITION,
  selectGeneratedStoryAnchorIndex,
} from './generatedRoomComposition'
import type { ComposeGeneratedRoomOptions } from './generatedRoomComposition'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

export const MAX_DECORATIVE_PER_SECTOR = 4

const GRID_SIZE = 3
const CENTER_SECTOR = 4
const NORTH_CENTER_SECTOR = 1
const SLOT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-0.25, -0.25],
  [0.25, -0.25],
  [-0.25, 0.25],
  [0.25, 0.25],
]

type ClutterDistributionOptions = Pick<ComposeGeneratedRoomOptions, 'themePack' | 'storyKind'>

type SectorGrid = {
  halfX: number
  halfZ: number
  sectorWidth: number
  sectorDepth: number
}

type MovableEntry = {
  index: number
  obj: RoomObject
  sector: number
}

export function distributeGeneratedClutter(
  room: LoadedRoom,
  options: ClutterDistributionOptions = {},
): LoadedRoom {
  const bounds = computePlayableBounds(room.shell.dimensions, room.shell.wallThickness)
  if (bounds.halfX <= 0 || bounds.halfZ <= 0) return room

  const grid: SectorGrid = {
    halfX: bounds.halfX,
    halfZ: bounds.halfZ,
    sectorWidth: (bounds.halfX * 2) / GRID_SIZE,
    sectorDepth: (bounds.halfZ * 2) / GRID_SIZE,
  }
  if (grid.sectorWidth <= 0 || grid.sectorDepth <= 0) return room

  const anchorIndex = selectGeneratedStoryAnchorIndex(room.objects, options)
  const movable = room.objects
    .map((obj, index): MovableEntry | null => {
      if (!isMovableDecorative(obj, index, anchorIndex)) return null
      return { index, obj, sector: sectorForPosition(obj.position[0], obj.position[2], grid) }
    })
    .filter((entry): entry is MovableEntry => entry !== null)

  if (movable.length === 0) return room

  const occupancy = Array.from({ length: GRID_SIZE * GRID_SIZE }, () => 0)
  const sameTypeOccupancy = Array.from(
    { length: GRID_SIZE * GRID_SIZE },
    () => new Map<RoomObject['type'], number>(),
  )
  const bySector = Array.from({ length: GRID_SIZE * GRID_SIZE }, () => [] as MovableEntry[])

  for (const entry of movable) {
    occupancy[entry.sector]! += 1
    sameTypeOccupancy[entry.sector]!.set(
      entry.obj.type,
      (sameTypeOccupancy[entry.sector]!.get(entry.obj.type) ?? 0) + 1,
    )
    bySector[entry.sector]!.push(entry)
  }

  if (!occupancy.some((count) => count > MAX_DECORATIVE_PER_SECTOR)) return room

  const movedPositions = new Map<number, [number, number]>()

  for (let sourceSector = 0; sourceSector < occupancy.length; sourceSector += 1) {
    if (occupancy[sourceSector]! <= MAX_DECORATIVE_PER_SECTOR) continue

    const overflow = [...bySector[sourceSector]!].sort((a, b) => b.index - a.index)
    for (const entry of overflow) {
      if (occupancy[sourceSector]! <= MAX_DECORATIVE_PER_SECTOR) break

      const target = findTargetSlot(entry.obj, sourceSector, grid, occupancy, sameTypeOccupancy)
      if (target === null) continue

      decrementType(sameTypeOccupancy[sourceSector]!, entry.obj.type)
      occupancy[sourceSector]! -= 1
      occupancy[target.sector]! += 1
      sameTypeOccupancy[target.sector]!.set(
        entry.obj.type,
        (sameTypeOccupancy[target.sector]!.get(entry.obj.type) ?? 0) + 1,
      )
      movedPositions.set(entry.index, [target.x, target.z])
    }
  }

  if (movedPositions.size === 0) return room

  const objects = room.objects.map((obj, index): RoomObject => {
    const moved = movedPositions.get(index)
    if (moved === undefined) return obj
    const [, y] = obj.position
    return { ...obj, position: [moved[0], y, moved[1]] } as RoomObject
  })

  return { ...room, objects }
}

export function generatedClutterSectorForTesting(room: LoadedRoom, obj: RoomObject): number {
  const bounds = computePlayableBounds(room.shell.dimensions, room.shell.wallThickness)
  return sectorForPosition(obj.position[0], obj.position[2], {
    halfX: bounds.halfX,
    halfZ: bounds.halfZ,
    sectorWidth: (bounds.halfX * 2) / GRID_SIZE,
    sectorDepth: (bounds.halfZ * 2) / GRID_SIZE,
  })
}

function isMovableDecorative(obj: RoomObject, index: number, anchorIndex: number): boolean {
  if (index === anchorIndex) return false
  return classifyGeneratedCompositionRole(obj) === 'decorative'
    && classifyObjectImportance(obj) === 'decorative'
}

function findTargetSlot(
  obj: RoomObject,
  sourceSector: number,
  grid: SectorGrid,
  occupancy: number[],
  sameTypeOccupancy: Array<Map<RoomObject['type'], number>>,
): { sector: number; x: number; z: number } | null {
  const ranked = candidateTargetSectors(sourceSector, obj.type, grid, occupancy, sameTypeOccupancy)
  for (const sector of ranked) {
    const slot = firstValidSlot(obj, sector, grid)
    if (slot !== null) return { sector, x: slot.x, z: slot.z }
  }
  return null
}

function candidateTargetSectors(
  sourceSector: number,
  type: RoomObject['type'],
  grid: SectorGrid,
  occupancy: number[],
  sameTypeOccupancy: Array<Map<RoomObject['type'], number>>,
): number[] {
  const sourceCenter = sectorCenter(sourceSector, grid)
  return occupancy
    .map((count, sector) => ({ count, sector }))
    .filter(({ count, sector }) =>
      sector !== sourceSector
      && sector !== CENTER_SECTOR
      && sector !== NORTH_CENTER_SECTOR
      && count < MAX_DECORATIVE_PER_SECTOR)
    .map(({ sector }) => {
      const center = sectorCenter(sector, grid)
      return {
        sector,
        distance: Math.hypot(center.x - sourceCenter.x, center.z - sourceCenter.z),
        sameTypeCount: sameTypeOccupancy[sector]!.get(type) ?? 0,
      }
    })
    .sort((a, b) =>
      a.distance - b.distance
      || a.sameTypeCount - b.sameTypeCount
      || a.sector - b.sector)
    .map(({ sector }) => sector)
}

function firstValidSlot(
  obj: RoomObject,
  sector: number,
  grid: SectorGrid,
): { x: number; z: number } | null {
  const center = sectorCenter(sector, grid)
  const radius = objectFootprintRadius(obj)
  const safeX = Math.max(0, grid.halfX - radius)
  const safeZ = Math.max(0, grid.halfZ - radius)

  for (const [xFrac, zFrac] of SLOT_OFFSETS) {
    const x = halfClamp(center.x + xFrac * grid.sectorWidth, safeX)
    const z = halfClamp(center.z + zFrac * grid.sectorDepth, safeZ)
    if (Math.abs(x) < COMPOSITION.CORRIDOR_HALF) continue
    if (sectorForPosition(x, z, grid) !== sector) continue
    return { x, z }
  }

  return null
}

function sectorForPosition(x: number, z: number, grid: SectorGrid): number {
  const col = clampedIndex(Math.floor((x + grid.halfX) / grid.sectorWidth))
  const row = clampedIndex(Math.floor((z + grid.halfZ) / grid.sectorDepth))
  return row * GRID_SIZE + col
}

function sectorCenter(sector: number, grid: SectorGrid): { x: number; z: number } {
  const row = Math.floor(sector / GRID_SIZE)
  const col = sector % GRID_SIZE
  return {
    x: -grid.halfX + grid.sectorWidth * (col + 0.5),
    z: -grid.halfZ + grid.sectorDepth * (row + 0.5),
  }
}

function clampedIndex(value: number): number {
  return Math.min(Math.max(value, 0), GRID_SIZE - 1)
}

function decrementType(counts: Map<RoomObject['type'], number>, type: RoomObject['type']): void {
  const next = (counts.get(type) ?? 0) - 1
  if (next <= 0) {
    counts.delete(type)
  } else {
    counts.set(type, next)
  }
}

function halfClamp(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(Math.max(value, -max), max)
}
