import * as THREE from 'three'
import type { GeneratedRoomVisualTheme } from '../../../domain/generatedRoomThemeVocabulary'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import type { RoomObject } from '../../../domain/roomSpec'
import {
  affordanceForInteractableObject,
  type Affordance,
} from '../../../domain/ports/interaction'
import { isReturnExitObject } from '../../../domain/generatedReturnExit'
import type { Logger } from '../../../platform/logger/Logger'
import { buildGroundRing } from './indicators'
import { buildBook, buildMap, buildPaper } from './documents'
import { buildBarrel, buildBarricade, buildCrate, buildDebris } from './postApocProps'
import { buildChest, buildCorpse, buildTable } from './practicalProps'
import { buildAltar, buildStatue } from './storyAnchors'
import { buildArtifact, buildCandle, buildMachine } from './strangeDevices'
import { buildHumanoid } from './parts/humanoid'
import {
  makeThemedStandardMaterial,
  themedEmissiveColor,
} from './materialTheme'

/**
 * Builds the room's props from RoomSpec objects via a type-to-builder registry.
 *
 * Safety contract: every valid schema type has a trusted builder. Any defensive
 * registry miss and every unknown/malformed object in `room.skipped` render as
 * the same bounded mystery marker, so unsupported content stays visible without
 * exposing its raw content or becoming interactive.
 *
 * Conventions: Y-up, meters, -Z = north, rotationY in degrees. Each builder
 * constructs its prop resting on the local floor plane (y=0); one material per
 * mesh so disposeObject frees every geometry/material exactly once.
 */
export function buildObjects(
  room: LoadedRoom,
  logger: Logger,
  resolvedObjectIds?: ReadonlySet<string>,
  visualTheme: GeneratedRoomVisualTheme | null = null,
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'objects'

  for (const obj of room.objects) {
    const node = buildKnownObject(obj, logger, visualTheme)
    // Generic tag on the top-level object node only (never siblings like the
    // indicator ring below), so later engine code can find built objects by
    // type/id without special-casing any one object type.
    node.userData.objectType = obj.type
    if (obj.id !== undefined) node.userData.objectId = obj.id
    applyTransform(node, obj.position, obj.rotationY, obj.scale)
    enableShadows(node)
    group.add(node)
    // Objects carrying an interaction get a static floor indicator so they're
    // discoverable from the isometric view. Driven purely by existing RoomSpec
    // interaction data; the engine's proximity/open logic is unchanged.
    const affordance = affordanceForInteractableObject(obj)
    if (affordance) {
      const ringColor = isReturnExitObject(obj)
        ? RETURN_EXIT_RING_COLOR
        : AFFORDANCE_RING_COLOR[affordance] ?? AFFORDANCE_RING_COLOR.inspect
      const resolved = obj.id !== undefined && resolvedObjectIds?.has(obj.id) === true
      const indicator = buildInteractableIndicator(obj.position, ringColor, resolved)
      if (obj.id !== undefined) indicator.userData.forObjectId = obj.id
      group.add(indicator)
    }
  }

  // Unknown/malformed objects the loader skipped — mystery marker, never crash.
  for (const item of room.skipped) {
    const node = buildMysteryMarker()
    applyTransform(node, readPosition(item.raw), 0, 1)
    enableShadows(node)
    group.add(node)
  }

  return group
}

type Vec3 = [number, number, number]
type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>
type ObjectBuilder<K extends RoomObject['type']> = (
  obj: ObjectOf<K>,
  visualTheme: GeneratedRoomVisualTheme | null,
) => THREE.Object3D
type ObjectBuilderRegistry = { [K in RoomObject['type']]: ObjectBuilder<K> }

// Adding a RoomObject type without a trusted builder is a compile error.
const registry = {
  throne: buildThrone,
  pillar: buildPillar,
  rug: buildRug,
  torch: buildTorch,
  arch: buildArch,
  scroll: buildScroll,
  book: buildBook,
  paper: buildPaper,
  map: buildMap,
  chest: buildChest,
  corpse: buildCorpse,
  table: buildTable,
  altar: buildAltar,
  statue: buildStatue,
  machine: buildMachine,
  artifact: buildArtifact,
  candle: buildCandle,
  npc: buildNpc,
  prop: buildProp,
  crate: buildCrate,
  barrel: buildBarrel,
  debris: buildDebris,
  barricade: buildBarricade,
  architecture: buildArchitecture,
  furniture: buildFurniture,
  clutter: buildClutter,
  vegetation: buildVegetation,
  'light-fixture': buildLightFixture,
  zombie: buildZombie,
} satisfies ObjectBuilderRegistry

