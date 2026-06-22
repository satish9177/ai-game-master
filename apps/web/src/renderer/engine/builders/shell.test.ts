import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildShell } from './shell'
import type { WallSide } from './shell'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'

/**
 * Geometry-only test (no WebGL): builds the shell and inspects wall heights. The
 * cutaway lowers exactly the requested near walls to a curb and leaves the rest
 * full height, so the isometric camera can see over the open sides.
 */

const WIDTH = 10
const DEPTH = 8
const HEIGHT = 4

/** Minimal room: buildShell only reads `room.shell`. */
function room(): LoadedRoom {
  return {
    shell: {
      dimensions: { width: WIDTH, depth: DEPTH, height: HEIGHT },
      wallThickness: 0.2,
      floorColor: '#444',
      wallColor: '#888',
      exits: [],
    },
  } as unknown as LoadedRoom
}

/** The walls are every mesh sitting above the floor (the floor centers below y=0). */
function wallMeshes(group: THREE.Group): THREE.Mesh[] {
  return group.children.filter(
    (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.position.y > 0,
  )
}

/** Vertical size of a wall mesh (its BoxGeometry height parameter). */
function wallHeight(mesh: THREE.Mesh): number {
  return (mesh.geometry as THREE.BoxGeometry).parameters.height
}

/** Height of the single wall on the given side, by its position. */
function heightOnSide(group: THREE.Group, side: WallSide): number {
  const walls = wallMeshes(group)
  const pick: Record<WallSide, (m: THREE.Mesh) => boolean> = {
    south: (m) => m.position.z > 0.5,
    north: (m) => m.position.z < -0.5,
    east: (m) => m.position.x > 0.5,
    west: (m) => m.position.x < -0.5,
  }
  const wall = walls.find(pick[side])
  if (!wall) throw new Error(`no ${side} wall`)
  return wallHeight(wall)
}

describe('buildShell cutaway', () => {
  it('renders a fully enclosed box by default (all walls full height)', () => {
    const g = buildShell(room())
    for (const side of ['north', 'south', 'east', 'west'] as const) {
      expect(heightOnSide(g, side)).toBeCloseTo(HEIGHT)
    }
  })

  it('lowers only the requested near walls to a curb', () => {
    const g = buildShell(room(), { cutawaySides: ['south', 'east'] })
    // Near walls (between an iso camera at +X/+Z and the interior) become curbs…
    expect(heightOnSide(g, 'south')).toBeCloseTo(0.4)
    expect(heightOnSide(g, 'east')).toBeCloseTo(0.4)
    // …while the far walls keep full height to show the room boundary.
    expect(heightOnSide(g, 'north')).toBeCloseTo(HEIGHT)
    expect(heightOnSide(g, 'west')).toBeCloseTo(HEIGHT)
  })

  it('never makes a curb taller than the room itself', () => {
    const low = {
      shell: {
        dimensions: { width: WIDTH, depth: DEPTH, height: 0.25 },
        wallThickness: 0.2,
        floorColor: '#444',
        wallColor: '#888',
        exits: [],
      },
    } as unknown as LoadedRoom
    expect(heightOnSide(buildShell(low, { cutawaySides: ['south'] }), 'south')).toBeCloseTo(0.25)
  })
})
