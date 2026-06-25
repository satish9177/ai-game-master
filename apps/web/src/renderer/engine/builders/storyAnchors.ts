import * as THREE from 'three'
import type { RoomObject } from '../../../domain/roomSpec'

/** Trusted procedural builders for inert story-anchor visuals. */

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

/** Tiered floor altar: broad base, raised slab, accent inlay, and side blocks. */
export function buildAltar(obj: ObjectOf<'altar'>): THREE.Object3D {
  const [width, height, depth] = obj.size
  const group = new THREE.Group()
  const baseH = height * 0.28
  const midH = height * 0.34
  const topH = height * 0.22
  const accentH = Math.max(0.035, height * 0.05)

  group.add(box(width, baseH, depth, 0, baseH / 2, 0, shade(obj.color, 0.72)))
  group.add(box(width * 0.78, midH, depth * 0.82, 0, baseH + midH / 2, 0, obj.color))
  group.add(box(width * 0.9, topH, depth * 0.92, 0, baseH + midH + topH / 2, 0, shade(obj.color, 1.15)))
  group.add(box(width * 0.46, accentH, depth * 0.18, 0, height - accentH / 2, -depth * 0.16, obj.accentColor))

  const sideW = width * 0.12
  for (const x of [-1, 1]) {
    group.add(box(sideW, height * 0.42, depth * 0.72, x * width * 0.36, baseH + height * 0.21, 0, shade(obj.color, 0.85)))
  }
  return group
}

/** Pedestal and simplified obelisk/figure silhouette, static and floor-anchored. */
export function buildStatue(obj: ObjectOf<'statue'>): THREE.Object3D {
  const group = new THREE.Group()
  const pedestalH = Math.min(0.45, obj.height * 0.22)
  const figureH = Math.max(0.2, obj.height - pedestalH)
  const pedestalR = obj.radius * 1.15
  const figureR = obj.radius * 0.62

  group.add(cylinder(pedestalR, pedestalR * 1.08, pedestalH, 0, pedestalH / 2, 0, obj.pedestalColor))
  group.add(cylinder(figureR * 0.9, figureR, figureH * 0.72, 0, pedestalH + figureH * 0.36, 0, obj.color))

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(figureR * 0.58, 12, 8),
    new THREE.MeshStandardMaterial({ color: shade(obj.color, 1.08) }),
  )
  head.position.set(0, pedestalH + figureH * 0.82, 0)
  group.add(head)

  const crest = new THREE.Mesh(
    new THREE.ConeGeometry(figureR * 0.45, figureH * 0.28, 8),
    new THREE.MeshStandardMaterial({ color: shade(obj.color, 0.9) }),
  )
  crest.position.set(0, pedestalH + figureH * 0.99, 0)
  group.add(crest)

  group.add(box(obj.radius * 1.35, figureH * 0.08, obj.radius * 0.18, 0, pedestalH + figureH * 0.53, figureR * 0.82, shade(obj.color, 0.82)))
  return group
}

function box(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  color: THREE.ColorRepresentation,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color }),
  )
  mesh.position.set(x, y, z)
  return mesh
}

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  x: number,
  y: number,
  z: number,
  color: THREE.ColorRepresentation,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 12),
    new THREE.MeshStandardMaterial({ color }),
  )
  mesh.position.set(x, y, z)
  return mesh
}

function shade(color: string, factor: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(factor)
}