function buildKnownObject(
  obj: RoomObject,
  logger: Logger,
  visualTheme: GeneratedRoomVisualTheme | null,
): THREE.Object3D {
  const builder = (
    registry as Record<
      string,
      ((o: RoomObject, visualTheme: GeneratedRoomVisualTheme | null) => THREE.Object3D) | undefined
    >
  )[obj.type]
  if (!builder) {
    logger.warn('no builder for object type — rendering mystery marker', {
      objectType: obj.type,
    })
    return buildMysteryMarker()
  }
  return builder(obj, visualTheme)
}

/* ---------- builders ---------- */

function buildThrone(
  obj: ObjectOf<'throne'>,
  visualTheme: GeneratedRoomVisualTheme | null,
): THREE.Object3D {
  // Faces -Z by default; the example's rotationY=180 turns it to face the room.
  const g = new THREE.Group()
  g.add(box(2, 0.3, 1.6, 0, 0.15, 0, obj.color, visualTheme, 'focalAnchor')) // base
  g.add(box(1.6, 0.3, 1.4, 0, 0.6, 0, obj.color, visualTheme, 'focalAnchor')) // seat
  g.add(box(1.6, 2, 0.3, 0, 1.6, 0.55, obj.color, visualTheme, 'focalAnchor')) // backrest (on +Z side)
  return g
}

function buildPillar(obj: ObjectOf<'pillar'>): THREE.Object3D {
  const geo = new THREE.CylinderGeometry(obj.radius, obj.radius, obj.height, 12)
  geo.translate(0, obj.height / 2, 0) // anchor base at y=0 so it stands on the floor
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: obj.color }))
}

function buildRug(obj: ObjectOf<'rug'>): THREE.Object3D {
  const [w, d] = obj.size
  const geo = new THREE.BoxGeometry(w, 0.04, d)
  geo.translate(0, 0.02, 0) // sit the slab just above the floor
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: obj.color }))
}

function buildTorch(
  obj: ObjectOf<'torch'>,
  visualTheme: GeneratedRoomVisualTheme | null,
): THREE.Object3D {
  // v0 pillar-mounted torch: the object's position is the mount point on a
  // pillar/wall (e.g. y=3), which in the example coincides with a 0.4m-radius
  // pillar. So the sconce brackets outward along local +Z and the flame sits
  // ~0.55m in front of the mount, clearing the pillar and facing the room.
  // rotationY aims this offset for other mounts. (No real attachment logic.)
  const g = new THREE.Group()
  const { color, intensity, distance } = obj.light
  const reach = 0.55 // how far the flame sits out from the mount surface

  // Horizontal arm from the mount out to the flame.
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, reach),
    makeThemedStandardMaterial('#2a1d12', visualTheme, 'special'),
  )
  arm.position.set(0, 0, reach / 2)
  g.add(arm)

  // Cup/holder at the end of the arm.
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.08, 0.22, 8),
    makeThemedStandardMaterial('#2a1d12', visualTheme, 'special'),
  )
  cup.position.set(0, 0.15, reach)
  g.add(cup)

  // Emissive flame: glows on its own, large enough to read from across the room.
  const emissive = themedEmissiveColor(visualTheme) ?? color
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.6, 8),
    makeThemedStandardMaterial(color, visualTheme, 'special', {
      color,
      emissive,
      emissiveIntensity: 2.5,
    }),
  )
  flame.position.set(0, 0.55, reach)
  g.add(flame)

  // Real light, data-driven. No shadows (cheap), no flicker yet.
  const light = new THREE.PointLight(color, intensity, distance)
  light.position.set(0, 0.6, reach)
  g.add(light)

  return g
}

function buildArch(obj: ObjectOf<'arch'>): THREE.Object3D {
  const { width, height, color } = obj
  const g = new THREE.Group()
  const post = 0.4
  g.add(archBox(post, height, post, -width / 2, height / 2, 0, color)) // left post
  g.add(archBox(post, height, post, width / 2, height / 2, 0, color)) // right post
  g.add(archBox(width + post, 0.5, post, 0, height + 0.25, 0, color)) // lintel
  return g
}

