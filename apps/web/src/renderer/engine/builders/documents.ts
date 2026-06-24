import * as THREE from 'three'
import type { RoomObject } from '../../../domain/roomSpec'

/** Trusted procedural builders for the bounded document vocabulary. */

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

/** Closed book: cover slabs, inset page block, and a darker spine. */
export function buildBook(obj: ObjectOf<'book'>): THREE.Object3D {
  const [width, height, depth] = obj.size
  const cover = Math.min(0.035, height * 0.2)
  const pagesHeight = Math.max(0.01, height - cover * 2)
  const group = new THREE.Group()

  group.add(box(width, cover, depth, 0, cover / 2, 0, obj.coverColor))
  group.add(box(
    width * 0.9,
    pagesHeight,
    depth * 0.9,
    width * 0.025,
    cover + pagesHeight / 2,
    0,
    obj.pageColor,
  ))
  group.add(box(width, cover, depth, 0, height - cover / 2, 0, obj.coverColor))
  group.add(box(
    Math.min(0.06, width * 0.12),
    height,
    depth,
    -width / 2 + Math.min(0.03, width * 0.06),
    height / 2,
    0,
    shade(obj.coverColor, 0.65),
  ))
  return group
}

/** Flat parchment sheet with a small raised folded corner. */
export function buildPaper(obj: ObjectOf<'paper'>): THREE.Object3D {
  const [width, depth] = obj.size
  const group = new THREE.Group()
  group.add(box(width, 0.025, depth, 0, 0.0125, 0, obj.color))

  const foldWidth = Math.min(0.16, width * 0.22)
  const foldDepth = Math.min(0.14, depth * 0.22)
  const fold = box(
    foldWidth,
    0.018,
    foldDepth,
    width / 2 - foldWidth / 2,
    0.035,
    depth / 2 - foldDepth / 2,
    shade(obj.color, 0.82),
  )
  fold.rotation.x = -0.18
  group.add(fold)
  return group
}

/** Larger parchment with fixed geometric route marks; never renders text. */
export function buildMap(obj: ObjectOf<'map'>): THREE.Object3D {
  const [width, depth] = obj.size
  const group = new THREE.Group()
  group.add(box(width, 0.03, depth, 0, 0.015, 0, obj.color))

  const routeA = box(width * 0.42, 0.018, 0.035, -width * 0.17, 0.04, depth * 0.08, obj.markColor)
  routeA.rotation.y = 0.28
  group.add(routeA)

  const routeB = box(width * 0.34, 0.018, 0.035, width * 0.18, 0.04, -depth * 0.12, obj.markColor)
  routeB.rotation.y = -0.4
  group.add(routeB)

  for (const [x, z] of [[-0.28, 0.14], [0.3, -0.18]] as const) {
    const mark = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.022, 8),
      new THREE.MeshStandardMaterial({ color: obj.markColor }),
    )
    mark.position.set(x * width, 0.045, z * depth)
    group.add(mark)
  }
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

function shade(color: string, factor: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(factor)
}
