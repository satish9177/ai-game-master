import * as THREE from 'three'
import {
  themeVocabulary,
  type GeneratedRoomVisualTheme,
} from '../../../domain/generatedRoomThemeVocabulary'
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
  theme: GeneratedRoomVisualTheme | null = null,
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'lighting'

  const { color, intensity } = lighting.ambient
  const ambient = new THREE.AmbientLight(
    gradeLightingColor(color, theme, 'ambient'),
    intensity,
  )
  ambient.name = 'room-ambient-fill'
  group.add(ambient)

  if (lighting.hemisphere) {
    const { sky, ground, intensity: hemiIntensity } = lighting.hemisphere
    const hemisphere = new THREE.HemisphereLight(
      gradeLightingColor(sky, theme, 'hemisphereSky'),
      gradeLightingColor(ground, theme, 'hemisphereGround'),
      hemiIntensity,
    )
    hemisphere.name = 'room-hemisphere-fill'
    group.add(hemisphere)
  }

  const sun = buildKeyLight(dimensions, theme)
  group.add(sun)
  group.add(sun.target) // target at room centre; in the graph so its pose applies

  return group
}

/**
 * Renderer-internal key-light direction, FROM the room centre TOWARD the light:
 * high up and over the far (north/west) corner, so shadows fall toward the open
 * south/east cutaway side and read clearly from the fixed isometric camera.
 */
const KEY_LIGHT_DIR = new THREE.Vector3(-0.55, 1.5, -0.5).normalize()
const KEY_LIGHT_COLOR = '#fff6e8' // faint warm sun, neutral enough not to recolour rooms
const KEY_LIGHT_INTENSITY = 2.35
const SHADOW_MAP_SIZE = 2048

type LightingColorRole = 'ambient' | 'hemisphereSky' | 'hemisphereGround' | 'key'

const THEME_LIGHTING_GRADE: Record<
  GeneratedRoomVisualTheme,
  Record<LightingColorRole, { amount: number }>
> = {
  'fantasy-keep': {
    ambient: { amount: 0.18 },
    hemisphereSky: { amount: 0.14 },
    hemisphereGround: { amount: 0.16 },
    key: { amount: 0.18 },
  },
  'post-apoc': {
    ambient: { amount: 0.2 },
    hemisphereSky: { amount: 0.18 },
    hemisphereGround: { amount: 0.16 },
    key: { amount: 0.22 },
  },
}

function lightingGradeTarget(
  theme: GeneratedRoomVisualTheme,
  role: LightingColorRole,
  fallbackColor: string,
): string {
  const palette = themeVocabulary(theme).palette
  if (theme === 'fantasy-keep') {
    if (role === 'hemisphereSky') {
      return palette.prop[3] ?? palette.wall[2] ?? palette.wall[0] ?? fallbackColor
    }
    if (role === 'hemisphereGround') return palette.floor[0] ?? fallbackColor
    return palette.prop[2] ?? palette.prop[0] ?? fallbackColor
  }

  if (role === 'hemisphereGround') return palette.floor[0] ?? fallbackColor
  return palette.wall[2] ?? palette.wall[0] ?? fallbackColor
}

export function gradeLightingColor(
  color: string,
  theme: GeneratedRoomVisualTheme | null,
  role: LightingColorRole,
): string {
  if (theme === null) return color

  const grade = THEME_LIGHTING_GRADE[theme][role]
  return `#${new THREE.Color(color)
    .lerp(new THREE.Color(lightingGradeTarget(theme, role, color)), grade.amount)
    .getHexString()}`
}

/**
 * A directional "sun" whose orthographic shadow frustum is fit deterministically
 * to the room's bounding sphere (from width/depth/height) and positioned at twice
 * that radius along the light direction. This keeps shadows crisp and clip-free
 * for any room size without any per-frame fitting — same dimensions in, same
 * frustum out.
 */
function buildKeyLight(
  dimensions: LoadedRoom['shell']['dimensions'],
  theme: GeneratedRoomVisualTheme | null,
): THREE.DirectionalLight {
  const { width, depth, height } = dimensions
  const sun = new THREE.DirectionalLight(
    gradeLightingColor(KEY_LIGHT_COLOR, theme, 'key'),
    KEY_LIGHT_INTENSITY,
  )
  sun.name = 'room-key-light'

  // Bounding-sphere radius (+margin) covers the whole room from the light's angle.
  const radius = 0.5 * Math.hypot(width, depth, height) + 1
  const distance = radius * 2
  sun.position.copy(KEY_LIGHT_DIR).multiplyScalar(distance)
  sun.target.position.set(0, 0, 0)

  sun.castShadow = true
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  // A small negative depth bias anchors contact shadows while normal bias keeps
  // broad, flat low-poly faces free of acne. Radius softens the authored edge.
  sun.shadow.bias = -0.0002
  sun.shadow.normalBias = 0.035
  sun.shadow.radius = 2

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
