import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildShell } from './shell'
import type { WallSide } from './shell'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'

/**
 * Geometry-only test (no WebGL): builds the shell and inspects it. Covers the
 * cutaway curb heights, the readability touches (floor seams + curb trim), and
 * the shadow flags. Meshes are identified by `name` so seams/trim never get
 * mistaken for walls.
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
      floorColor: '#444444',
      wallColor: '#888888',
      exits: [],
    },
  } as unknown as LoadedRoom
}

function meshesNamed(group: THREE.Group, name: string): THREE.Mesh[] {
  return group.children.filter(
    (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name === name,
  )
}

/** Vertical size of a wall mesh (its BoxGeometry height parameter). */
function wallHeight(mesh: THREE.Mesh): number {
  return (mesh.geometry as THREE.BoxGeometry).parameters.height
}

function standardMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  if (Array.isArray(mesh.material) || !(mesh.material instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`expected standard material on ${mesh.name}`)
  }
  return mesh.material
}

/** Height of the single wall on the given side, by its position. */
function heightOnSide(group: THREE.Group, side: WallSide): number {
  const walls = meshesNamed(group, 'wall')
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
        floorColor: '#444444',
        wallColor: '#888888',
        exits: [],
      },
    } as unknown as LoadedRoom
    expect(heightOnSide(buildShell(low, { cutawaySides: ['south'] }), 'south')).toBeCloseTo(0.25)
  })
})

describe('buildShell readability', () => {
  it('keeps shell colors from the spec while giving shell surfaces subtle material response', () => {
    const g = buildShell(room(), { cutawaySides: ['south'] })
    const [floor] = meshesNamed(g, 'floor')
    const [wall] = meshesNamed(g, 'wall')
    if (!floor || !wall) throw new Error('expected floor and wall meshes')

    const floorMaterial = standardMaterial(floor)
    expect(floorMaterial.color.getHexString()).toBe('444444')
    expect(floorMaterial.roughness).toBeCloseTo(0.82)
    expect(floorMaterial.metalness).toBeCloseTo(0.02)

    const wallMaterial = standardMaterial(wall)
    expect(wallMaterial.color.getHexString()).toBe('888888')
    expect(wallMaterial.roughness).toBeCloseTo(0.82)
    expect(wallMaterial.metalness).toBeCloseTo(0.02)
  })

  it('applies a themed shell finish without changing shell colors', () => {
    const g = buildShell(room(), { visualTheme: 'post-apoc' })
    const [floor] = meshesNamed(g, 'floor')
    const [wall] = meshesNamed(g, 'wall')
    if (!floor || !wall) throw new Error('expected floor and wall meshes')

    const floorMaterial = standardMaterial(floor)
    expect(floorMaterial.color.getHexString()).toBe('444444')
    expect(floorMaterial.roughness).toBeCloseTo(0.9)
    expect(floorMaterial.metalness).toBeCloseTo(0.08)

    const wallMaterial = standardMaterial(wall)
    expect(wallMaterial.color.getHexString()).toBe('888888')
    expect(wallMaterial.roughness).toBeCloseTo(0.9)
    expect(wallMaterial.metalness).toBeCloseTo(0.08)
  })

  it('lays subtle floor seams that sit flush on the floor (not a tall grid)', () => {
    const seams = meshesNamed(buildShell(room()), 'floor-seam')
    expect(seams.length).toBeGreaterThan(0)
    for (const seam of seams) {
      expect(seam.position.y).toBeLessThan(0.05) // just above the floor (y = 0)
      expect(wallHeight(seam)).toBeLessThan(0.05) // thin — a joint line, not a wall
      expect(standardMaterial(seam).roughness).toBeCloseTo(0.9)
    }
  })

  it('caps every cutaway curb with trim and leaves a closed box untrimmed', () => {
    const open = buildShell(room(), { cutawaySides: ['south', 'east'] })
    const trims = meshesNamed(open, 'curb-trim')
    expect(trims).toHaveLength(2) // one per cutaway side
    for (const trim of trims) {
      // The trim sits on top of the 0.4 m curb, well below the full wall height.
      expect(trim.position.y).toBeGreaterThan(0.4)
      expect(trim.position.y).toBeLessThan(1)
    }
    expect(meshesNamed(buildShell(room()), 'curb-trim')).toHaveLength(0)
  })
})

describe('buildShell shadows', () => {
  it('makes the floor receive shadows and the walls cast them', () => {
    const g = buildShell(room(), { cutawaySides: ['south'] })
    const [floor] = meshesNamed(g, 'floor')
    expect(floor?.receiveShadow).toBe(true)
    for (const wall of meshesNamed(g, 'wall')) {
      expect(wall.castShadow).toBe(true)
    }
  })
})
