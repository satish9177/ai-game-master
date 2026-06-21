import type * as THREE from 'three'

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

/** Disposes every geometry, material, and texture under an object graph. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = mesh.material
    if (!material) return
    if (Array.isArray(material)) material.forEach(disposeMaterial)
    else disposeMaterial(material)
  })
}

function disposeMaterial(material: THREE.Material): void {
  // Dispose any textures referenced by the material's properties.
  const record = material as unknown as Record<string, unknown>
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) {
      ;(value as THREE.Texture).dispose()
    }
  }
  material.dispose()
}
