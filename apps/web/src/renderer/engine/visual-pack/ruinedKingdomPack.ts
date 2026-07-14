import {
  ARCHITECTURE_KINDS,
  CLUTTER_KINDS,
  ENVIRONMENT_KINDS,
  FURNITURE_KINDS,
  LIGHT_FIXTURE_KINDS,
  VEGETATION_KINDS,
  type EnvironmentKind,
  type ArchitectureKind,
  type HumanoidPresetId,
} from '../../../domain/visuals/contracts'
import type {
  CollisionProfile,
  HumanoidPresetDefinition,
  RenderCost,
  VisualAssetDescriptor,
  VisualFamilyId,
  VisualPackRegistry,
} from './contracts'
import { validateVisualPackRegistry } from './VisualPackRegistry'

const ROOT = '/visual-packs/ruined-kingdom-survival'

const bundles = {
  core: ROOT + '/core/neutral-fallbacks.glb',
  characters: ROOT + '/characters/humanoid-core.glb',
  animations: ROOT + '/characters/humanoid-animations.glb',
  village: ROOT + '/environments/village.glb',
  tavern: ROOT + '/environments/tavern.glb',
  palace: ROOT + '/environments/palace.glb',
  ruins: ROOT + '/environments/ruins.glb',
  'forest-edge': ROOT + '/environments/forest-edge.glb',
  crypt: ROOT + '/environments/crypt.glb',
  dungeon: ROOT + '/environments/dungeon.glb',
  furniture: ROOT + '/props/furniture.glb',
  containers: ROOT + '/props/containers.glb',
  clutter: ROOT + '/props/clutter.glb',
  lighting: ROOT + '/props/lighting.glb',
  vegetation: ROOT + '/props/vegetation.glb',
} as const

const assets: Record<string, VisualAssetDescriptor> = {}
const exactMappings: Record<string, string> = {}

const FAMILY_BUNDLE: Record<VisualFamilyId, keyof typeof bundles> = {
  architecture: 'core',
  furniture: 'furniture',
  container: 'containers',
  document: 'clutter',
  anchor: 'clutter',
  device: 'clutter',
  clutter: 'clutter',
  lighting: 'lighting',
  vegetation: 'vegetation',
  humanoid: 'characters',
}

const FAMILY_LICENSE: Record<VisualFamilyId, string> = {
  architecture: 'MV',
  furniture: 'FP',
  container: 'FP',
  document: 'FP',
  anchor: 'FP',
  device: 'ZA',
  clutter: 'FP',
  lighting: 'FP',
  vegetation: 'USN',
  humanoid: 'UBC',
}

const COLLISION_BY_FAMILY: Record<VisualFamilyId, CollisionProfile> = {
  architecture: { kind: 'box', halfExtents: [0.5, 0.5], blocksPlayer: true, blocksNpc: true },
  furniture: { kind: 'box', halfExtents: [0.55, 0.45], blocksPlayer: true, blocksNpc: true },
  container: { kind: 'box', halfExtents: [0.42, 0.36], blocksPlayer: true, blocksNpc: true },
  document: { kind: 'none' },
  anchor: { kind: 'circle', radius: 0.55, blocksPlayer: true, blocksNpc: true },
  device: { kind: 'box', halfExtents: [0.5, 0.4], blocksPlayer: true, blocksNpc: true },
  clutter: { kind: 'none' },
  lighting: { kind: 'none' },
  vegetation: { kind: 'none' },
  humanoid: { kind: 'circle', radius: 0.35, blocksPlayer: false, blocksNpc: true },
}
const ARCHITECTURE_COLLISION_BY_KIND: Record<ArchitectureKind, CollisionProfile> = {
  'wall-straight': { kind: 'box', halfExtents: [0.5, 0.5], blocksPlayer: true, blocksNpc: true },
  'wall-corner': { kind: 'box', halfExtents: [0.5, 0.5], blocksPlayer: true, blocksNpc: true },
  'wall-ruined': { kind: 'box', halfExtents: [0.5, 0.5], blocksPlayer: true, blocksNpc: true },
  fence: { kind: 'box', halfExtents: [0.5, 0.15], blocksPlayer: true, blocksNpc: true },
  gate: { kind: 'box', halfExtents: [0.5, 0.18], blocksPlayer: true, blocksNpc: true },
  column: { kind: 'circle', radius: 0.35, blocksPlayer: true, blocksNpc: true },
  well: { kind: 'circle', radius: 0.38, blocksPlayer: true, blocksNpc: true },
  fountain: { kind: 'circle', radius: 0.38, blocksPlayer: true, blocksNpc: true },
  doorway: { kind: 'none' }, window: { kind: 'none' }, stairs: { kind: 'none' },
  ladder: { kind: 'none' }, trapdoor: { kind: 'none' }, beam: { kind: 'none' },
  railing: { kind: 'none' }, roof: { kind: 'none' }, 'floor-section': { kind: 'none' },
  pool: { kind: 'none' },
}

