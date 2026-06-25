import * as THREE from 'three'
import type { RoomObject } from '../../../domain/roomSpec'

/** Trusted procedural builders for the bounded document vocabulary. */

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

/** Closed book: cover slabs, inset page block, and a darker spine. */
export function buildBook(obj: ObjectOf<'book'>): THREE.Object3D {
  const [rawWidth, rawHeight, rawDepth] = obj.size
  const width = Math.max(rawWidth, 0.95)
  const height = Math.max(rawHeight, 0.18)
  const depth = Math.max(rawDepth, 0.68)
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
  group.add(box(
    width * 0.76,
    0.018,
    Math.min(0.04, depth * 0.08),
    width * 0.06,
    height + 0.012,
    -depth * 0.24,
    shade(obj.pageColor, 0.78),
  ))
  group.add(box(
    width * 0.5,
    0.018,
    Math.min(0.04, depth * 0.08),
    width * 0.16,
    height + 0.014,
    depth * 0.18,
    shade(obj.pageColor, 0.7),
  ))
  return group
}

/** Flat parchment sheet with a small raised folded corner. */
export function buildPaper(obj: ObjectOf<'paper'>): THREE.Object3D {
  const [rawWidth, rawDepth] = obj.size
  const width = Math.max(rawWidth, 1.05)
  const depth = Math.max(rawDepth, 0.78)
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
  group.add(box(width * 0.82, 0.014, 0.026, 0, 0.04, -depth * 0.18, shade(obj.color, 0.72)))
  group.add(box(width * 0.52, 0.014, 0.026, -width * 0.12, 0.042, depth * 0.12, shade(obj.color, 0.78)))
  return group
}

/** Larger parchment with fixed geometric route marks; never renders text. */
export function buildMap(obj: ObjectOf<'map'>): THREE.Object3D {
  const [rawWidth, rawDepth] = obj.size
  const width = Math.max(rawWidth, 1.7)
  const depth = Math.max(rawDepth, 1.05)
  const group = new THREE.Group()
  group.add(box(width, 0.03, depth, 0, 0.015, 0, obj.color))
  group.add(box(width * 0.96, 0.018, 0.035, 0, 0.043, -depth * 0.46, shade(obj.color, 0.82)))
  group.add(box(width * 0.96, 0.018, 0.035, 0, 0.043, depth * 0.46, shade(obj.color, 0.82)))
  group.add(box(0.035, 0.018, depth * 0.9, -width * 0.46, 0.043, 0, shade(obj.color, 0.82)))
  group.add(box(0.035, 0.018, depth * 0.9, width * 0.46, 0.043, 0, shade(obj.color, 0.82)))

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
  const northMark = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.16, 3),
    new THREE.MeshStandardMaterial({ color: obj.markColor }),
  )
  northMark.rotation.x = Math.PI / 2
  northMark.position.set(width * 0.33, 0.1, depth * 0.28)
  group.add(northMark)
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
