import * as THREE from 'three'
import type { GeneratedRoomVisualTheme } from '../../../domain/generatedRoomThemeVocabulary'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import { themedMaterialParameters } from './materialTheme'

/** One of the four room walls. -Z = north, +Z = south, +X = east, -X = west. */
export type WallSide = 'north' | 'south' | 'east' | 'west'

/**
 * Height (meters) of a "cut away" near wall. Tall enough to bound the room's
 * footprint as a low curb, short enough that the fixed isometric camera (looking
 * down ~35°) never lets it hide the player or an NPC standing against it — a
 * dollhouse open side rather than a closed box.
 */
const CUTAWAY_WALL_HEIGHT = 0.4

/** Height of the trim cap that trims a cutaway curb so the open side reads. */
const CURB_TRIM_HEIGHT = 0.08

const SHELL_MATERIAL: Pick<THREE.MeshStandardMaterialParameters, 'roughness' | 'metalness'> = {
  roughness: 0.82,
  metalness: 0.02,
}

/**
 * Legacy/debug helper only.
 * Production visual-pack rooms use registry-resolved modular architecture via
 * buildVisualShellRoom; primitive geometry is never a production visual.
 *
 * Builds the static room shell — floor + four walls — from the RoomSpec.
 * Low-poly: plain flat boxes, one material per mesh so the engine's scene-graph
 * disposal (disposeObject) frees every geometry and material exactly once.
 *
 * Readability touches (renderer-internal, no RoomSpec change): the floor carries
 * subtle darker "seam" lines so distance/scale read from the isometric angle
 * without a debug-grid look, and a cutaway curb gets a lighter trim cap so the
 * open side is legible. The floor receives shadows and the walls cast them, for
 * the key light added in buildLighting.
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
  options: {
    cutawaySides?: readonly WallSide[]
    visualTheme?: GeneratedRoomVisualTheme | null
  } = {},
): THREE.Group {
  const { dimensions, wallThickness, floorColor, wallColor, exits } = room.shell
  const { width, depth, height } = dimensions
  const cutaway = new Set(options.cutawaySides ?? [])
  const visualTheme = options.visualTheme ?? null
  // A cut-away wall drops to a curb (never taller than the room itself).
  const heightFor = (side: WallSide): number =>
    cutaway.has(side) ? Math.min(CUTAWAY_WALL_HEIGHT, height) : height

  const group = new THREE.Group()
  group.name = 'shell'

  // Floor: thin box centered at origin with its top surface at y = 0.
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(width, wallThickness, depth),
    makeShellMaterial(floorColor, {}, visualTheme),
  )
  floor.position.set(0, -wallThickness / 2, 0)
  floor.name = 'floor'
  floor.receiveShadow = true
  group.add(floor)

  addFloorSeams(group, width, depth, floorColor, visualTheme)

  const t = wallThickness
  const halfW = width / 2
  const halfD = depth / 2
  // A lighter shade of the wall colour, used to cap cut-away curbs.
  const trimColor = new THREE.Color(wallColor).lerp(new THREE.Color('#ffffff'), 0.3)

  // North wall (z = -halfD): split into two segments around the exit gap.
  const nh = heightFor('north')
  const northExit = exits.find((e) => e.side === 'north')
  if (northExit) {
    const gap = Math.min(northExit.width, width)
    const segLen = (width - gap) / 2
    if (segLen > 0) {
      const offset = gap / 2 + segLen / 2
      group.add(makeWall(segLen, nh, t, -offset, nh / 2, -halfD, wallColor, visualTheme))
      group.add(makeWall(segLen, nh, t, offset, nh / 2, -halfD, wallColor, visualTheme))
      if (cutaway.has('north')) {
        group.add(makeCurbTrim(segLen, t, -offset, -halfD, nh, trimColor, visualTheme))
        group.add(makeCurbTrim(segLen, t, offset, -halfD, nh, trimColor, visualTheme))
      }
    }
  } else {
    group.add(makeWall(width, nh, t, 0, nh / 2, -halfD, wallColor, visualTheme))
    if (cutaway.has('north')) group.add(makeCurbTrim(width, t, 0, -halfD, nh, trimColor, visualTheme))
  }

  // Every declared exit side receives a centered visible opening.
  addWallWithCenteredExit(group, {
    runsAlongX: true,
    fixedCoordinate: halfD,
    length: width,
    height: heightFor('south'),
    thickness: t,
    exitWidth: exits.find((exit) => exit.side === 'south')?.width,
    cutaway: cutaway.has('south'),
    wallColor,
    trimColor,
    visualTheme,
  })
  addWallWithCenteredExit(group, {
    runsAlongX: false,
    fixedCoordinate: halfW,
    length: depth,
    height: heightFor('east'),
    thickness: t,
    exitWidth: exits.find((exit) => exit.side === 'east')?.width,
    cutaway: cutaway.has('east'),
    wallColor,
    trimColor,
    visualTheme,
  })
  addWallWithCenteredExit(group, {
    runsAlongX: false,
    fixedCoordinate: -halfW,
    length: depth,
    height: heightFor('west'),
    thickness: t,
    exitWidth: exits.find((exit) => exit.side === 'west')?.width,
    cutaway: cutaway.has('west'),
    wallColor,
    trimColor,
    visualTheme,
  })

  return group
}
function addWallWithCenteredExit(
  group: THREE.Group,
  options: Readonly<{
    runsAlongX: boolean
    fixedCoordinate: number
    length: number
    height: number
    thickness: number
    exitWidth?: number
    cutaway: boolean
    wallColor: string
    trimColor: THREE.Color
    visualTheme: GeneratedRoomVisualTheme | null
  }>,
): void {
  const gap = options.exitWidth === undefined
    ? 0
    : Math.min(options.exitWidth, options.length)
  const segmentLength = gap === 0 ? options.length : (options.length - gap) / 2
  if (segmentLength <= 0) return
  const offsets = gap === 0 ? [0] : [
    -(gap / 2 + segmentLength / 2),
    gap / 2 + segmentLength / 2,
  ]

  for (const offset of offsets) {
    const sx = options.runsAlongX ? segmentLength : options.thickness
    const sz = options.runsAlongX ? options.thickness : segmentLength
    const x = options.runsAlongX ? offset : options.fixedCoordinate
    const z = options.runsAlongX ? options.fixedCoordinate : offset
    group.add(makeWall(
      sx,
      options.height,
      sz,
      x,
      options.height / 2,
      z,
      options.wallColor,
      options.visualTheme,
    ))
    if (options.cutaway) {
      group.add(makeCurbTrim(
        sx,
        sz,
        x,
        z,
        options.height,
        options.trimColor,
        options.visualTheme,
      ))
    }
  }
}


function makeWall(
  sx: number,
  sy: number,
  sz: number,
  px: number,
  py: number,
  pz: number,
  color: string,
  visualTheme: GeneratedRoomVisualTheme | null,
): THREE.Mesh {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    makeShellMaterial(color, {}, visualTheme),
  )
  wall.position.set(px, py, pz)
  wall.name = 'wall'
  wall.castShadow = true
  wall.receiveShadow = true
  return wall
}

/**
 * A thin lighter cap sitting on top of a cut-away curb so the open side reads as
 * a deliberate low wall rather than a clipped full wall. Footprint matches the
 * curb (slightly proud on the thin axis); one mesh + one material.
 */
