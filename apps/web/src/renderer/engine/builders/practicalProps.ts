import * as THREE from 'three'
import type { RoomObject } from '../../../domain/roomSpec'

/** Trusted procedural builders for practical RPG room props. */

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

/** Distinct container: box body, raised lid, trim bands, and front latch. */
export function buildChest(obj: ObjectOf<'chest'>): THREE.Object3D {
  const [width, height, depth] = obj.size
  const group = new THREE.Group()
  const bodyHeight = height * 0.68
  const lidHeight = height * 0.24
  const trim = Math.min(0.08, Math.min(width, depth) * 0.12)

  group.add(box(width, bodyHeight, depth, 0, bodyHeight / 2, 0, obj.color))
  group.add(box(width * 1.04, lidHeight, depth * 1.04, 0, bodyHeight + lidHeight / 2, 0, shade(obj.color, 1.18)))

  const topY = bodyHeight + lidHeight
  group.add(box(width * 1.08, trim, depth * 1.08, 0, topY - trim / 2, 0, obj.trimColor))
  group.add(box(width * 1.04, trim, depth * 1.04, 0, bodyHeight * 0.52, 0, obj.trimColor))
  group.add(box(width * 0.16, height * 0.18, trim * 0.65, 0, bodyHeight * 0.58, depth / 2 + trim * 0.35, obj.latchColor))

  for (const x of [-1, 1]) {
    group.add(box(trim, height * 0.88, trim, x * (width / 2 - trim / 2), height * 0.44, depth / 2 - trim / 2, obj.trimColor))
  }
  return group
}

/** Low static body marker: horizontal silhouette, not an NPC or animated actor. */
export function buildCorpse(obj: ObjectOf<'corpse'>): THREE.Object3D {
  const [width, height, length] = obj.size
  const group = new THREE.Group()
  const bodyWidth = width * 0.62
  const headRadius = Math.min(width * 0.18, length * 0.09)
  const limbWidth = Math.max(0.08, width * 0.14)

  group.add(box(bodyWidth, height, length * 0.52, 0, height / 2, 0, obj.clothColor))

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, 12, 8),
    new THREE.MeshStandardMaterial({ color: obj.color }),
  )
  head.position.set(0, height * 0.78, -length * 0.36)
  head.scale.y = 0.45
  group.add(head)

  group.add(box(limbWidth, height * 0.45, length * 0.34, -width * 0.28, height * 0.28, length * 0.2, obj.color))
  group.add(box(limbWidth, height * 0.45, length * 0.34, width * 0.28, height * 0.28, length * 0.2, obj.color))
  group.add(box(limbWidth, height * 0.4, length * 0.36, -width * 0.22, height * 0.24, -length * 0.13, shade(obj.color, 0.85)))
  group.add(box(limbWidth, height * 0.4, length * 0.36, width * 0.22, height * 0.24, -length * 0.13, shade(obj.color, 0.85)))
  return group
}

/** Simple table: top slab, four legs, and a small apron under the edge. */
export function buildTable(obj: ObjectOf<'table'>): THREE.Object3D {
  const [width, height, depth] = obj.size
  const group = new THREE.Group()
  const topHeight = Math.min(0.16, height * 0.18)
  const leg = Math.min(0.16, Math.min(width, depth) * 0.14)
  const legHeight = Math.max(0.05, height - topHeight)
  const topY = legHeight + topHeight / 2
  const legX = width / 2 - leg
  const legZ = depth / 2 - leg
  const legColor = shade(obj.color, 0.72)

  group.add(box(width, topHeight, depth, 0, topY, 0, obj.color))
  group.add(box(width * 0.92, topHeight * 0.8, leg, 0, legHeight - topHeight * 0.1, -legZ, legColor))
  group.add(box(width * 0.92, topHeight * 0.8, leg, 0, legHeight - topHeight * 0.1, legZ, legColor))

  for (const x of [-legX, legX]) {
    for (const z of [-legZ, legZ]) {
      group.add(box(leg, legHeight, leg, x, legHeight / 2, z, legColor))
    }
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