const COST_BY_FAMILY: Record<VisualFamilyId, RenderCost> = {
  architecture: cost(900, 1, 1, 1),
  furniture: cost(650, 1, 1, 1),
  container: cost(550, 1, 1, 1),
  document: cost(120, 1, 0, 0),
  anchor: cost(1_200, 1, 1, 1),
  device: cost(900, 1, 1, 1),
  clutter: cost(180, 1, 0, 0),
  lighting: { ...cost(300, 1, 0, 0), localLights: 1 },
  vegetation: cost(500, 1, 1, 1),
  humanoid: {
    ...cost(8_000, 3, 1, 1),
    skinnedCharacters: 1,
    animationMixers: 1,
  },
}

const NEUTRAL_COST_BY_FAMILY: Record<VisualFamilyId, RenderCost> = {
  architecture: cost(180, 1, 0, 1),
  furniture: cost(160, 1, 0, 1),
  container: cost(140, 1, 0, 1),
  document: cost(36, 1, 0, 0),
  anchor: cost(220, 1, 0, 1),
  device: cost(220, 1, 0, 1),
  clutter: cost(60, 1, 0, 0),
  lighting: { ...cost(80, 1, 0, 0), localLights: 1 },
  vegetation: cost(120, 1, 0, 1),
  humanoid: cost(700, 1, 1, 1),
}

const familyDefaults = {} as Record<VisualFamilyId, string>
const neutralDefaults = {} as Record<VisualFamilyId, string>

for (const family of Object.keys(FAMILY_BUNDLE) as VisualFamilyId[]) {
  const familyId = 'family.' + family
  const neutralId = 'neutral.' + family
  register(familyId, FAMILY_BUNDLE[family], family, FAMILY_LICENSE[family])
  register(
    neutralId,
    family === 'humanoid' ? 'characters' : 'core',
    family,
    FAMILY_LICENSE[family],
    {
      instancing: 'allowed',
      cost: NEUTRAL_COST_BY_FAMILY[family],
      ...(family === 'humanoid' ? { nodeName: 'HumanoidStaticLod' } : {}),
    },
  )
  familyDefaults[family] = familyId
  neutralDefaults[family] = neutralId
}

const environmentDefaults = Object.fromEntries(ENVIRONMENT_KINDS.map((environment) => {
  const values: Partial<Record<VisualFamilyId, string>> = {}
  for (const family of Object.keys(FAMILY_BUNDLE) as VisualFamilyId[]) {
    const id = 'environment.' + environment + '.' + family
    register(
      id,
      environmentBundle(environment, family),
      family,
      environmentLicense(environment, family),
    )
    values[family] = id
  }
  return [environment, values]
})) as Record<EnvironmentKind, Partial<Record<VisualFamilyId, string>>>

for (const environment of ENVIRONMENT_KINDS) {
  for (const kind of ARCHITECTURE_KINDS) {
    const id = 'architecture.' + environment + '.' + kind
    register(id, environment, 'architecture', environmentLicense(environment, 'architecture'), {
      collision: ARCHITECTURE_COLLISION_BY_KIND[kind],
    })
    exactMappings[environmentKey('architecture.' + kind, environment)] = id
  }
}

for (const kind of ARCHITECTURE_KINDS) {
  const id = 'architecture.generic.' + kind
  register(id, 'ruins', 'architecture', 'MV', {
    collision: ARCHITECTURE_COLLISION_BY_KIND[kind],
  })
  exactMappings['architecture.' + kind] = id
}

for (const kind of FURNITURE_KINDS) {
  const id = 'furniture.' + kind
  register(id, 'furniture', 'furniture', 'FP')
  exactMappings[id] = id
}