function makeCurbTrim(
  sx: number,
  sz: number,
  px: number,
  pz: number,
  curbHeight: number,
  color: THREE.Color,
  visualTheme: GeneratedRoomVisualTheme | null,
): THREE.Mesh {
  const lip = 0.12 // overhang past the wall thickness so the cap is visible
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(sx + (sx < sz ? lip : 0), CURB_TRIM_HEIGHT, sz + (sz <= sx ? lip : 0)),
    makeShellMaterial(color, {}, visualTheme),
  )
  cap.position.set(px, curbHeight + CURB_TRIM_HEIGHT / 2, pz)
  cap.name = 'curb-trim'
  cap.castShadow = true
  cap.receiveShadow = true
  return cap
}

/**
 * Lays subtle darker "seams" across the floor on a generous grid so the player
 * can read distance and scale from the fixed isometric angle. Low-contrast and
 * wide-spaced (large flagstones), so it reads as stone joints, not a debug grid.
 * Each seam is one thin box with its own material (freed by disposeObject).
 */
function addFloorSeams(
  group: THREE.Group,
  width: number,
  depth: number,
  floorColor: string,
  visualTheme: GeneratedRoomVisualTheme | null,
): void {
  const seamColor = new THREE.Color(floorColor).multiplyScalar(0.7) // slightly darker than floor
  const tile = 2.5 // meters between seams — large flagstones, not a fine lattice
  const seamWidth = 0.06
  const seamHeight = 0.02
  const y = seamHeight / 2 + 0.002 // rest just above the floor's top face (y = 0)
  const inset = 0.4 // keep seams off the very edge / out of the walls

  // Seams running along Z (the joints you cross walking up/down screen).
  for (let x = -width / 2 + tile; x < width / 2 - 0.01; x += tile) {
    group.add(makeSeam(seamWidth, seamHeight, depth - inset * 2, x, y, 0, seamColor, visualTheme))
  }
  // Seams running along X.
  for (let z = -depth / 2 + tile; z < depth / 2 - 0.01; z += tile) {
    group.add(makeSeam(width - inset * 2, seamHeight, seamWidth, 0, y, z, seamColor, visualTheme))
  }
}

function makeSeam(
  sx: number,
  sy: number,
  sz: number,
  px: number,
  py: number,
  pz: number,
  color: THREE.Color,
  visualTheme: GeneratedRoomVisualTheme | null,
): THREE.Mesh {
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    makeShellMaterial(color, { roughness: 0.9, metalness: 0 }, visualTheme),
  )
  seam.position.set(px, py, pz)
  seam.name = 'floor-seam'
  seam.receiveShadow = true
  return seam
}

function makeShellMaterial(
  color: THREE.ColorRepresentation,
  material: Partial<typeof SHELL_MATERIAL> = {},
  visualTheme: GeneratedRoomVisualTheme | null = null,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    ...SHELL_MATERIAL,
    ...themedMaterialParameters(visualTheme, 'shell'),
    ...material,
  })
}
