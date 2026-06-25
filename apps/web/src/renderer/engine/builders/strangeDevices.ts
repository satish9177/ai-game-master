import * as THREE from 'three'
import type { RoomObject } from '../../../domain/roomSpec'

/** Trusted procedural builders for strange devices, artifacts, and tiny lights. */

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

/** Broken device silhouette: chassis, panel, vents, and fixed pipe shapes. */
export function buildMachine(obj: ObjectOf<'machine'>): THREE.Object3D {
  const [width, height, depth] = obj.size
  const group = new THREE.Group()
  const baseH = height * 0.22
  const bodyH = height * 0.58

  group.add(box(width, baseH, depth, 0, baseH / 2, 0, shade(obj.color, 0.7)))
  group.add(box(width * 0.86, bodyH, depth * 0.72, 0, baseH + bodyH / 2, 0, obj.color))
  group.add(box(width * 0.48, height * 0.28, depth * 0.08, -width * 0.08, baseH + bodyH * 0.62, -depth * 0.38, obj.panelColor))

  for (const x of [-0.22, 0, 0.22]) {
    group.add(box(width * 0.08, height * 0.03, depth * 0.1, x * width, baseH + bodyH * 0.68, -depth * 0.43, shade(obj.panelColor, 1.35)))
  }

  const pipeA = cylinder(width * 0.045, depth * 0.78, width * 0.34, baseH + bodyH * 0.5, depth * 0.35, obj.pipeColor)
  pipeA.rotation.x = Math.PI / 2
  group.add(pipeA)

  const pipeB = cylinder(width * 0.035, height * 0.5, -width * 0.43, baseH + bodyH * 0.38, 0, shade(obj.pipeColor, 0.75))
  pipeB.rotation.z = 0.18
  group.add(pipeB)

  group.add(box(width * 0.28, height * 0.14, depth * 0.24, width * 0.34, baseH + bodyH + height * 0.07, 0, shade(obj.color, 1.18)))
  return group
}

/** Plinth plus fixed emissive crystal. No behavior or dynamic lighting. */
export function buildArtifact(obj: ObjectOf<'artifact'>): THREE.Object3D {
  const group = new THREE.Group()
  const baseH = Math.min(0.22, obj.height * 0.28)
  const crystalRadius = obj.radius * 0.72
  const crystalH = Math.max(0.2, obj.height - baseH)

  group.add(cylinder(obj.radius, baseH, 0, baseH / 2, 0, obj.baseColor))

  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(crystalRadius, 0),
    new THREE.MeshStandardMaterial({
      color: obj.crystalColor,
      emissive: obj.crystalColor,
      emissiveIntensity: 0.9,
      roughness: 0.5,
    }),
  )
  crystal.position.set(0, baseH + crystalH * 0.46, 0)
  crystal.scale.y = crystalH / Math.max(0.001, crystalRadius * 2)
  crystal.rotation.y = Math.PI / 4
  group.add(crystal)

  const orbit = new THREE.Mesh(
    new THREE.TorusGeometry(obj.radius * 0.82, obj.radius * 0.035, 6, 18),
    new THREE.MeshStandardMaterial({ color: shade(obj.baseColor, 1.35), metalness: 0.35, roughness: 0.55 }),
  )
  orbit.position.y = baseH + crystalH * 0.44
  orbit.rotation.x = Math.PI / 2
  group.add(orbit)
  return group
}

/** Small wax cluster with emissive flame meshes only; intentionally no PointLight. */
export function buildCandle(obj: ObjectOf<'candle'>): THREE.Object3D {
  const group = new THREE.Group()
  const placements: readonly [number, number, number][] = [
    [0, 1, 0],
    [-1.35, 0.72, 0.55],
    [1.15, 0.58, -0.45],
  ]

  for (const [fx, scaleH, fz] of placements) {
    const h = obj.height * scaleH
    const r = obj.radius * (scaleH > 0.9 ? 1 : 0.82)
    const x = fx * obj.radius
    const z = fz * obj.radius
    group.add(cylinder(r, h, x, h / 2, z, obj.waxColor))

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.55, h * 0.62, 8),
      new THREE.MeshStandardMaterial({
        color: obj.flameColor,
        emissive: obj.flameColor,
        emissiveIntensity: 1.8,
      }),
    )
    flame.position.set(x, h + (h * 0.31), z)
    group.add(flame)
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

function cylinder(
  radius: number,
  height: number,
  x: number,
  y: number,
  z: number,
  color: THREE.ColorRepresentation,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 12),
    new THREE.MeshStandardMaterial({ color }),
  )
  mesh.position.set(x, y, z)
  return mesh
}

function shade(color: string, factor: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(factor)
}
