import * as THREE from 'three'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'

/** One of the four room walls. -Z = north, +Z = south, +X = east, -X = west. */
export type WallSide = 'north' | 'south' | 'east' | 'west'

/**
 * Height (meters) of a "cut away" near wall. Tall enough to bound the room's
 * footprint as a low curb, short enough that the fixed isometric camera (looking
 * down ~35°) never lets it hide the player or an NPC standing against it — a
 * dollhouse open side rather than a closed box.
 */
const CUTAWAY_WALL_HEIGHT = 0.4

/**
 * Builds the static room shell — floor + four walls — from the RoomSpec.
 * Low-poly: plain flat boxes, one material per mesh so the engine's scene-graph
 * disposal (disposeObject) frees every geometry and material exactly once.
 *
 * Conventions: Y-up, meters, -Z = north. The north wall is split around any
 * `exits` entry on the north side to leave a walkable gap.
 *
 * `cutawaySides` lists walls to render at a low curb height instead of full
 * height — the walls between the fixed isometric camera and the room interior,
 * so they don't hide the player. Default (none) renders a fully enclosed box.
 */
export function buildShell(
  room: LoadedRoom,
  options: { cutawaySides?: readonly WallSide[] } = {},
): THREE.Group {
  const { dimensions, wallThickness, floorColor, wallColor, exits } = room.shell
  const { width, depth, height } = dimensions
  const cutaway = new Set(options.cutawaySides ?? [])
  // A cut-away wall drops to a curb (never taller than the room itself).
  const heightFor = (side: WallSide): number =>
    cutaway.has(side) ? Math.min(CUTAWAY_WALL_HEIGHT, height) : height

  const group = new THREE.Group()
  group.name = 'shell'

  // Floor: thin box centered at origin with its top surface at y = 0.
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(width, wallThickness, depth),
    new THREE.MeshStandardMaterial({ color: floorColor }),
  )
  floor.position.set(0, -wallThickness / 2, 0)
  group.add(floor)

  const t = wallThickness
  const halfW = width / 2
  const halfD = depth / 2

  // North wall (z = -halfD): split into two segments around the exit gap.
  const nh = heightFor('north')
  const northExit = exits.find((e) => e.side === 'north')
  if (northExit) {
    const gap = Math.min(northExit.width, width)
    const segLen = (width - gap) / 2
    if (segLen > 0) {
      const offset = gap / 2 + segLen / 2
      group.add(makeWall(segLen, nh, t, -offset, nh / 2, -halfD, wallColor))
      group.add(makeWall(segLen, nh, t, offset, nh / 2, -halfD, wallColor))
    }
  } else {
    group.add(makeWall(width, nh, t, 0, nh / 2, -halfD, wallColor))
  }

  // South wall (z = +halfD).
  const sh = heightFor('south')
  group.add(makeWall(width, sh, t, 0, sh / 2, halfD, wallColor))
  // East wall (x = +halfW) and west wall (x = -halfW), running along Z.
  const eh = heightFor('east')
  group.add(makeWall(t, eh, depth, halfW, eh / 2, 0, wallColor))
  const wh = heightFor('west')
  group.add(makeWall(t, wh, depth, -halfW, wh / 2, 0, wallColor))

  return group
}

function makeWall(
  sx: number,
  sy: number,
  sz: number,
  px: number,
  py: number,
  pz: number,
  color: string,
): THREE.Mesh {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color }),
  )
  wall.position.set(px, py, pz)
  return wall
}