for (const kind of CLUTTER_KINDS) {
  const id = 'clutter.' + kind
  register(id, 'clutter', 'clutter', clutterLicense(kind))
  exactMappings[id] = id
}

for (const kind of VEGETATION_KINDS) {
  const id = 'vegetation.' + kind
  register(id, 'vegetation', 'vegetation', 'USN')
  exactMappings[id] = id
}

for (const kind of LIGHT_FIXTURE_KINDS) {
  const id = 'lighting.' + kind
  register(id, 'lighting', 'lighting', 'FP')
  exactMappings[id] = id
}

export const RUINED_KINGDOM_LEGACY_VARIANTS = {
  throne: ['royal'],
  pillar: ['stone'],
  rug: ['runner'],
  torch: ['wall-torch'],
  arch: ['stone-arch', 'wood-door', 'iron-gate', 'stone-portal', 'entrance'],
  scroll: ['rolled'],
  book: ['closed-book', 'journal', 'tome', 'ledger'],
  paper: ['sheet', 'notes', 'letter', 'parchment'],
  map: ['world-map', 'floor-plan', 'route-map'],
  chest: ['treasure-chest', 'lockbox', 'coffer', 'strongbox', 'footlocker'],
  corpse: ['body', 'skeleton', 'bone-pile', 'decayed-remains'],
  table: ['table', 'desk', 'workbench', 'counter'],
  altar: ['altar', 'shrine', 'ritual-platform', 'offering-table'],
  statue: ['statue', 'monument', 'idol', 'effigy', 'sculpture'],
  machine: ['machine', 'generator', 'console', 'machinery', 'lab-equipment', 'terminal', 'apparatus'],
  artifact: ['artifact', 'crystal', 'relic', 'orb', 'strange-object', 'gem', 'shard', 'totem'],
  candle: ['single', 'cluster', 'votive', 'tea-light'],
  crate: ['crate', 'box', 'case', 'supply-crate'],
  barrel: ['barrel', 'drum', 'keg', 'cask'],
  debris: ['debris', 'rubble', 'trash', 'junk', 'wreckage', 'scrap', 'broken-parts', 'debris-pile'],
} as const

export const RUINED_KINGDOM_LEGACY_FAMILY: Record<
  keyof typeof RUINED_KINGDOM_LEGACY_VARIANTS,
  VisualFamilyId
> = {
  throne: 'anchor',
  pillar: 'architecture',
  rug: 'furniture',
  torch: 'lighting',
  arch: 'architecture',
  scroll: 'document',
  book: 'document',
  paper: 'document',
  map: 'document',
  chest: 'container',
  corpse: 'clutter',
  table: 'furniture',
  altar: 'anchor',
  statue: 'anchor',
  machine: 'device',
  artifact: 'anchor',
  candle: 'lighting',
  crate: 'container',
  barrel: 'container',
  debris: 'clutter',
}

const LEGACY_COLLISION: Record<
  keyof typeof RUINED_KINGDOM_LEGACY_VARIANTS,
  CollisionProfile
> = {
  throne: { kind: 'box', halfExtents: [0.75, 0.65], blocksPlayer: true, blocksNpc: true },
  pillar: { kind: 'circle', radius: 0.4, blocksPlayer: true, blocksNpc: true },
  rug: { kind: 'none' },
  torch: { kind: 'none' },
  arch: { kind: 'box', halfExtents: [1.25, 0.25], blocksPlayer: true, blocksNpc: true },
  scroll: { kind: 'none' },
  book: { kind: 'none' },
  paper: { kind: 'none' },
  map: { kind: 'none' },
  chest: { kind: 'box', halfExtents: [0.6, 0.38], blocksPlayer: true, blocksNpc: true },
  corpse: { kind: 'circle', radius: 0.65, blocksPlayer: false, blocksNpc: true },
  table: { kind: 'box', halfExtents: [0.9, 0.55], blocksPlayer: true, blocksNpc: true },
  altar: { kind: 'box', halfExtents: [0.9, 0.55], blocksPlayer: true, blocksNpc: true },
  statue: { kind: 'circle', radius: 0.55, blocksPlayer: true, blocksNpc: true },
  machine: { kind: 'box', halfExtents: [0.8, 0.5], blocksPlayer: true, blocksNpc: true },
  artifact: { kind: 'circle', radius: 0.25, blocksPlayer: true, blocksNpc: true },
  candle: { kind: 'none' },
  crate: { kind: 'box', halfExtents: [0.5, 0.5], blocksPlayer: true, blocksNpc: true },
  barrel: { kind: 'circle', radius: 0.35, blocksPlayer: true, blocksNpc: true },
  debris: { kind: 'circle', radius: 0.75, blocksPlayer: false, blocksNpc: true },
}