function buildScroll(obj: ObjectOf<'scroll'>): THREE.Object3D {
  // Small rolled parchment lying along X; the object's position carries its
  // height (e.g. y=0.5), so the roll is built centered on the local origin.
  const g = new THREE.Group()
  const roll = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.5, 10),
    new THREE.MeshStandardMaterial({ color: obj.color }),
  )
  roll.rotation.z = Math.PI / 2
  g.add(roll)
  // Slightly larger, paler end caps so it reads as a scroll, not a stick.
  for (const x of [-0.25, 0.25]) {
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.06, 10),
      new THREE.MeshStandardMaterial({ color: '#cbbf94' }),
    )
    cap.rotation.z = Math.PI / 2
    cap.position.x = x
    g.add(cap)
  }
  return g
}

function buildNpc(obj: ObjectOf<'npc'>): THREE.Object3D {
  // Low-poly robed figure resting on the floor (position is the base). Assembled
  // from the shared humanoid kit with default colors and a turban; a small nose
  // marks the facing direction (local +Z), so at rotationY=0 it looks south
  // toward an approaching player.
  return buildHumanoid({
    robeColor: obj.color,
    skinColor: '#d4ad84',
    turbanColor: '#f0ead8',
    accentColor: '#f0c96b',
  })
}

// Sickly grey-green flesh for the undead; clothing color comes from obj.color.
const ZOMBIE_SKIN = '#9aa78f'

function buildZombie(obj: ObjectOf<'zombie'>): THREE.Object3D {
  // Same humanoid kit, made undead: pale skin, a bare head and arms reaching
  // forward. Static decoration only — no combat, no AI. A darker torn patch on
  // the torso sells the "damaged" read. If the spec gives it an interaction,
  // the buildObjects loop adds the standard floor indicator (no special-casing).
  const g = buildHumanoid({
    robeColor: obj.color,
    skinColor: ZOMBIE_SKIN,
    beltColor: new THREE.Color(obj.color).multiplyScalar(0.6),
    headwear: 'bare',
    arms: 'reach',
  })
  const patch = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.3, 0.05),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(obj.color).multiplyScalar(0.5) }),
  )
  patch.position.set(0.1, 0.72, 0.24) // ragged hole over the torso
  g.add(patch)
  return g
}

function buildProp(obj: ObjectOf<'prop'>): THREE.Object3D {
  const [sx, sy, sz] = obj.size
  const radius = Math.min(sx, sz) / 2
  let geo: THREE.BufferGeometry
  let baseOffset = sy / 2
  switch (obj.shape) {
    case 'cylinder':
      geo = new THREE.CylinderGeometry(radius, radius, sy, 12)
      break
    case 'cone':
      geo = new THREE.ConeGeometry(radius, sy, 12)
      break
    case 'sphere':
      geo = new THREE.SphereGeometry(radius, 16, 12)
      baseOffset = radius
      break
    default:
      geo = new THREE.BoxGeometry(sx, sy, sz)
  }
  geo.translate(0, baseOffset, 0) // anchor base at y=0 so it rests on the floor
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: obj.color }))
}

/**
 * Neutral fallback for skipped content: a low cool-toned void seal with crossed
 * slabs. It intentionally avoids the warm candle/chest palette and the
 * plinth+crystal silhouette used by valid artifacts. Its XZ diameter stays
 * below the prior 0.8 m placeholder cube. It carries no raw type/name/id, light,
 * text, or interaction affordance.
 */
function buildMysteryMarker(): THREE.Object3D {
  const g = new THREE.Group()
  g.name = 'mystery-marker'

  const seal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.38, 0.08, 12),
    new THREE.MeshStandardMaterial({
      color: '#202238',
      emissive: '#101426',
      emissiveIntensity: 0.18,
      roughness: 0.95,
    }),
  )
  seal.position.y = 0.04
  g.add(seal)

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.022, 6, 24),
    new THREE.MeshStandardMaterial({
      color: '#6b79d6',
      emissive: '#29356f',
      emissiveIntensity: 0.45,
      metalness: 0.1,
      roughness: 0.6,
    }),
  )
  rim.position.y = 0.105
  rim.rotation.x = Math.PI / 2
  g.add(rim)

  for (const angle of [0, Math.PI / 2, Math.PI / 4]) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.055, 0.07),
      new THREE.MeshStandardMaterial({
        color: angle === Math.PI / 4 ? '#8d7aff' : '#4952a3',
        emissive: '#202761',
        emissiveIntensity: 0.35,
        roughness: 0.7,
      }),
    )
    bar.position.y = 0.15
    bar.rotation.y = angle
    g.add(bar)
  }

  const chip = new THREE.Mesh(
    new THREE.TetrahedronGeometry(0.13, 0),
    new THREE.MeshStandardMaterial({
      color: '#c8c2ff',
      emissive: '#4c43a0',
      emissiveIntensity: 0.5,
      roughness: 0.65,
    }),
  )
  chip.position.y = 0.29
  chip.rotation.set(0.4, 0.7, 0.2)
  g.add(chip)

  return g
}

