import * as THREE from 'three'
import {
  themeVocabulary,
  type GeneratedRoomVisualTheme,
} from '../../../domain/generatedRoomThemeVocabulary'

export type ThemeMaterialRole = 'shell' | 'focalAnchor' | 'industrial' | 'special'

export type ThemedMaterialFinish = Pick<
  THREE.MeshStandardMaterialParameters,
  'roughness' | 'metalness'
>

const THEMED_FINISH: Record<
  GeneratedRoomVisualTheme,
  Record<ThemeMaterialRole, ThemedMaterialFinish>
> = {
  'fantasy-keep': {
    shell: { roughness: 0.88, metalness: 0.01 },
    focalAnchor: { roughness: 0.84, metalness: 0.02 },
    industrial: { roughness: 0.82, metalness: 0.03 },
    special: { roughness: 0.72, metalness: 0.03 },
  },
  'post-apoc': {
    shell: { roughness: 0.9, metalness: 0.08 },
    focalAnchor: { roughness: 0.86, metalness: 0.06 },
    industrial: { roughness: 0.78, metalness: 0.16 },
    special: { roughness: 0.68, metalness: 0.12 },
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