for (const type of Object.keys(RUINED_KINGDOM_LEGACY_VARIANTS) as (keyof typeof RUINED_KINGDOM_LEGACY_VARIANTS)[]) {
  const variants = RUINED_KINGDOM_LEGACY_VARIANTS[type]
  for (const variant of variants) {
    const family = RUINED_KINGDOM_LEGACY_FAMILY[type]
    const id = 'object.' + type + '.' + variant
    const bundle = type === 'throne' || type === 'altar'
      ? 'furniture'
      : FAMILY_BUNDLE[family]
    register(id, bundle, family, FAMILY_LICENSE[family], {
      collision: LEGACY_COLLISION[type],
      ...(type === 'candle'
        ? { cost: { ...COST_BY_FAMILY.lighting, localLights: 0 } }
        : {}),
    })
    exactMappings[id] = id
  }
  exactMappings['object.' + type] = 'object.' + type + '.' + variants[0]
}

for (const shape of ['box', 'cylinder', 'cone', 'sphere'] as const) {
  const id = 'object.prop.' + shape
  register(id, 'clutter', 'clutter', 'FP', {
    collision: shape === 'box'
      ? { kind: 'box', halfExtents: [0.5, 0.5], blocksPlayer: true, blocksNpc: true }
      : { kind: 'circle', radius: 0.5, blocksPlayer: true, blocksNpc: true },
  })
  exactMappings[id] = id
}
exactMappings['object.prop'] = 'object.prop.box'

for (const style of ['planks', 'sandbags'] as const) {
  const id = 'object.barricade.' + style
  register(id, 'clutter', 'architecture', 'ZA')
  exactMappings[id] = id
}
exactMappings['object.barricade'] = 'object.barricade.planks'

const humanoidPresets = {
  'human-commoner': humanoidPreset('earth', 'none', 'none', 'living'),
  guard: humanoidPreset('guard', 'guard', 'none', 'living'),
  villager: humanoidPreset('village', 'none', 'none', 'living'),
  merchant: humanoidPreset('merchant', 'merchant', 'none', 'living'),
  noble: humanoidPreset('royal', 'noble', 'none', 'living'),
  servant: humanoidPreset('earth', 'none', 'none', 'living'),
  wanderer: humanoidPreset('survivor', 'traveller', 'none', 'living'),
  raider: humanoidPreset('raider', 'raider', 'none', 'living'),
  zombie: humanoidPreset('undead', 'survivor', 'advanced', 'undead'),
  'humanoid-monster': humanoidPreset('monster', 'none', 'none', 'monster'),
} satisfies Record<HumanoidPresetId, HumanoidPresetDefinition>

for (const preset of Object.keys(humanoidPresets) as HumanoidPresetId[]) {
  const id = 'humanoid.' + preset
  register(id, 'characters', 'humanoid', 'UBC', {
    instancing: 'forbidden',
    nodeName: 'HumanoidRoot',
  })
  exactMappings[id] = id
}
exactMappings['object.npc'] = 'humanoid.human-commoner'
exactMappings['object.zombie'] = 'humanoid.zombie'

register('humanoid.static-lod', 'characters', 'humanoid', 'UBC', {
  instancing: 'allowed',
  nodeName: 'HumanoidStaticLod',
  cost: NEUTRAL_COST_BY_FAMILY.humanoid,
})
register('humanoid.animations', 'animations', 'humanoid', 'UAL', {
  instancing: 'forbidden',
  nodeName: 'AnimationRoot',
  collision: { kind: 'none' },
  cost: { ...cost(0, 0, 0, 0), textureSetIds: [] },
})

