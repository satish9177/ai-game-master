import type { WorldBibleSeeder } from '../domain/ports/WorldBibleSeeder'
import { WorldBibleSeedSchema, type WorldBibleSeed } from '../domain/worldBible/worldBibleSeed'
import { createRng } from './prng'

const POST_APOC_KEYWORDS = [
  'zombie',
  'ruin',
  'apocalypse',
  'survivor',
  'raider',
  'wasteland',
  'infected',
  'outbreak',
  'fallout',
] as const

const TONES = ['heroic', 'grim', 'mysterious', 'tense', 'hopeful'] as const

type ThemePack = WorldBibleSeed['themePack']
type NpcSeed = WorldBibleSeed['npcs'][number]
type LocationSeed = WorldBibleSeed['locations'][number]
type OpeningArc = WorldBibleSeed['openingArc']

type ContentPack = {
  defaultTitle: string
  premises: readonly string[]
  conflicts: readonly string[]
  factions: readonly string[]
  npcs: readonly NpcSeed[]
  locations: readonly LocationSeed[]
  keywords: readonly string[]
  canonNotes: readonly string[]
  openingArcs: readonly OpeningArc[]
}

const CONTENT_PACKS = {
  'fantasy-keep': {
    defaultTitle: 'The Ember Keep',
    premises: [
      'An old keep wakes as its protective wards begin to fail.',
      'A divided court guards the last refuge beyond the mountain pass.',
      'Forgotten vows stir beneath a fortress built over ancient ruins.',
    ],
    conflicts: [
      'Rival houses seek control of the keep before its defenses collapse.',
      'A hidden claimant and a spreading curse threaten the fragile peace.',
      'The wardens must choose between the realm and the secret they protect.',
    ],
    factions: ['Ash Wardens', 'House Veyr', 'Lantern Covenant'],
    npcs: [
      { name: 'Mara', role: 'Gate captain', disposition: 'ally' },
      { name: 'Orin', role: 'Royal archivist', disposition: 'neutral' },
      { name: 'Ser Caldus', role: 'Rival envoy', disposition: 'hostile' },
      { name: 'Ilyra', role: 'Ward keeper', disposition: 'ally' },
    ],
    locations: [
      { label: 'Rain-dark Gatehouse', kind: 'fortified entrance' },
      { label: 'Ember Vault', kind: 'sealed sanctuary' },
      { label: 'Broken Solar', kind: 'abandoned court' },
      { label: 'Lantern Crypt', kind: 'ancestral tomb' },
    ],
    keywords: ['keep', 'ancient', 'wards', 'crown'],
    canonNotes: [
      'The keep is a refuge, not an unquestioned source of safety.',
      'No faction begins with complete knowledge of the old wards.',
    ],
    openingArcs: [
      {
        pattern: 'investigate',
        hook: 'A protective ward fails during the night watch.',
        firstObjective: 'Find the damaged ward before the next bell.',
        pressure: 'A rival delegation reaches the gate at dawn.',
      },
      {
        pattern: 'rescue',
        hook: 'A keeper vanishes below the sealed western stair.',
        firstObjective: 'Reach the missing keeper and learn what opened the stair.',
        pressure: 'The stair seals again when the moon sets.',
      },
      {
        pattern: 'recover-item',
        hook: 'The key that stabilizes the wards is stolen from the vault.',
        firstObjective: 'Recover the ward key before it leaves the keep.',
        pressure: 'Each failed ward exposes another occupied chamber.',
      },
    ],
  },
  'post-apoc': {
    defaultTitle: 'The Last Safehouse',
    premises: [
      'A battered safehouse holds while the surrounding district falls silent.',
      'Scattered survivors gather around one failing source of clean water.',
      'A ruined transit hub becomes the last defensible shelter for miles.',
    ],
    conflicts: [
      'Raiders and infected close in as the settlement runs out of supplies.',
      'A hidden outbreak divides survivors over whether anyone can leave safely.',
      'Two survivor groups need the same dwindling route out of the ruins.',
    ],
    factions: ['Northline Survivors', 'Red Dust Raiders', 'Signal Crew'],
    npcs: [
      { name: 'June', role: 'Field medic', disposition: 'ally' },
      { name: 'Mack', role: 'Salvage broker', disposition: 'neutral' },
      { name: 'Rook', role: 'Raider scout', disposition: 'hostile' },
      { name: 'Tala', role: 'Radio operator', disposition: 'ally' },
    ],
    locations: [
      { label: 'Barricaded Concourse', kind: 'survivor shelter' },
      { label: 'Flooded Clinic', kind: 'medical ruin' },
      { label: 'Signal Tower', kind: 'communications site' },
      { label: 'Collapsed Underpass', kind: 'blocked escape route' },
    ],
    keywords: ['survivors', 'ruins', 'scarcity', 'infected'],
    canonNotes: [
      'The outbreak has no supernatural cause in initial canon.',
      'No survivor group begins with unlimited food, water, or ammunition.',
    ],
    openingArcs: [
      {
        pattern: 'survive',
        hook: 'The outer barricade fails as a storm cuts visibility.',
        firstObjective: 'Secure the concourse before the next wave arrives.',
        pressure: 'The backup lights have less than an hour of power.',
      },
      {
        pattern: 'escape',
        hook: 'Smoke reveals that the safehouse has only one usable exit.',
        firstObjective: 'Open a route through the collapsed underpass.',
        pressure: 'The fire is spreading toward the stored water.',
      },
      {
        pattern: 'rescue',
        hook: 'A radio call reports survivors trapped in the flooded clinic.',
        firstObjective: 'Reach the clinic and extract the trapped group.',
        pressure: 'Raiders are following the same radio signal.',
      },
    ],
  },
} as const satisfies Record<ThemePack, ContentPack>

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ')
}

