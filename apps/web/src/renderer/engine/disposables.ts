import type * as THREE from 'three'
import { isVisualPackSharedResource } from './visual-pack/VisualAssetCache'

/**
 * GPU resources in Three.js are not garbage collected — geometries, materials,
 * and textures must be disposed explicitly. These helpers centralize that so
 * the engine can tear everything down on unmount with no leaks.
 */

type Disposable = { dispose: () => void }

/** Tracks ad-hoc disposables (e.g. shared materials) for a single teardown. */
export class Disposables {
  private readonly items = new Set<Disposable>()

  add<T extends Disposable>(item: T): T {
    this.items.add(item)
    return item
  }

  dispose(): void {
    for (const item of this.items) item.dispose()
    this.items.clear()
  }
}

/**
 * Disposes resources owned by a room graph. Visual-pack clones borrow immutable
 * geometry/textures from the pack cache and are deliberately skipped here.
 */
export function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const ownedMaterials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()

  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    const shared = isVisualPackSharedResource(child)
    if (mesh.geometry && !shared) geometries.add(mesh.geometry)
    const material = mesh.material
    if (!material) return
    const values = Array.isArray(material) ? material : [material]
    if (mesh.userData.visualPackOwnedMaterial === true) {
      for (const value of values) ownedMaterials.add(value)
    } else if (!shared) {
      for (const value of values) {
        materials.add(value)
        collectTextures(value, textures)
      }
    }
  })

  for (const geometry of geometries) geometry.dispose()
  for (const texture of textures) texture.dispose()
  for (const material of materials) material.dispose()
  // Per-instance tint materials reuse cache-owned textures.
  for (const material of ownedMaterials) material.dispose()
}

function collectTextures(
  material: THREE.Material,
  textures: Set<THREE.Texture>,
): void {
  const record = material as unknown as Record<string, unknown>
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) {
      textures.add(value as THREE.Texture)
    }
  }
}
