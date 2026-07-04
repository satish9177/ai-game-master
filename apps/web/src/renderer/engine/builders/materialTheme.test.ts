import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'
import type { RoomObject } from '../../../domain/roomSpec'
import type { Logger } from '../../../platform/logger/Logger'
import { buildObjects } from './index'
import {
  makeThemedStandardMaterial,
  themedAccentColor,
  themedEmissiveColor,
  themedMaterialFinish,
} from './materialTheme'
import materialThemeSource from './materialTheme.ts?raw'
import objectBuilderSource from './index.ts?raw'
import shellSource from './shell.ts?raw'
import storyAnchorsSource from './storyAnchors.ts?raw'
import strangeDevicesSource from './strangeDevices.ts?raw'

const noopLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {}, child() { return noopLogger },
}

function roomWith(objects: RoomObject[]): LoadedRoom {
  return { objects, skipped: [] } as unknown as LoadedRoom
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) found.push(node as THREE.Mesh)
  })
  return found
}

function standardMaterials(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  return meshes(root).flatMap((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    return materials.filter(
      (material): material is THREE.MeshStandardMaterial =>
        material instanceof THREE.MeshStandardMaterial,
    )
  })
}

describe('theme material helpers', () => {
  it('returns the expected fantasy-keep themed finish', () => {
    expect(themedMaterialFinish('fantasy-keep', 'shell')).toEqual({
      roughness: 0.88,
      metalness: 0.01,
    })
    expect(themedMaterialFinish('fantasy-keep', 'focalAnchor')).toEqual({
      roughness: 0.84,
      metalness: 0.02,
    })
  })

  it('returns the expected post-apoc themed finish', () => {
    expect(themedMaterialFinish('post-apoc', 'shell')).toEqual({
      roughness: 0.9,
      metalness: 0.08,
    })
    expect(themedMaterialFinish('post-apoc', 'industrial')).toEqual({
      roughness: 0.78,
      metalness: 0.16,
    })
  })

  it('returns null/default finish for neutral theme', () => {
    expect(themedMaterialFinish(null, 'shell')).toBeNull()

    const material = makeThemedStandardMaterial('#123456', null, 'special')
    expect(material.color.getHexString()).toBe('123456')
    expect(material.roughness).toBeCloseTo(1)
    expect(material.metalness).toBeCloseTo(0)
    expect(material.emissive.getHexString()).toBe('000000')
  })

  it('exposes theme accent and emissive only when a theme is present', () => {
    expect(themedAccentColor('fantasy-keep')).toBe('#c4a15a')
    expect(themedEmissiveColor('post-apoc')).toBe('#9ad7d3')
    expect(themedAccentColor(null)).toBeNull()
    expect(themedEmissiveColor(null)).toBeNull()
  })

  it('keeps normal props on their base color and neutral material behavior under a theme', () => {
    const prop: Extract<RoomObject, { type: 'prop' }> = {
      type: 'prop',
      shape: 'box',
      size: [1, 1, 1],
      color: '#336699',
      position: [0, 0, 0],
      rotationY: 0,
      scale: 1,
    }
    const built = buildObjects(roomWith([prop]), noopLogger, undefined, 'post-apoc')
    const [material] = standardMaterials(built)

    expect(material?.color.getHexString()).toBe('336699')
    expect(material?.roughness).toBeCloseTo(1)
    expect(material?.metalness).toBeCloseTo(0)
    expect(material?.emissive.getHexString()).toBe('000000')
  })

  it('does not import forbidden App, provider, memory, persistence, dialogue, or FTS modules', () => {
    const imports = [
      materialThemeSource,
      objectBuilderSource,
      shellSource,
      storyAnchorsSource,
      strangeDevicesSource,
    ]
      .join('\n')
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .join('\n')

    expect(imports).not.toContain('App')
    expect(imports).not.toContain('provider')
    expect(imports).not.toContain('memory')
    expect(imports).not.toContain('persistence')
    expect(imports).not.toContain('dialogue')
    expect(imports).not.toContain('fts')
    expect(imports).not.toContain('FTS')
  })
})
