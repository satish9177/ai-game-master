import * as THREE from 'three'
import type { GeneratedRoomVisualTheme } from '../../../domain/generatedRoomThemeVocabulary'
import type { RoomObject } from '../../../domain/roomSpec'
import {
  makeThemedStandardMaterial,
  themedAccentColor,
  themedEmissiveColor,
} from './materialTheme'

/** Trusted procedural builders for strange devices, artifacts, and tiny lights. */

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

/** Broken device silhouette: chassis, panel, vents, and fixed pipe shapes. */
export function buildMachine(
  obj: ObjectOf<'machine'>,
  visualTheme: GeneratedRoomVisualTheme | null = null,
): THREE.Object3D {
  const [rawWidth, rawHeight, rawDepth] = obj.size
  const width = Math.max(rawWidth, 1.85)
  const height = Math.max(rawHeight, 1.35)
  const depth = Math.max(rawDepth, 1.15)
  const group = new THREE.Group()
  const baseH = height * 0.22
  const bodyH = height * 0.58

  const accent = themedAccentColor(visualTheme) ?? obj.panelColor
  // Indicator emissive is theme-gated only: a null theme must keep the original
  // non-glowing shaded-panel look, never fall back to obj.panelColor as emissive.
  const emissive = themedEmissiveColor(visualTheme) ?? undefined

  group.add(box(width, baseH, depth, 0, baseH / 2, 0, shade(obj.color, 0.7), visualTheme, 'industrial'))
  group.add(box(width * 0.86, bodyH, depth * 0.72, 0, baseH + bodyH / 2, 0, obj.color, visualTheme, 'industrial'))
  group.add(box(width * 0.24, bodyH * 0.82, depth * 0.55, -width * 0.43, baseH + bodyH * 0.46, depth * 0.06, shade(obj.color, 0.82), visualTheme, 'industrial'))
  group.add(box(width * 0.48, height * 0.28, depth * 0.08, -width * 0.08, baseH + bodyH * 0.62, -depth * 0.38, accent, visualTheme, 'industrial'))

  for (const x of [-0.27, -0.09, 0.09, 0.27]) {
    const indicatorColor = visualTheme ? accent : shade(obj.panelColor, 1.35)
    group.add(box(width * 0.08, height * 0.03, depth * 0.1, x * width, baseH + bodyH * 0.68, -depth * 0.43, indicatorColor, visualTheme, 'special', emissive, emissive ? 0.28 : undefined))
  }
  for (const z of [-0.18, 0.02, 0.22]) {
    const indicatorColor = visualTheme ? accent : shade(obj.panelColor, 1.45)
    group.add(box(width * 0.08, height * 0.08, depth * 0.05, width * 0.32, baseH + bodyH * 0.42, z * depth, indicatorColor, visualTheme, 'special', emissive, emissive ? 0.24 : undefined))
  }

  const pipeA = cylinder(width * 0.045, depth * 0.78, width * 0.34, baseH + bodyH * 0.5, depth * 0.35, obj.pipeColor, visualTheme, 'industrial')
  pipeA.rotation.x = Math.PI / 2
  group.add(pipeA)

  const pipeB = cylinder(width * 0.035, height * 0.5, -width * 0.43, baseH + bodyH * 0.38, 0, shade(obj.pipeColor, 0.75), visualTheme, 'industrial')
  pipeB.rotation.z = 0.18
  group.add(pipeB)

  group.add(box(width * 0.28, height * 0.14, depth * 0.24, width * 0.34, baseH + bodyH + height * 0.07, 0, shade(obj.color, 1.18), visualTheme, 'industrial'))
  group.add(box(width * 0.16, height * 0.36, depth * 0.16, width * 0.46, baseH + bodyH + height * 0.18, -depth * 0.18, shade(obj.pipeColor, 1.1), visualTheme, 'industrial'))
  return group
}

