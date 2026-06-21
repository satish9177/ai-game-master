import * as THREE from 'three'
import type { LoadedRoom, RoomObject } from '../../../roomspec/schema'

/**
 * Builds the room's props from RoomSpec objects via a type-to-builder registry.
 *
 * Safety contract: nothing here can crash the renderer. A valid schema type
 * with no builder yet (torch/npc/scroll) and any unknown/malformed object
 * (room.skipped) both fall back to a magenta placeholder box, so unsupported
 * content is visible rather than fatal.
 *
 * Conventions: Y-up, meters, -Z = north, rotationY in degrees. Each builder
 * constructs its prop resting on the local floor plane (y=0); one material per
 * mesh so disposeObject frees every geometry/material exactly once.
 */
export function buildObjects(room: LoadedRoom): THREE.Group {
  const group = new THREE.Group()
  group.name = 'objects'

  for (const obj of room.objects) {
    const node = buildKnownObject(obj)
    applyTransform(node, obj.position, obj.rotationY, obj.scale)
    group.add(node)
  }

  // Unknown/malformed objects the loader skipped — placeholder, never crash.
  for (const item of room.skipped) {
    const node = buildPlaceholder(item.type)
    applyTransform(node, readPosition(item.raw), 0, 1)
    group.add(node)
  }

  return group
}

type Vec3 = [number, number, number]
type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>
type ObjectBuilder<K extends RoomObject['type']> = (obj: ObjectOf<K>) => THREE.Object3D

const registry: { [K in RoomObject['type']]?: ObjectBuilder<K> } = {
  throne: buildThrone,
  pillar: buildPillar,
  rug: buildRug,
  torch: buildTorch,
  arch: buildArch,
  scroll: buildScroll,
  npc: buildNpc,
  prop: buildProp,
}

function buildKnownObject(obj: RoomObject): THREE.Object3D {
  const builder = registry[obj.type] as ((o: RoomObject) => THREE.Object3D) | undefined
  if (!builder) {
    console.warn(`[builders] no builder for "${obj.type}" yet — rendering placeholder`)
    return buildPlaceholder(obj.type)
  }
  return builder(obj)
}

/* ---------- builders ---------- */

function buildThrone(obj: ObjectOf<'throne'>): THREE.Object3D {
  // Faces -Z by default; the example's rotationY=180 turns it to face the room.
  const g = new THREE.Group()
  g.add(box(2, 0.3, 1.6, 0, 0.15, 0, obj.color)) // base
  g.add(box(1.6, 0.3, 1.4, 0, 0.6, 0, obj.color)) // seat
  g.add(box(1.6, 2, 0.3, 0, 1.6, 0.55, obj.color)) // backrest (on +Z side)
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

function buildTorch(obj: ObjectOf<'torch'>): THREE.Object3D {
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
    new THREE.MeshStandardMaterial({ color: '#2a1d12' }),
  )
  arm.position.set(0, 0, reach / 2)
  g.add(arm)

  // Cup/holder at the end of the arm.
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.08, 0.22, 8),
    new THREE.MeshStandardMaterial({ color: '#2a1d12' }),
  )
  cup.position.set(0, 0.15, reach)
  g.add(cup)

  // Emissive flame: glows on its own, large enough to read from across the room.
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.6, 8),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
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
  g.add(box(post, height, post, -width / 2, height / 2, 0, color)) // left post
  g.add(box(post, height, post, width / 2, height / 2, 0, color)) // right post
  g.add(box(width + post, 0.5, post, 0, height + 0.25, 0, color)) // lintel
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
  // Low-poly standing figure resting on the floor (position is the base).
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.34, 1.2, 8),
    new THREE.MeshStandardMaterial({ color: obj.color }),
  )
  body.position.y = 0.6 // base at y=0
  g.add(body)
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 10),
    new THREE.MeshStandardMaterial({ color: obj.color }),
  )
  head.position.y = 1.45
  g.add(head)
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

function buildPlaceholder(type: string): THREE.Object3D {
  const g = new THREE.Group()
  g.name = `placeholder:${type}`
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({
      color: '#ff00ff',
      emissive: '#ff00ff',
      emissiveIntensity: 0.4,
    }),
  )
  m.position.y = 0.4
  g.add(m)
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
): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color }),
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
      return [p[0], p[1], p[2]]
    }
  }
  return [0, 0, 0]
}
