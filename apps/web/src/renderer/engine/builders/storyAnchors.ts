import * as THREE from 'three'
import type { GeneratedRoomVisualTheme } from '../../../domain/generatedRoomThemeVocabulary'
import type { RoomObject } from '../../../domain/roomSpec'
import {
  makeThemedStandardMaterial,
  themedAccentColor,
} from './materialTheme'

/** Trusted procedural builders for inert story-anchor visuals. */

type ObjectOf<K extends RoomObject['type']> = Extract<RoomObject, { type: K }>

/** Tiered floor altar: broad base, raised slab, accent inlay, and side blocks. */
export function buildAltar(
  obj: ObjectOf<'altar'>,
  visualTheme: GeneratedRoomVisualTheme | null = null,
): THREE.Object3D {
  const [rawWidth, rawHeight, rawDepth] = obj.size
  const width = Math.max(rawWidth, 2.0)
  const height = Math.max(rawHeight, 1.25)
  const depth = Math.max(rawDepth, 1.25)
  const group = new THREE.Group()
  const baseH = height * 0.28
  const midH = height * 0.34
  const topH = height * 0.22
  const accentH = Math.max(0.035, height * 0.05)

  const accent = themedAccentColor(visualTheme) ?? obj.accentColor

  group.add(box(width, baseH, depth, 0, baseH / 2, 0, shade(obj.color, 0.72), visualTheme))
  group.add(box(width * 0.78, midH, depth * 0.82, 0, baseH + midH / 2, 0, obj.color, visualTheme))
  group.add(box(width * 0.9, topH, depth * 0.92, 0, baseH + midH + topH / 2, 0, shade(obj.color, 1.15), visualTheme))
  group.add(box(width * 0.46, accentH, depth * 0.18, 0, height - accentH / 2, -depth * 0.16, accent, visualTheme))

  const sideW = width * 0.12
  for (const x of [-1, 1]) {
    group.add(box(sideW, height * 0.42, depth * 0.72, x * width * 0.36, baseH + height * 0.21, 0, shade(obj.color, 0.85), visualTheme))
  }
  const rearStone = box(width * 0.34, height * 0.36, depth * 0.1, 0, height * 0.78, depth * 0.35, shade(obj.color, 0.62), visualTheme)
  rearStone.rotation.x = -0.08
  group.add(rearStone)
  group.add(box(width * 0.18, accentH * 1.35, depth * 0.46, 0, height + accentH * 0.2, 0, accent, visualTheme))
  return group
}

/** Pedestal and simplified obelisk/figure silhouette, static and floor-anchored. */
export function buildStatue(
  obj: ObjectOf<'statue'>,
  visualTheme: GeneratedRoomVisualTheme | null = null,
): THREE.Object3D {
  const group = new THREE.Group()
  const radius = Math.max(obj.radius, 0.5)
  const height = Math.max(obj.height, 2.45)
  const pedestalH = Math.min(0.52, height * 0.22)
  const figureH = Math.max(0.2, height - pedestalH)
  const pedestalR = radius * 1.18
  const figureR = radius * 0.62

  group.add(cylinder(pedestalR, pedestalR * 1.08, pedestalH, 0, pedestalH / 2, 0, obj.pedestalColor, visualTheme))
  group.add(cylinder(figureR * 0.9, figureR, figureH * 0.72, 0, pedestalH + figureH * 0.36, 0, obj.color, visualTheme))

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(figureR * 0.58, 12, 8),
    makeThemedStandardMaterial(shade(obj.color, 1.08), visualTheme, 'focalAnchor'),
  )
  head.position.set(0, pedestalH + figureH * 0.82, 0)
  group.add(head)

  const crest = new THREE.Mesh(
    new THREE.ConeGeometry(figureR * 0.45, figureH * 0.28, 8),
    makeThemedStandardMaterial(shade(obj.color, 0.9), visualTheme, 'focalAnchor'),
  )
  crest.position.set(0, pedestalH + figureH * 0.99, 0)
  group.add(crest)

  group.add(box(radius * 1.35, figureH * 0.08, radius * 0.18, 0, pedestalH + figureH * 0.53, figureR * 0.82, shade(obj.color, 0.82), visualTheme))
  group.add(box(radius * 0.18, figureH * 0.42, radius * 0.16, -figureR * 0.82, pedestalH + figureH * 0.48, 0, shade(obj.color, 0.88), visualTheme))
  group.add(box(radius * 0.18, figureH * 0.42, radius * 0.16, figureR * 0.82, pedestalH + figureH * 0.48, 0, shade(obj.color, 0.88), visualTheme))
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
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    makeThemedStandardMaterial(color, visualTheme, 'focalAnchor'),
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
  visualTheme: GeneratedRoomVisualTheme | null = null,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 12),
    makeThemedStandardMaterial(color, visualTheme, 'focalAnchor'),
  )
  mesh.position.set(x, y, z)
  return mesh
}

function shade(color: string, factor: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(factor)
}