/* ---------- helpers ---------- */

function box(
  sx: number,
  sy: number,
  sz: number,
  px: number,
  py: number,
  pz: number,
  color: string,
  visualTheme: GeneratedRoomVisualTheme | null = null,
  role: 'focalAnchor' | 'industrial' | 'special' = 'focalAnchor',
): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    makeThemedStandardMaterial(color, visualTheme, role),
  )
  m.position.set(px, py, pz)
  return m
}

function applyTransform(o: THREE.Object3D, position: Vec3, rotationYDeg: number, scale: number): void {
  o.position.set(position[0], position[1], position[2])
  o.rotation.y = THREE.MathUtils.degToRad(rotationYDeg)
  o.scale.setScalar(scale)
}

function readPosition(raw: unknown): Vec3 {
  if (raw && typeof raw === 'object' && 'position' in raw) {
    const p = (raw as { position: unknown }).position
    if (Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number')) {
      // Validated above as a length-3 number array; assert the tuple shape so
      // noUncheckedIndexedAccess is satisfied, then copy into a fresh Vec3.
      const [x, y, z] = p as Vec3
      return [x, y, z]
    }
  }
  return [0, 0, 0]
}

export const AFFORDANCE_RING_COLOR: Record<Affordance, string> = {
  inspect: '#ffd166',
  talk: '#63e6a2',
  exit: '#64d8ff',
  approach: '#ff7a59',
  take: '#ffe066',
  use: '#aa8cff',
}
export const RETURN_EXIT_RING_COLOR = '#ff77c8'
export const INTERACTABLE_RING_EMISSIVE_INTENSITY = 1.4
export const INTERACTABLE_RING_OPACITY = 0.94
export const RESOLVED_RING_EMISSIVE_INTENSITY = 0.28
export const RESOLVED_RING_OPACITY = 0.38

/**
 * A static floor ring placed under an interactable object at its XZ (on the
 * floor, not at the object's own height). Renderer-internal discoverability cue;
 * disposed with the scene like every other mesh.
 */
function buildInteractableIndicator(
  position: Vec3,
  color: string,
  resolved = false,
): THREE.Object3D {
  const ring = buildGroundRing({
    innerRadius: 0.72,
    outerRadius: 1.14,
    color,
    emissiveIntensity: resolved
      ? RESOLVED_RING_EMISSIVE_INTENSITY
      : INTERACTABLE_RING_EMISSIVE_INTENSITY,
    opacity: resolved ? RESOLVED_RING_OPACITY : INTERACTABLE_RING_OPACITY,
    floorY: 0.07,
    renderOrder: 12,
    toneMapped: false,
  })
  ring.name = 'interactable-indicator'
  ring.position.set(position[0], ring.position.y, position[2])
  return ring
}

/** Enables shadow casting/receiving on every mesh under a built object node. */
function enableShadows(node: THREE.Object3D): void {
  node.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  })
}

