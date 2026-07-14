import * as THREE from 'three'
import type { HumanoidAppearance, HumanoidPaletteId, HumanoidPresetId } from '../../../domain/visuals/contracts'
import type { NpcRoutineNpcType } from '../../../domain/npcRoutinePresets'
import { stableHash32 } from '../../../domain/stableHash'
import type { Logger } from '../../../platform/logger/Logger'
import { CharacterAnimationController } from './CharacterAnimationController'
import type {
  HumanoidSelection,
  VisualPackRegistry,
} from '../visual-pack/contracts'
import type { VisualAssetLease } from '../visual-pack/VisualAssetCache'

export type HumanoidCharacterRole = 'player' | 'npc' | 'zombie'

export type HumanoidCharacterRequest = Readonly<{
  roomId: string
  stableId: string
  role: HumanoidCharacterRole
  appearance?: HumanoidAppearance
  npcType?: NpcRoutineNpcType
}>

export type HumanoidCharacterInstance = Readonly<{
  root: THREE.Group
  visualRoot: THREE.Group
  selection: HumanoidSelection
  animations: CharacterAnimationController
  updateFacing: (velocityX: number, velocityZ: number) => void
  dispose: () => void
}>

export type HumanoidAssetProvider = Readonly<{
  acquire: (assetId: string) => Promise<VisualAssetLease>
}>

/**
 * Shared production factory for the player and every supported bipedal
 * character. Quadrupeds, spiders, flyers, and other non-humanoid body plans
 * require separate future rigs and are intentionally not accepted here.
 */
export class HumanoidCharacterFactory {
  private readonly registry: VisualPackRegistry
  private readonly assets: HumanoidAssetProvider
  private readonly logger: Pick<Logger, 'warn'> | undefined
  private readonly reportedCompatibilityDiagnostics = new Set<string>()
  constructor(
    registry: VisualPackRegistry,
    assets: HumanoidAssetProvider,
    logger?: Pick<Logger, 'warn'>,
  ) {
    this.registry = registry
    this.assets = assets
    this.logger = logger
  }

  async create(request: HumanoidCharacterRequest): Promise<HumanoidCharacterInstance> {
    const preset = resolveHumanoidPreset(request)
    const definition = this.registry.humanoidPresets[preset]
    const selection = selectHumanoidParts(
      request.roomId + ':' + request.stableId,
      preset,
      request.appearance,
      definition,
    )
    const characterLease = await acquireCharacterLease(this.assets, 'humanoid.' + preset)
    let animationLease: VisualAssetLease | undefined
    try {
      animationLease = await this.assets.acquire('humanoid.animations')
    } catch {
      // A reviewed static/core character remains a production-safe fallback when
      // the optional animation bundle is unavailable.
      animationLease = undefined
    }

    try {
      const root = new THREE.Group()
      root.name = 'humanoid-character'
      root.userData.characterRole = request.role
      root.userData.humanoidPreset = preset
      root.userData.visualPackCharacter = true

      const visualRoot = new THREE.Group()
      visualRoot.name = 'visual-facing-root'
      root.add(visualRoot)
      visualRoot.add(characterLease.instance)

      applyModularSelection(characterLease.instance, selection, definition)
      applyHumanoidReadabilityPalette(characterLease.instance, selection.palette, request.role)

      const animations = new CharacterAnimationController(
        characterLease.instance,
        mergeAnimationClips(characterLease.animations, animationLease?.animations ?? []),
        this.registry.animationClips,
        {
          presetId: preset,
          logger: this.logger,
          reportedCompatibilityDiagnostics: this.reportedCompatibilityDiagnostics,
        },
      )
      let disposed = false

      return {
        root,
        visualRoot,
        selection,
        animations,
        updateFacing: (velocityX, velocityZ) => {
          if (Math.hypot(velocityX, velocityZ) < 0.001) return
          visualRoot.rotation.y = Math.atan2(velocityX, velocityZ)
        },
        dispose: () => {
          if (disposed) return
          disposed = true
          animations.dispose()
          disposeOwnedMaterials(characterLease.instance)
          visualRoot.remove(characterLease.instance)
          animationLease?.release()
          characterLease.release()
        },
      }
    } catch (error) {
      disposeOwnedMaterials(characterLease.instance)
      animationLease?.release()
      characterLease.release()
      throw error
    }
  }
}
async function acquireCharacterLease(
  assets: HumanoidAssetProvider,
  exactAssetId: string,
): Promise<VisualAssetLease> {
  try {
    return await assets.acquire(exactAssetId)
  } catch {
    return assets.acquire('humanoid.static-lod')
  }
}
function mergeAnimationClips(
  ...sources: readonly (readonly THREE.AnimationClip[])[]
): readonly THREE.AnimationClip[] {
  const clips = new Map<string, THREE.AnimationClip>()
  for (const source of sources) {
    for (const clip of source) clips.set(clip.name, clip)
  }
  return [...clips.values()]
}