/** Plinth plus fixed emissive crystal. No behavior or dynamic lighting. */
export function buildArtifact(
  obj: ObjectOf<'artifact'>,
  visualTheme: GeneratedRoomVisualTheme | null = null,
): THREE.Object3D {
  const group = new THREE.Group()
  const radius = Math.max(obj.radius, 0.42)
  const height = Math.max(obj.height, 1.05)
  const baseH = Math.min(0.24, height * 0.28)
  const crystalRadius = radius * 0.66
  const crystalH = Math.max(0.2, height - baseH)

  group.add(cylinder(radius, baseH, 0, baseH / 2, 0, obj.baseColor, visualTheme, 'special'))
  group.add(cylinder(radius * 0.78, baseH * 0.6, 0, baseH + baseH * 0.3, 0, shade(obj.baseColor, 1.28), visualTheme, 'special'))

  const emissive = themedEmissiveColor(visualTheme) ?? obj.crystalColor
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(crystalRadius, 0),
    makeThemedStandardMaterial(obj.crystalColor, visualTheme, 'special', {
      color: obj.crystalColor,
      emissive,
      emissiveIntensity: 0.9,
      roughness: 0.5,
    }),
  )
  crystal.position.set(0, baseH + crystalH * 0.46, 0)
  crystal.scale.y = crystalH / Math.max(0.001, crystalRadius * 2)
  crystal.rotation.y = Math.PI / 4
  group.add(crystal)

  for (const angle of [0, Math.PI / 2]) {
    const shard = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 0.12, height * 0.34, 4),
      makeThemedStandardMaterial(shade(obj.crystalColor, 0.9), visualTheme, 'special', {
        emissive,
        emissiveIntensity: 0.35,
      }),
    )
    shard.position.set(Math.cos(angle) * radius * 0.62, baseH + height * 0.2, Math.sin(angle) * radius * 0.62)
    shard.rotation.z = angle === 0 ? -0.55 : 0.55
    group.add(shard)
  }
  return group
}

/** Small wax cluster with emissive flame meshes only; intentionally no PointLight. */
export function buildCandle(
  obj: ObjectOf<'candle'>,
  visualTheme: GeneratedRoomVisualTheme | null = null,
): THREE.Object3D {
  const group = new THREE.Group()
  const radius = Math.max(obj.radius, 0.12)
  const height = Math.max(obj.height, 0.34)
  const placements: readonly [number, number, number][] = [
    [0, 1, 0],
    [-1.35, 0.72, 0.55],
    [1.15, 0.58, -0.45],
  ]

  for (const [fx, scaleH, fz] of placements) {
    const h = height * scaleH
    const r = radius * (scaleH > 0.9 ? 1 : 0.82)
    const x = fx * radius
    const z = fz * radius
    group.add(cylinder(r, h, x, h / 2, z, obj.waxColor, visualTheme, 'special'))

    const emissive = themedEmissiveColor(visualTheme) ?? obj.flameColor
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.62, h * 0.72, 8),
      makeThemedStandardMaterial(obj.flameColor, visualTheme, 'special', {
        color: obj.flameColor,
        emissive,
        emissiveIntensity: 1.8,
      }),
    )
    flame.position.set(x, h + (h * 0.31), z)
    group.add(flame)
  }
  group.add(cylinder(radius * 2.25, 0.035, 0, 0.0175, 0, '#5a4030', visualTheme, 'special'))
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
  visualTheme: GeneratedRoomVisualTheme | null = null,
  role: 'industrial' | 'special' = 'special',
  emissive?: THREE.ColorRepresentation,
  emissiveIntensity?: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    makeThemedStandardMaterial(color, visualTheme, role, {
      ...(emissive !== undefined ? { emissive } : {}),
      ...(emissiveIntensity !== undefined ? { emissiveIntensity } : {}),
    }),
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
  visualTheme: GeneratedRoomVisualTheme | null = null,
  role: 'industrial' | 'special' = 'special',
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 12),
    makeThemedStandardMaterial(color, visualTheme, role),
  )
  mesh.position.set(x, y, z)
  return mesh
}

function shade(color: string, factor: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(factor)
}
