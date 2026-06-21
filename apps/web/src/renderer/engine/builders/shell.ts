import * as THREE from 'three'
import type { LoadedRoom } from '../../../roomspec/schema'

/**
 * Builds the static room shell — floor + four walls — from the RoomSpec.
 * Low-poly: plain flat boxes, one material per mesh so the engine's scene-graph
 * disposal (disposeObject) frees every geometry and material exactly once.
 *
 * Conventions: Y-up, meters, -Z = north. The north wall is split around any
 * `exits` entry on the north side to leave a walkable gap.
 */
export function buildShell(room: LoadedRoom): THREE.Group {
  const { dimensions, wallThickness, floorColor, wallColor, exits } = room.shell
  const { width, depth, height } = dimensions

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
  const northExit = exits.find((e) => e.side === 'north')
  if (northExit) {
    const gap = Math.min(northExit.width, width)
    const segLen = (width - gap) / 2
    if (segLen > 0) {
      const offset = gap / 2 + segLen / 2
      group.add(makeWall(segLen, height, t, -offset, height / 2, -halfD, wallColor))
      group.add(makeWall(segLen, height, t, offset, height / 2, -halfD, wallColor))
    }
  } else {
    group.add(makeWall(width, height, t, 0, height / 2, -halfD, wallColor))
  }

  // South wall (z = +halfD).
  group.add(makeWall(width, height, t, 0, height / 2, halfD, wallColor))
  // East wall (x = +halfW) and west wall (x = -halfW), running along Z.
  group.add(makeWall(t, height, depth, halfW, height / 2, 0, wallColor))
  group.add(makeWall(t, height, depth, -halfW, height / 2, 0, wallColor))

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
