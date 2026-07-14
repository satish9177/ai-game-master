import * as THREE from 'three'
import {
  themeVocabulary,
  type GeneratedRoomVisualTheme,
} from '../../../domain/generatedRoomThemeVocabulary'

export type ThemeMaterialRole = 'shell' | 'focalAnchor' | 'industrial' | 'special'

export type ThemedMaterialFinish = Pick<
  THREE.MeshStandardMaterialParameters,
  'roughness' | 'metalness' | 'flatShading'
>

const THEMED_FINISH: Record<
  GeneratedRoomVisualTheme,
  Record<ThemeMaterialRole, ThemedMaterialFinish>
> = {
  'fantasy-keep': {
    shell: { roughness: 0.94, metalness: 0, flatShading: true },
    focalAnchor: { roughness: 0.86, metalness: 0.01, flatShading: true },
    industrial: { roughness: 0.74, metalness: 0.2, flatShading: true },
    special: { roughness: 0.64, metalness: 0.04, flatShading: true },
  },
  'post-apoc': {
    shell: { roughness: 0.93, metalness: 0.02, flatShading: true },
    focalAnchor: { roughness: 0.88, metalness: 0.04, flatShading: true },
    industrial: { roughness: 0.72, metalness: 0.28, flatShading: true },
    special: { roughness: 0.66, metalness: 0.1, flatShading: true },
  },
}

export function themedMaterialFinish(
  theme: GeneratedRoomVisualTheme | null,
  role: ThemeMaterialRole,
): ThemedMaterialFinish | null {
  if (theme === null) return null
  return THEMED_FINISH[theme][role]
}

export function themedAccentColor(theme: GeneratedRoomVisualTheme | null): string | null {
  if (theme === null) return null
  return themeVocabulary(theme).palette.accent
}

export function themedEmissiveColor(theme: GeneratedRoomVisualTheme | null): string | null {
  if (theme === null) return null
  return themeVocabulary(theme).palette.emissive
}

export function themedMaterialParameters(
  theme: GeneratedRoomVisualTheme | null,
  role: ThemeMaterialRole,
): Partial<THREE.MeshStandardMaterialParameters> {
  return themedMaterialFinish(theme, role) ?? {}
}

export function makeThemedStandardMaterial(
  color: THREE.ColorRepresentation,
  theme: GeneratedRoomVisualTheme | null,
  role: ThemeMaterialRole,
  material: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    ...themedMaterialParameters(theme, role),
    ...material,
  })
}
