import * as THREE from 'three'
import type { LoadedRoom } from '../../../roomspec/schema'

/**
 * Builds the room's scene-wide lighting — ambient fill plus an optional
 * hemisphere gradient — from RoomSpec. Torch point lights are built per-object
 * in buildObjects; this covers only the global lights.
 *
 * Lights hold no GPU resources, so the engine's scene.clear() teardown frees
 * them; only the torch flame meshes need disposeObject's geometry/material pass.
 */
export function buildLighting(lighting: LoadedRoom['lighting']): THREE.Group {
  const group = new THREE.Group()
  group.name = 'lighting'

  const { color, intensity } = lighting.ambient
  group.add(new THREE.AmbientLight(color, intensity))

  if (lighting.hemisphere) {
    const { sky, ground, intensity: hemiIntensity } = lighting.hemisphere
    group.add(new THREE.HemisphereLight(sky, ground, hemiIntensity))
  }

  return group
}
