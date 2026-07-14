import type {
  AccessoryProfile,
  BodyPresentation,
  EnvironmentKind,
  HumanoidPaletteId,
  HumanoidPresetId,
  InfectionProfile,
  ObjectCondition,
  ObjectInteractionState,
} from '../../../domain/visuals/contracts'

/** The application, never generated content, selects the active pack. */
export type VisualPackId = 'ruined-kingdom-survival'

export const VISUAL_FAMILY_IDS = [
  'architecture',
  'furniture',
  'container',
  'document',
  'anchor',
  'device',
  'clutter',
  'lighting',
  'vegetation',
  'humanoid',
] as const

export type VisualFamilyId = (typeof VISUAL_FAMILY_IDS)[number]

export type VisualResolutionTier =
  | 'exact'
  | 'family'
  | 'environment'
  | 'neutral'
  | 'debug'

export const ANIMATION_INTENTS = [
  'idle',
  'walk',
  'run',
  'talk',
  'gesture',
  'inspect',
  'pick-up',
  'sit',
  'carry',
  'hurt',
  'zombie-idle',
  'zombie-walk',
] as const

export type AnimationIntent = (typeof ANIMATION_INTENTS)[number]

export type CollisionProfile =
  | Readonly<{ kind: 'none' }>
  | Readonly<{
      kind: 'circle'
      radius: number
      blocksPlayer: boolean
      blocksNpc: boolean
    }>
  | Readonly<{
      kind: 'box'
      halfExtents: readonly [number, number]
      blocksPlayer: boolean
      blocksNpc: boolean
    }>

export type RenderCost = Readonly<{
  triangles: number
  drawCalls: number
  textureSetIds: readonly string[]
  skinnedCharacters: number
  animationMixers: number
  localLights: number
  shadowLights: number
  particleEmitters: number
  transparentDraws: number
  shadowCasters: number
  collisionBodies: number
}>

export type VisualAssetDescriptor = Readonly<{
  bundleId: string
  nodeName: string
  family: VisualFamilyId
  instancing: 'allowed' | 'forbidden'
  lodAssetIds: readonly string[]
  collision: CollisionProfile
  cost: RenderCost
  licenseSourceId: string
}>

/** Trusted-only modular character definition. None of these IDs are RoomSpec fields. */
export type HumanoidPresetDefinition = Readonly<{
  bodyPool: readonly string[]
  headPool: readonly string[]
  hairPool: readonly string[]
  outfitPool: readonly string[]
  armourPool: readonly string[]
  defaultPresentation: BodyPresentation
  defaultPalette: HumanoidPaletteId
  defaultAccessories: AccessoryProfile
  defaultInfection: InfectionProfile
  animationSet: 'living' | 'undead' | 'monster'
}>

export type VisualPackRegistry = Readonly<{
  id: VisualPackId
  version: 1
  /** Same-origin, application-authored URLs. They never come from RoomSpec. */
  bundles: Readonly<Record<string, string>>
  assets: Readonly<Record<string, VisualAssetDescriptor>>
  exactMappings: Readonly<Record<string, string>>
  familyDefaults: Readonly<Record<VisualFamilyId, string>>
  environmentDefaults: Readonly<
    Record<EnvironmentKind, Partial<Record<VisualFamilyId, string>>>
  >
  neutralDefaults: Readonly<Record<VisualFamilyId, string>>
  humanoidPresets: Readonly<Record<HumanoidPresetId, HumanoidPresetDefinition>>
  animationClips: Readonly<Record<AnimationIntent, string>>
  /** Optional and reachable only when the application explicitly enables dev visuals. */
  debugDefaults: Readonly<Partial<Record<VisualFamilyId, string>>>
}>

export type VisualResolutionRequest = Readonly<{
  semanticKey: string
  family: VisualFamilyId
  environmentKind?: EnvironmentKind
  condition?: ObjectCondition
  interactionState?: ObjectInteractionState
}>

export type VisualResolution = Readonly<{
  assetId: string
  descriptor: VisualAssetDescriptor
  tier: VisualResolutionTier
}>

export type HumanoidSelection = Readonly<{
  preset: HumanoidPresetId
  presentation: BodyPresentation
  palette: HumanoidPaletteId
  infection: InfectionProfile
  accessories: AccessoryProfile
  bodyId: string
  headId: string
  hairId: string
  outfitId: string
  armourId: string
}>