const animationClips = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  talk: 'Talk',
  gesture: 'Gesture',
  inspect: 'Inspect',
  'pick-up': 'PickUp',
  sit: 'Sit',
  carry: 'Carry',
  hurt: 'Hurt',
  'zombie-idle': 'ZombieIdle',
  'zombie-walk': 'ZombieWalk',
} as const

for (const [assetId, descriptor] of Object.entries(assets)) {
  const neutralId = neutralDefaults[descriptor.family]
  if (
    descriptor.family !== 'humanoid'
    && assetId !== neutralId
    && descriptor.lodAssetIds.length === 0
  ) {
    assets[assetId] = { ...descriptor, lodAssetIds: [neutralId] }
  }
}

export const ruinedKingdomPack = validateVisualPackRegistry({
  id: 'ruined-kingdom-survival',
  version: 1,
  bundles,
  assets,
  exactMappings,
  familyDefaults,
  environmentDefaults,
  neutralDefaults,
  humanoidPresets,
  animationClips,
  debugDefaults: {},
} satisfies VisualPackRegistry)

function register(
  id: string,
  bundleId: keyof typeof bundles,
  family: VisualFamilyId,
  licenseSourceId: string,
  overrides: Partial<Pick<VisualAssetDescriptor, 'nodeName' | 'instancing' | 'lodAssetIds' | 'collision' | 'cost'>> = {},
): void {
  assets[id] = {
    bundleId,
    nodeName: overrides.nodeName ?? id,
    family,
    instancing: overrides.instancing ?? (family === 'humanoid' ? 'forbidden' : 'allowed'),
    lodAssetIds: overrides.lodAssetIds ?? [],
    collision: overrides.collision ?? COLLISION_BY_FAMILY[family],
    cost: overrides.cost ?? COST_BY_FAMILY[family],
    licenseSourceId,
  }
}

function cost(
  triangles: number,
  drawCalls: number,
  shadowCasters: number,
  collisionBodies: number,
): RenderCost {
  return {
    triangles,
    drawCalls,
    textureSetIds: ['rks-shared-atlas'],
    skinnedCharacters: 0,
    animationMixers: 0,
    localLights: 0,
    shadowLights: 0,
    particleEmitters: 0,
    transparentDraws: 0,
    shadowCasters,
    collisionBodies,
  }
}

function environmentKey(semanticKey: string, environment: EnvironmentKind): string {
  return semanticKey + '.environment-' + environment
}

function environmentBundle(
  environment: EnvironmentKind,
  family: VisualFamilyId,
): keyof typeof bundles {
  if (family === 'architecture' || family === 'anchor') return environment
  return FAMILY_BUNDLE[family]
}

function environmentLicense(
  environment: EnvironmentKind,
  family: VisualFamilyId,
): string {
  if (family === 'humanoid') return 'UBC'
  if (family === 'vegetation') return 'USN'
  if (environment === 'forest-edge' && (family === 'architecture' || family === 'anchor')) {
    return 'USN'
  }
  if ((environment === 'crypt' || environment === 'dungeon')
    && (family === 'architecture' || family === 'anchor')) return 'MD'
  if (environment === 'ruins' && family === 'device') return 'ZA'
  if (family === 'architecture') return 'MV'
  return FAMILY_LICENSE[family]
}

function clutterLicense(kind: string): string {
  return kind === 'bloodstain' ? 'ZA' : 'FP'
}

function humanoidPreset(
  defaultPalette: HumanoidPresetDefinition['defaultPalette'],
  defaultAccessories: HumanoidPresetDefinition['defaultAccessories'],
  defaultInfection: HumanoidPresetDefinition['defaultInfection'],
  animationSet: HumanoidPresetDefinition['animationSet'],
): HumanoidPresetDefinition {
  return {
    bodyPool: [
      'body-masculine-a',
      'body-masculine-b',
      'body-feminine-a',
      'body-feminine-b',
      'body-neutral-a',
      'body-neutral-b',
    ],
    headPool: ['head-a', 'head-b', 'head-c', 'head-d'],
    hairPool: ['hair-none', 'hair-short', 'hair-long', 'hair-tied'],
    outfitPool: ['outfit-tunic', 'outfit-robe', 'outfit-survivor'],
    armourPool: ['armour-none', 'armour-leather', 'armour-mail'],
    defaultPresentation: 'neutral',
    defaultPalette,
    defaultAccessories,
    defaultInfection,
    animationSet,
  }
}
