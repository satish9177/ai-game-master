import { z } from 'zod'

/**
 * Closed, renderer-agnostic visual vocabulary for RoomSpec.
 *
 * Generated content may select only these semantic values. Asset paths, GLTF
 * node names, materials, shaders, animation clip names, and renderer commands
 * deliberately do not exist in this domain contract.
 */

export const ENVIRONMENT_KINDS = [
  'village',
  'tavern',
  'palace',
  'ruins',
  'forest-edge',
  'crypt',
  'dungeon',
] as const
export const EnvironmentKindSchema = z.enum(ENVIRONMENT_KINDS)
export type EnvironmentKind = z.infer<typeof EnvironmentKindSchema>

export const OBJECT_CONDITIONS = [
  'intact',
  'weathered',
  'damaged',
  'burned',
  'overgrown',
] as const
export const ObjectConditionSchema = z.enum(OBJECT_CONDITIONS)
export type ObjectCondition = z.infer<typeof ObjectConditionSchema>

export const OBJECT_INTERACTION_STATES = [
  'none',
  'closed',
  'open',
  'locked',
  'looted',
  'read',
  'activated',
] as const
export const ObjectInteractionStateSchema = z.enum(OBJECT_INTERACTION_STATES)
export type ObjectInteractionState = z.infer<typeof ObjectInteractionStateSchema>

export type ObjectPresentationState = Readonly<{
  condition: ObjectCondition
  interactionState: ObjectInteractionState
  resolved: boolean
}>

export const ARCHITECTURE_KINDS = [
  'wall-straight',
  'wall-corner',
  'wall-ruined',
  'doorway',
  'window',
  'stairs',
  'ladder',
  'trapdoor',
  'column',
  'beam',
  'railing',
  'fence',
  'gate',
  'roof',
  'floor-section',
  'fountain',
  'well',
  'pool',
] as const
export const ArchitectureKindSchema = z.enum(ARCHITECTURE_KINDS)
export type ArchitectureKind = z.infer<typeof ArchitectureKindSchema>

export const FURNITURE_KINDS = [
  'table',
  'chair',
  'stool',
  'bench',
  'bed',
  'shelf',
  'bookcase',
  'cabinet',
  'wardrobe',
  'counter',
  'market-stall',
] as const
export const FurnitureKindSchema = z.enum(FURNITURE_KINDS)
export type FurnitureKind = z.infer<typeof FurnitureKindSchema>

export const CLUTTER_KINDS = [
  'sack',
  'bottle',
  'mug',
  'plate',
  'pot',
  'cauldron',
  'rope',
  'tool-rack',
  'weapon-rack',
  'book-stack',
  'bone-pile',
  'hay-bale',
  'firewood',
  'bloodstain',
  'markings',
  'small-rubble',
  'key',
  'coin-pile',
  'potion',
] as const
export const ClutterKindSchema = z.enum(CLUTTER_KINDS)
export type ClutterKind = z.infer<typeof ClutterKindSchema>

export const VEGETATION_KINDS = [
  'tree',
  'dead-tree',
  'stump',
  'bush',
  'grass',
  'fern',
  'vine',
  'mushroom',
  'rock',
] as const
export const VegetationKindSchema = z.enum(VEGETATION_KINDS)
export type VegetationKind = z.infer<typeof VegetationKindSchema>

export const LIGHT_FIXTURE_KINDS = [
  'lantern',
  'wall-lantern',
  'brazier',
  'campfire',
  'chandelier',
  'candle-cluster',
] as const
export const LightFixtureKindSchema = z.enum(LIGHT_FIXTURE_KINDS)
export type LightFixtureKind = z.infer<typeof LightFixtureKindSchema>