function chooseTheme(prompt: string): ThemePack {
  const lower = prompt.toLowerCase()
  return POST_APOC_KEYWORDS.some((keyword) => lower.includes(keyword))
    ? 'post-apoc'
    : 'fantasy-keep'
}

function takeCircular<T>(items: readonly T[], start: number, count: number): T[] {
  return Array.from({ length: count }, (_, offset) => items[(start + offset) % items.length]!)
}

/** Deterministic, browser-only World Bible seeder. Produces validated data and performs no IO. */
export class FakeWorldBibleSeeder implements WorldBibleSeeder {
  async seed(prompt: string): Promise<WorldBibleSeed> {
    const normalizedPrompt = normalizePrompt(prompt)
    const themePack = chooseTheme(normalizedPrompt)
    const pack: ContentPack = CONTENT_PACKS[themePack]
    const rng = createRng(prompt)
    const title = normalizedPrompt.slice(0, 60) || pack.defaultTitle
    const npcCount = rng.int(2, 4)
    const locationCount = rng.int(2, 5)
    const factionCount = rng.int(2, 4)
    const npcs = takeCircular(pack.npcs, rng.int(0, pack.npcs.length), npcCount)
    const locations = takeCircular(
      pack.locations,
      rng.int(0, pack.locations.length),
      locationCount,
    )

    return WorldBibleSeedSchema.parse({
      schemaVersion: 1,
      title,
      themePack,
      tone: rng.pick(TONES),
      premise: rng.pick(pack.premises),
      startingLocation: locations[0]!.label,
      majorConflict: rng.pick(pack.conflicts),
      factions: takeCircular(
        pack.factions,
        rng.int(0, pack.factions.length),
        factionCount,
      ),
      npcs,
      locations,
      generationHints: {
        allowedThemePack: themePack,
        keywords: [...pack.keywords],
      },
      canonNotes: [...pack.canonNotes],
      openingArc: rng.pick(pack.openingArcs),
    })
  }
}