function archBox(
  sx: number,
  sy: number,
  sz: number,
  px: number,
  py: number,
  pz: number,
  color: string,
): THREE.Mesh {
  const archColor = new THREE.Color(color)
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({
      color: archColor,
      emissive: archColor.clone().multiplyScalar(0.35),
      emissiveIntensity: 0.22,
      roughness: 0.72,
      metalness: 0.04,
    }),
  )
  m.position.set(px, py, pz)
  return m
}
function buildArchitecture(
  obj: ObjectOf<'architecture'>,
  visualTheme: GeneratedRoomVisualTheme | null,
): THREE.Object3D {
  const group = new THREE.Group()
  const material = makeThemedStandardMaterial(obj.color, visualTheme, 'focalAnchor')
  const accent = makeThemedStandardMaterial(obj.accentColor, visualTheme, 'special')
  const [width, height, depth] = obj.size

  if (obj.kind === 'doorway' || obj.kind === 'gate' || obj.kind === 'window') {
    const post = Math.max(0.14, width * 0.14)
    group.add(semanticBox(post, height, depth, -width / 2, height / 2, 0, material))
    group.add(semanticBox(post, height, depth, width / 2, height / 2, 0, material))
    group.add(semanticBox(width + post, post, depth, 0, height - post / 2, 0, accent))
    if (obj.kind === 'gate') {
      for (const x of [-0.3, 0, 0.3]) {
        group.add(semanticBox(post * 0.35, height * 0.72, depth * 0.45, x * width, height * 0.36, 0, accent))
      }
    }
    return group
  }

  if (obj.kind === 'stairs') {
    const steps = 5
    for (let index = 0; index < steps; index += 1) {
      const stepHeight = height * ((index + 1) / steps)
      group.add(semanticBox(
        width,
        stepHeight,
        depth / steps,
        0,
        stepHeight / 2,
        depth / 2 - (index + 0.5) * (depth / steps),
        index % 2 === 0 ? material : accent,
      ))
    }
    return group
  }

  if (obj.kind === 'column') {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.25, width * 0.3, height * 0.82, 10),
      material,
    )
    shaft.position.y = height * 0.51
    group.add(shaft)
    group.add(semanticBox(width * 0.8, height * 0.09, depth * 0.8, 0, height * 0.045, 0, accent))
    group.add(semanticBox(width * 0.72, height * 0.09, depth * 0.72, 0, height * 0.955, 0, accent))
    return group
  }

  if (obj.kind === 'well' || obj.kind === 'fountain' || obj.kind === 'pool') {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(width, depth) * 0.34, Math.min(width, depth) * 0.1, 8, 20),
      material,
    )
    rim.rotation.x = Math.PI / 2
    rim.position.y = height * 0.42
    group.add(rim)
    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.34, width * 0.42, height * 0.4, 16, 1, true),
      accent,
    )
    basin.position.y = height * 0.2
    group.add(basin)
    return group
  }

  group.add(semanticBox(width, height, depth, 0, height / 2, 0, material))
  if (obj.kind === 'wall-ruined') {
    group.add(semanticBox(width * 0.35, height * 0.35, depth * 1.25, width * 0.3, height * 0.9, 0, accent))
  } else {
    group.add(semanticBox(width * 0.9, height * 0.08, depth * 1.08, 0, height * 0.78, 0, accent))
  }
  return group
}

function buildFurniture(
  obj: ObjectOf<'furniture'>,
  visualTheme: GeneratedRoomVisualTheme | null,
): THREE.Object3D {
  const group = new THREE.Group()
  const wood = makeThemedStandardMaterial(obj.color, visualTheme, 'focalAnchor')
  const accent = makeThemedStandardMaterial(obj.accentColor, visualTheme, 'special')
  const [width, height, depth] = obj.size
  const seatHeight = height * 0.48

  if (obj.kind === 'bed') {
    group.add(semanticBox(width, height * 0.22, depth, 0, height * 0.28, 0, accent))
    group.add(semanticBox(width * 0.92, height * 0.18, depth * 0.82, 0, height * 0.5, 0, wood))
    group.add(semanticBox(width, height, depth * 0.12, 0, height / 2, -depth * 0.44, accent))
    return group
  }

  if (obj.kind === 'shelf' || obj.kind === 'bookcase' || obj.kind === 'cabinet' || obj.kind === 'wardrobe') {
    group.add(semanticBox(width, height, depth * 0.18, 0, height / 2, depth * 0.4, accent))
    group.add(semanticBox(width * 0.1, height, depth, -width * 0.45, height / 2, 0, wood))
    group.add(semanticBox(width * 0.1, height, depth, width * 0.45, height / 2, 0, wood))
    for (const y of [0.08, 0.38, 0.68, 0.96]) {
      group.add(semanticBox(width, height * 0.07, depth, 0, height * y, 0, wood))
    }
    return group
  }

  const topDepth = obj.kind === 'chair' || obj.kind === 'stool' || obj.kind === 'bench'
    ? depth * 0.85
    : depth
  group.add(semanticBox(width, height * 0.16, topDepth, 0, seatHeight, 0, wood))
  const legX = width * 0.4
  const legZ = topDepth * 0.36
  for (const x of [-legX, legX]) {
    for (const z of [-legZ, legZ]) {
      group.add(semanticBox(width * 0.1, seatHeight, depth * 0.1, x, seatHeight / 2, z, accent))
    }
  }
  if (obj.kind === 'chair' || obj.kind === 'bench') {
    group.add(semanticBox(width, height * 0.55, depth * 0.1, 0, height * 0.72, -depth * 0.4, wood))
  }
  return group
}