export function resolveHumanoidPreset(
  request: HumanoidCharacterRequest,
): HumanoidPresetId {
  if (request.appearance?.preset) return request.appearance.preset
  if (request.role === 'zombie') return 'zombie'
  if (request.role === 'player') return 'wanderer'

  switch (request.npcType) {
    case 'guard':
      return 'guard'
    case 'merchant':
      return 'merchant'
    case 'villager':
      return 'villager'
    case 'noble':
      return 'noble'
    case 'servant':
      return 'servant'
    case 'wanderer':
      return 'wanderer'
    case 'static_npc':
    case undefined:
      return 'human-commoner'
  }
}

export function selectHumanoidParts(
  seed: string,
  preset: HumanoidPresetId,
  appearance: HumanoidAppearance | undefined,
  definition: VisualPackRegistry['humanoidPresets'][HumanoidPresetId],
): HumanoidSelection {
  const presentation = appearance?.presentation ?? definition.defaultPresentation
  const palette = appearance?.palette ?? definition.defaultPalette
  const infection = appearance?.infection ?? definition.defaultInfection
  const accessories = appearance?.accessories ?? definition.defaultAccessories
  const selectionSeed = [
    seed,
    preset,
    presentation,
    palette,
    infection,
    accessories,
  ].join(':')

  return {
    preset,
    presentation,
    palette,
    infection,
    accessories,
    bodyId: choose(
      bodiesForPresentation(definition.bodyPool, presentation),
      selectionSeed + ':body',
    ),
    headId: choose(definition.headPool, selectionSeed + ':head'),
    hairId: choose(definition.hairPool, selectionSeed + ':hair'),
    outfitId: choose(definition.outfitPool, selectionSeed + ':outfit'),
    armourId: choose(definition.armourPool, selectionSeed + ':armour'),
  }
}

function bodiesForPresentation(
  bodyPool: readonly string[],
  presentation: HumanoidSelection['presentation'],
): readonly string[] {
  const matching = bodyPool.filter((id) => id.startsWith('body-' + presentation + '-'))
  return matching.length > 0 ? matching : bodyPool
}

function choose(values: readonly string[], seed: string): string {
  return values[stableHash32(seed) % values.length]!
}

function applyModularSelection(
  root: THREE.Object3D,
  selection: HumanoidSelection,
  definition: VisualPackRegistry['humanoidPresets'][HumanoidPresetId],
): void {
  const selected = new Set([
    selection.bodyId,
    selection.headId,
    selection.hairId,
    selection.outfitId,
    selection.armourId,
    'accessory-' + selection.accessories,
    'infection-' + selection.infection,
  ])
  selected.add(bodyNodeName(selection.bodyId))
  const controlled = new Set([
    ...definition.bodyPool,
    'body-a',
    'body-b',
    'body-c',
    ...definition.headPool,
    ...definition.hairPool,
    ...definition.outfitPool,
    ...definition.armourPool,
    'accessory-none',
    'accessory-traveller',
    'accessory-merchant',
    'accessory-guard',
    'accessory-noble',
    'accessory-raider',
    'accessory-survivor',
    'infection-none',
    'infection-early',
    'infection-advanced',
  ])

  root.traverse((node) => {
    if (controlled.has(node.name)) node.visible = selected.has(node.name)
  })
}

function bodyNodeName(bodyId: string): string {
  if (bodyId.startsWith('body-masculine-')) return 'body-a'
  if (bodyId.startsWith('body-feminine-')) return 'body-b'
  if (bodyId.startsWith('body-neutral-')) return 'body-c'
  return bodyId
}

