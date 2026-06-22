import * as THREE from 'three'
import type { LoadedRoom } from '../../../domain/loadRoomSpec'

/**
 * Builds the room's scene-wide lighting — ambient fill plus an optional
 * hemisphere gradient from RoomSpec, plus a renderer-internal directional "key
 * light" that casts shadows for depth/form. Torch point lights are built
 * per-object in buildObjects; this covers only the global lights.
 *
 * The ambient/hemisphere intensities come from RoomSpec (room mood). The key
 * light is **presentation, not room data** — its colour, direction, and
 * shadow-frustum fit are renderer-internal, like the isometric camera
 * ([ADR-0012]); RoomSpec is never consulted for it and gains no new fields.
 *
 * Lights hold no geometry/material, so the engine's disposeObject pass is a
 * no-op for them; the key light's shadow map is a renderer resource freed when
 * the engine disposes its WebGL context (one engine per room — no accumulation).
 */
export function buildLighting(
  lighting: LoadedRoom['lighting'],
  dimensions: LoadedRoom['shell']['dimensions'],
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'lighting'

  const { color, intensity } = lighting.ambient
  group.add(new THREE.AmbientLight(color, intensity))

  if (lighting.hemisphere) {
    const { sky, ground, intensity: hemiIntensity } = lighting.hemisphere
    group.add(new THREE.HemisphereLight(sky, ground, hemiIntensity))
  }

  const sun = buildKeyLight(dimensions)
  group.add(sun)
  group.add(sun.target) // target at room centre; in the graph so its pose applies

  return group
}

/**
 * Renderer-internal key-light direction, FROM the room centre TOWARD the light:
 * high up and over the far (north/west) corner, so shadows fall toward the open
 * south/east cutaway side and read clearly from the fixed isometric camera.
 */
const KEY_LIGHT_DIR = new THREE.Vector3(-0.55, 1.4, -0.5).normalize()
const KEY_LIGHT_COLOR = '#fff2e0' // faint warm sun, neutral enough not to recolour rooms
const KEY_LIGHT_INTENSITY = 2.2
const SHADOW_MAP_SIZE = 2048

/**
 * A directional "sun" whose orthographic shadow frustum is fit deterministically
 * to the room's bounding sphere (from width/depth/height) and positioned at twice
 * that radius along the light direction. This keeps shadows crisp and clip-free
 * for any room size without any per-frame fitting — same dimensions in, same
 * frustum out.
 */
function buildKeyLight(dimensions: LoadedRoom['shell']['dimensions']): THREE.DirectionalLight {
  const { width, depth, height } = dimensions
  const sun = new THREE.DirectionalLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY)

  // Bounding-sphere radius (+margin) covers the whole room from the light's angle.
  const radius = 0.5 * Math.hypot(width, depth, height) + 1
  const distance = radius * 2
  sun.position.copy(KEY_LIGHT_DIR).multiplyScalar(distance)
  sun.target.position.set(0, 0, 0)

  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  sun.shadow.normalBias = 0.02 // hide self-shadow acne on flat low-poly faces

  const cam = sun.shadow.camera
  cam.left = -radius
  cam.right = radius
  cam.top = radius
  cam.bottom = -radius
  cam.near = Math.max(0.1, distance - radius)
  cam.far = distance + radius
  cam.updateProjectionMatrix()

  return sun
}
