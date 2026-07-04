import {
  classifyObjectImportance,
  computePlayableBounds,
  objectFootprintRadius,
} from './generatedRoomLayout'
import { selectGeneratedStoryAnchorIndex } from './generatedRoomComposition'
import type { ComposeGeneratedRoomOptions } from './generatedRoomComposition'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

export const MAX_SEPARATION_PASSES = 4
export const EPS = 0.01

type PositionedObject = {
  index: number
  obj: RoomObject
  radius: number
  x: number
  z: number
  frozen: boolean
}

type SeparationOptions = Pick<ComposeGeneratedRoomOptions, 'themePack' | 'storyKind'>

export function separateGeneratedObjects(
  room: LoadedRoom,
  options: SeparationOptions = {},
): LoadedRoom {
  if (room.objects.length < 2) return room

  const bounds = computePlayableBounds(room.shell.dimensions, room.shell.wallThickness)
  const anchorIndex = selectGeneratedStoryAnchorIndex(room.objects, options)
  const positioned = room.objects.map((obj, index): PositionedObject => ({
    index,
    obj,
    radius: objectFootprintRadius(obj),
    x: obj.position[0],
    z: obj.position[2],
    frozen: isFrozenObject(obj) || index === anchorIndex,
  }))
  const movableOrder = positioned
    .filter((entry) => !entry.frozen)
    .sort(compareMovableEntries)

  if (movableOrder.length === 0) return room

  let moved = false
  for (let pass = 0; pass < MAX_SEPARATION_PASSES; pass += 1) {
    let movedThisPass = false
    const placed = positioned.filter((entry) => entry.frozen)

    for (const entry of movableOrder) {
      for (const blocker of placed) {
        const move = separationMove(entry, blocker)
        if (move === null) continue

        entry.x = halfClamp(entry.x + move.dx, Math.max(0, bounds.halfX - entry.radius))
        entry.z = halfClamp(entry.z + move.dz, Math.max(0, bounds.halfZ - entry.radius))
        moved = true
        movedThisPass = true
      }
      placed.push(entry)
    }

    if (!movedThisPass) break
  }

  if (!moved) return room

  const repairedObjects = positioned
    .sort((a, b) => a.index - b.index)
    .map((entry): RoomObject => {
      const [x, y, z] = entry.obj.position
      if (entry.x === x && entry.z === z) return entry.obj
      return { ...entry.obj, position: [entry.x, y, entry.z] } as RoomObject
    })

  return { ...room, objects: repairedObjects }
}

export function objectFootprintsOverlap(a: RoomObject, b: RoomObject): boolean {
  return footprintOverlap(
    a.position[0],
    a.position[2],
    objectFootprintRadius(a),
    b.position[0],
    b.position[2],
    objectFootprintRadius(b),
  )
}

function separationMove(
  entry: PositionedObject,
  blocker: PositionedObject,
): { dx: number; dz: number } | null {
  const dx = entry.x - blocker.x
  const dz = entry.z - blocker.z
  const dist = Math.hypot(dx, dz)
  const minDist = entry.radius + blocker.radius
  if (!footprintOverlap(entry.x, entry.z, entry.radius, blocker.x, blocker.z, blocker.radius)) {
    return null
  }

  const push = minDist - dist + EPS
  if (dist === 0) {
    const fallback = fallbackDirection(entry.index, blocker.index)
    return { dx: fallback.dx * push, dz: fallback.dz * push }
  }

  return { dx: (dx / dist) * push, dz: (dz / dist) * push }
}

function footprintOverlap(
  ax: number,
  az: number,
  ar: number,
  bx: number,
  bz: number,
  br: number,
): boolean {
  return Math.hypot(ax - bx, az - bz) < ar + br - EPS
}

function isFrozenObject(obj: RoomObject): boolean {
  return hasExitInteraction(obj) || obj.type === 'torch'
}

function hasExitInteraction(obj: RoomObject): boolean {
  return 'interaction' in obj && obj.interaction != null && obj.interaction.exit != null
}

function compareMovableEntries(a: PositionedObject, b: PositionedObject): number {
  return priorityRank(b.obj) - priorityRank(a.obj)
    || b.radius - a.radius
    || a.index - b.index
}

function priorityRank(obj: RoomObject): number {
  switch (classifyObjectImportance(obj)) {
    case 'critical':
      return 3
    case 'structural':
      return 2
    case 'decorative':
      return 1
  }
}

function fallbackDirection(
  entryIndex: number,
  blockerIndex: number,
): { dx: number; dz: number } {
  if (entryIndex === blockerIndex) return { dx: 1, dz: 0 }
  return entryIndex > blockerIndex ? { dx: 1, dz: 0 } : { dx: 0, dz: 1 }
}

function halfClamp(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(Math.max(value, -max), max)
}