type HumanoidMaterialPart = 'cloth' | 'hair' | 'skin'

type HumanoidReadabilityPalette = Readonly<{
  cloth: string
  hair: string
}>

// These are deliberately mid-value albedos. The source GLB has textured,
// vertex-coloured PBR materials, so multiplying it by the former dark role
// swatches made cloth, hair, and even skin collapse into near-black in the
// tavern/crypt fill. Palette remains renderer-owned presentation only.
const READABILITY_PALETTES: Readonly<Record<HumanoidPaletteId, HumanoidReadabilityPalette>> = {
  earth: { cloth: '#a77852', hair: '#654632' },
  village: { cloth: '#a58d5d', hair: '#72503a' },
  guard: { cloth: '#6d8192', hair: '#4f4035' },
  merchant: { cloth: '#b37b43', hair: '#654230' },
  royal: { cloth: '#8669a1', hair: '#513b32' },
  raider: { cloth: '#8c604c', hair: '#48362f' },
  survivor: { cloth: '#71876a', hair: '#594536' },
  undead: { cloth: '#82966f', hair: '#4c5542' },
  monster: { cloth: '#8a6759', hair: '#4a3b36' },
}

const PLAYER_SURVIVOR_ACCENT = new THREE.Color('#c69a57')
const SKIN_READABILITY_FILL = new THREE.Color('#6b4a36')

export function applyHumanoidReadabilityPalette(
  root: THREE.Object3D,
  palette: HumanoidPaletteId,
  role: HumanoidCharacterRole,
): void {
  const colors = READABILITY_PALETTES[palette]
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const adjusted = materials.map((material) => applyReadabilityMaterial(material, node, colors, role))
    if (adjusted.every((material, index) => material === materials[index])) return
    // A multi-material mesh is disposed as a unit. Clone its untouched slots
    // too, so an owned readability override never disposes a cache-owned
    // shared material when the character leaves the room.
    const owned = adjusted.map((material, index) => (
      material === materials[index] ? material.clone() : material
    ))
    mesh.material = Array.isArray(mesh.material) ? owned : owned[0]!
    mesh.userData.visualPackOwnedMaterial = true
  })
}

function applyReadabilityMaterial(
  material: THREE.Material,
  node: THREE.Object3D,
  colors: HumanoidReadabilityPalette,
  role: HumanoidCharacterRole,
): THREE.Material {
  const part = humanoidMaterialPart(material, node)
  if (part === undefined) return material

  const clone = material.clone()
  if (!('color' in clone) || !(clone.color instanceof THREE.Color)) return clone

  if (part === 'skin') {
    applyMaterialFill(clone, SKIN_READABILITY_FILL, 0.035)
    return clone
  }

  const color = new THREE.Color(part === 'hair' ? colors.hair : colors.cloth)
  // A player-only warm lift makes the renderer-owned survivor preset easy to
  // pick out without adding an object, state field, or special gameplay path.
  if (role === 'player' && part === 'cloth') color.lerp(PLAYER_SURVIVOR_ACCENT, 0.28)
  clone.color.lerp(color, part === 'cloth' ? 0.62 : 0.48)
  applyMaterialFill(clone, color, part === 'cloth' ? 0.075 : 0.045)
  return clone
}

function humanoidMaterialPart(
  material: THREE.Material,
  node: THREE.Object3D,
): HumanoidMaterialPart | undefined {
  const tintable = node.userData.tintable === true || material.name.startsWith('Tintable')
  if (!tintable) return undefined

  const name = material.name.toLowerCase()
  if (name.includes('hair')) return 'hair'
  if (name.includes('superhero') || name.includes('skin')) return 'skin'
  return 'cloth'
}

function applyMaterialFill(material: THREE.Material, color: THREE.Color, intensity: number): void {
  if (!('emissive' in material) || !(material.emissive instanceof THREE.Color)) return
  material.emissive.copy(color)
  if ('emissiveIntensity' in material) material.emissiveIntensity = intensity
}

function disposeOwnedMaterials(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || mesh.userData.visualPackOwnedMaterial !== true) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of new Set(materials)) material.dispose()
  })
}
