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
  arch: buildArch,
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
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: obj.color }))
  m.position.y = obj.height / 2
  return m
}

function buildRug(obj: ObjectOf<'rug'>): THREE.Object3D {
  const [w, d] = obj.size
  const geo = new THREE.BoxGeometry(w, 0.04, d)
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: obj.color }))
  m.position.y = 0.02
  return m
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

function buildProp(obj: ObjectOf<'prop'>): THREE.Object3D {
  const [sx, sy, sz] = obj.size
  const radius = Math.min(sx, sz) / 2
  let geo: THREE.BufferGeometry
  let centerY = sy / 2
  switch (obj.shape) {
    case 'cylinder':
      geo = new THREE.CylinderGeometry(radius, radius, sy, 12)
      break
    case 'cone':
      geo = new THREE.ConeGeometry(radius, sy, 12)
      break
    case 'sphere':
      geo = new THREE.SphereGeometry(radius, 16, 12)
      centerY = radius
      break
    default:
      geo = new THREE.BoxGeometry(sx, sy, sz)
  }
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: obj.color }))
  m.position.y = centerY
  return m
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