function buildClutter(
  obj: ObjectOf<'clutter'>,
  visualTheme: GeneratedRoomVisualTheme | null,
): THREE.Object3D {
  const group = new THREE.Group()
  const material = makeThemedStandardMaterial(obj.color, visualTheme, 'industrial')
  const accent = makeThemedStandardMaterial(obj.accentColor, visualTheme, 'special')
  const [width, height, depth] = obj.size

  if (obj.kind === 'bloodstain' || obj.kind === 'markings') {
    const stain = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(width, depth) * 0.5, 12),
      material,
    )
    stain.rotation.x = -Math.PI / 2
    stain.position.y = 0.012
    group.add(stain)
    return group
  }

  if (obj.kind === 'bottle' || obj.kind === 'mug' || obj.kind === 'pot' || obj.kind === 'potion') {
    const vessel = new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.28, width * 0.42, height * 0.72, 10),
      material,
    )
    vessel.position.y = height * 0.36
    group.add(vessel)
    group.add(semanticBox(width * 0.2, height * 0.28, depth * 0.2, 0, height * 0.86, 0, accent))
    return group
  }

  for (const [x, y, z, scale] of [
    [-0.24, 0.18, -0.12, 0.55],
    [0.18, 0.13, 0.16, 0.42],
    [0.05, 0.25, -0.2, 0.36],
  ] as const) {
    const piece = new THREE.Mesh(new THREE.DodecahedronGeometry(scale, 0), material)
    piece.position.set(x * width, y * height, z * depth)
    piece.scale.set(width, height, depth)
    group.add(piece)
  }
  return group
}

function buildVegetation(
  obj: ObjectOf<'vegetation'>,
  visualTheme: GeneratedRoomVisualTheme | null,
): THREE.Object3D {
  const group = new THREE.Group()
  const foliage = makeThemedStandardMaterial(obj.color, visualTheme, 'focalAnchor')
  const bark = makeThemedStandardMaterial(obj.accentColor, visualTheme, 'industrial')
  const [width, height, depth] = obj.size

  if (obj.kind === 'rock' || obj.kind === 'stump') {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), obj.kind === 'rock' ? bark : foliage)
    rock.scale.set(width, height, depth)
    rock.position.y = height * 0.45
    group.add(rock)
    return group
  }

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 0.12, width * 0.18, height * 0.64, 8),
    bark,
  )
  trunk.position.y = height * 0.32
  group.add(trunk)
  for (const [x, y, z, scale] of [
    [0, 0.72, 0, 0.48],
    [-0.2, 0.58, 0.08, 0.36],
    [0.22, 0.6, -0.1, 0.34],
  ] as const) {
    const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), foliage)
    crown.position.set(x * width, y * height, z * depth)
    crown.scale.setScalar(scale * Math.max(width, depth))
    group.add(crown)
  }
  return group
}

function buildLightFixture(
  obj: ObjectOf<'light-fixture'>,
  visualTheme: GeneratedRoomVisualTheme | null,
): THREE.Object3D {
  const group = new THREE.Group()
  const metal = makeThemedStandardMaterial(obj.color, visualTheme, 'industrial')
  const flame = makeThemedStandardMaterial(obj.flameColor, visualTheme, 'special', {
    emissive: obj.flameColor,
    emissiveIntensity: 2,
  })
  const [width, height, depth] = obj.size
  group.add(semanticBox(width * 0.7, height * 0.08, depth * 0.7, 0, height * 0.08, 0, metal))
  const cage = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 0.26, width * 0.34, height * 0.62, 8, 1, true),
    metal,
  )
  cage.position.y = height * 0.38
  group.add(cage)
  const glow = new THREE.Mesh(new THREE.OctahedronGeometry(width * 0.18, 0), flame)
  glow.position.y = height * 0.4
  group.add(glow)
  const light = new THREE.PointLight(obj.light.color, obj.light.intensity, obj.light.distance)
  light.position.y = height * 0.48
  group.add(light)
  return group
}

function semanticBox(
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material)
  mesh.position.set(x, y, z)
  return mesh
}