export const HUMANOID_PRESET_IDS = [
  'human-commoner',
  'guard',
  'villager',
  'merchant',
  'noble',
  'servant',
  'wanderer',
  'raider',
  'zombie',
  'humanoid-monster',
] as const
export const HumanoidPresetIdSchema = z.enum(HUMANOID_PRESET_IDS)
export type HumanoidPresetId = z.infer<typeof HumanoidPresetIdSchema>

export const BODY_PRESENTATIONS = ['masculine', 'feminine', 'neutral'] as const
export const BodyPresentationSchema = z.enum(BODY_PRESENTATIONS)
export type BodyPresentation = z.infer<typeof BodyPresentationSchema>

export const HUMANOID_PALETTE_IDS = [
  'earth',
  'village',
  'guard',
  'merchant',
  'royal',
  'raider',
  'survivor',
  'undead',
  'monster',
] as const
export const HumanoidPaletteIdSchema = z.enum(HUMANOID_PALETTE_IDS)
export type HumanoidPaletteId = z.infer<typeof HumanoidPaletteIdSchema>

export const INFECTION_PROFILES = ['none', 'early', 'advanced'] as const
export const InfectionProfileSchema = z.enum(INFECTION_PROFILES)
export type InfectionProfile = z.infer<typeof InfectionProfileSchema>

export const ACCESSORY_PROFILES = [
  'none',
  'traveller',
  'merchant',
  'guard',
  'noble',
  'raider',
  'survivor',
] as const
export const AccessoryProfileSchema = z.enum(ACCESSORY_PROFILES)
export type AccessoryProfile = z.infer<typeof AccessoryProfileSchema>

export const HumanoidAppearanceSchema = z
  .object({
    preset: HumanoidPresetIdSchema,
    presentation: BodyPresentationSchema.optional(),
    palette: HumanoidPaletteIdSchema.optional(),
    infection: InfectionProfileSchema.optional(),
    accessories: AccessoryProfileSchema.optional(),
  })
  .strict()
export type HumanoidAppearance = Readonly<z.infer<typeof HumanoidAppearanceSchema>>

/**
 * Optional variants for the 24 legacy object families. They remain semantic;
 * the trusted visual-pack registry owns all exact assets and renderer details.
 */
export const SemanticVariantSchemas = {
  throne: z.enum(['royal']),
  pillar: z.enum(['stone']),
  rug: z.enum(['runner']),
  torch: z.enum(['wall-torch']),
  arch: z.enum(['stone-arch', 'wood-door', 'iron-gate', 'stone-portal', 'entrance']),
  scroll: z.enum(['rolled']),
  book: z.enum(['closed-book', 'journal', 'tome', 'ledger']),
  paper: z.enum(['sheet', 'notes', 'letter', 'parchment']),
  map: z.enum(['world-map', 'floor-plan', 'route-map']),
  chest: z.enum(['treasure-chest', 'lockbox', 'coffer', 'strongbox', 'footlocker']),
  corpse: z.enum(['body', 'skeleton', 'bone-pile', 'decayed-remains']),
  table: z.enum(['table', 'desk', 'workbench', 'counter']),
  altar: z.enum(['altar', 'shrine', 'ritual-platform', 'offering-table']),
  statue: z.enum(['statue', 'monument', 'idol', 'effigy', 'sculpture']),
  machine: z.enum([
    'machine',
    'generator',
    'console',
    'machinery',
    'lab-equipment',
    'terminal',
    'apparatus',
  ]),
  artifact: z.enum([
    'artifact',
    'crystal',
    'relic',
    'orb',
    'strange-object',
    'gem',
    'shard',
    'totem',
  ]),
  candle: z.enum(['single', 'cluster', 'votive', 'tea-light']),
  crate: z.enum(['crate', 'box', 'case', 'supply-crate']),
  barrel: z.enum(['barrel', 'drum', 'keg', 'cask']),
  debris: z.enum([
    'debris',
    'rubble',
    'trash',
    'junk',
    'wreckage',
    'scrap',
    'broken-parts',
    'debris-pile',
  ]),
} as const
