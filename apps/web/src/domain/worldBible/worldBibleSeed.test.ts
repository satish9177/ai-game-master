import { describe, expect, it } from 'vitest'
import { WorldBibleSeedSchema } from './worldBibleSeed'

const validSeed = {
  schemaVersion: 1,
  title: 'The Ember Crown',
  themePack: 'fantasy-keep',
  tone: 'mysterious',
  premise: 'A sealed keep wakes as its old wards begin to fail.',
  startingLocation: 'The rain-dark gatehouse',
  majorConflict: 'Two rival houses seek the last ember of the crown.',
  factions: ['The Ash Wardens', 'House Veyr'],
  npcs: [
    { name: 'Mara', role: 'Gate captain', disposition: 'ally' },
    { name: 'Orin', role: 'Royal archivist', disposition: 'neutral' },
  ],
  locations: [
    { label: 'Gatehouse', kind: 'fortified entrance' },
    { label: 'Ember Vault', kind: 'sealed sanctuary' },
  ],
  generationHints: {
    allowedThemePack: 'fantasy-keep',
    keywords: ['embers', 'rain', 'old stone'],
  },
  openingArc: {
    pattern: 'investigate',
    hook: 'The keep wards are failing without warning.',
    firstObjective: 'Find the failing ward.',
    pressure: 'A rival house enters the keep at dawn.',
  },
  canonNotes: ['The crown cannot leave the keep.'],
} as const

const succeeds = (candidate: unknown): boolean =>
  WorldBibleSeedSchema.safeParse(candidate).success

describe('WorldBibleSeedSchema', () => {
  it('accepts and round-trips a valid seed', () => {
    expect(WorldBibleSeedSchema.parse(validSeed)).toEqual(validSeed)
  })

  it('rejects extra keys at the top level and in every nested object shape', () => {
    expect(succeeds({ ...validSeed, executable: true })).toBe(false)
    expect(succeeds({
      ...validSeed,
      npcs: [{ ...validSeed.npcs[0], secret: 'hidden' }, validSeed.npcs[1]],
    })).toBe(false)
    expect(succeeds({
      ...validSeed,
      locations: [
        { ...validSeed.locations[0], coordinates: [0, 0] },
        validSeed.locations[1],
      ],
    })).toBe(false)
    expect(succeeds({
      ...validSeed,
      generationHints: { ...validSeed.generationHints, prompt: 'ignore limits' },
    })).toBe(false)
    expect(succeeds({
      ...validSeed,
      openingArc: { ...validSeed.openingArc, nextQuest: 'Defeat the rival house.' },
    })).toBe(false)
  })

  it.each(Object.keys(validSeed))('rejects a seed missing required field %s', (field) => {
    const candidate: Record<string, unknown> = { ...validSeed }
    delete candidate[field]
    expect(succeeds(candidate)).toBe(false)
  })

  it('rejects missing required fields in nested seed objects', () => {
    expect(succeeds({
      ...validSeed,
      npcs: [
        { name: 'Mara', disposition: 'ally' },
        validSeed.npcs[1],
      ],
    })).toBe(false)
    expect(succeeds({
      ...validSeed,
      locations: [
        { label: 'Gatehouse' },
        validSeed.locations[1],
      ],
    })).toBe(false)
    expect(succeeds({
      ...validSeed,
      generationHints: { keywords: ['embers'] },
    })).toBe(false)
    expect(succeeds({
      ...validSeed,
      openingArc: {
        pattern: 'investigate',
        hook: 'The wards are failing.',
        firstObjective: 'Find the failing ward.',
      },
    })).toBe(false)
  })

  it('rejects empty bounded strings', () => {
    const candidates = [
      { ...validSeed, title: '' },
      { ...validSeed, premise: '' },
      { ...validSeed, startingLocation: '' },
      { ...validSeed, majorConflict: '' },
      { ...validSeed, factions: [''] },
      {
        ...validSeed,
        npcs: [{ ...validSeed.npcs[0], name: '' }, validSeed.npcs[1]],
      },
      {
        ...validSeed,
        npcs: [{ ...validSeed.npcs[0], role: '' }, validSeed.npcs[1]],
      },
      {
        ...validSeed,
        locations: [{ ...validSeed.locations[0], label: '' }, validSeed.locations[1]],
      },
      {
        ...validSeed,
        locations: [{ ...validSeed.locations[0], kind: '' }, validSeed.locations[1]],
      },
      {
        ...validSeed,
        generationHints: { ...validSeed.generationHints, keywords: [''] },
      },
      { ...validSeed, canonNotes: [''] },
      { ...validSeed, openingArc: { ...validSeed.openingArc, hook: '' } },
      { ...validSeed, openingArc: { ...validSeed.openingArc, firstObjective: '' } },
      { ...validSeed, openingArc: { ...validSeed.openingArc, pressure: '' } },
    ]

    expect(candidates.every((candidate) => !succeeds(candidate))).toBe(true)
  })
  it.each([
    ['title', { ...validSeed, title: 'x'.repeat(61) }],
    ['premise', { ...validSeed, premise: 'x'.repeat(241) }],
    ['startingLocation', { ...validSeed, startingLocation: 'x'.repeat(121) }],
    ['majorConflict', { ...validSeed, majorConflict: 'x'.repeat(241) }],
    ['faction', { ...validSeed, factions: ['x'.repeat(61)] }],
    ['npc name', {
      ...validSeed,
      npcs: [{ ...validSeed.npcs[0], name: 'x'.repeat(41) }, validSeed.npcs[1]],
    }],
    ['npc role', {
      ...validSeed,
      npcs: [{ ...validSeed.npcs[0], role: 'x'.repeat(61) }, validSeed.npcs[1]],
    }],
    ['location label', {
      ...validSeed,
      locations: [
        { ...validSeed.locations[0], label: 'x'.repeat(61) },
        validSeed.locations[1],
      ],
    }],
    ['location kind', {
      ...validSeed,
      locations: [
        { ...validSeed.locations[0], kind: 'x'.repeat(41) },
        validSeed.locations[1],
      ],
    }],
    ['keyword', {
      ...validSeed,
      generationHints: { ...validSeed.generationHints, keywords: ['x'.repeat(25)] },
    }],
    ['canon note', { ...validSeed, canonNotes: ['x'.repeat(121)] }],
    ['opening arc hook', {
      ...validSeed,
      openingArc: { ...validSeed.openingArc, hook: 'x'.repeat(121) },
    }],
    ['opening arc first objective', {
      ...validSeed,
      openingArc: { ...validSeed.openingArc, firstObjective: 'x'.repeat(121) },
    }],
    ['opening arc pressure', {
      ...validSeed,
      openingArc: { ...validSeed.openingArc, pressure: 'x'.repeat(121) },
    }],
  ] as const)('rejects an over-length %s', (_field, candidate) => {
    expect(succeeds(candidate)).toBe(false)
  })

  it.each([
    ['factions', { ...validSeed, factions: ['a', 'b', 'c', 'd'] }],
    ['npcs', {
      ...validSeed,
      npcs: [...validSeed.npcs, validSeed.npcs[0], validSeed.npcs[1]],
    }],
    ['locations', {
      ...validSeed,
      locations: [
        ...validSeed.locations,
        validSeed.locations[0],
        validSeed.locations[1],
        validSeed.locations[0],
      ],
    }],
    ['keywords', {
      ...validSeed,
      generationHints: {
        ...validSeed.generationHints,
        keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      },
    }],
    ['canonNotes', { ...validSeed, canonNotes: ['a', 'b', 'c', 'd', 'e'] }],
  ] as const)('rejects too many %s', (_field, candidate) => {
    expect(succeeds(candidate)).toBe(false)
  })

  it('rejects too few NPCs and locations', () => {
    expect(succeeds({ ...validSeed, npcs: [validSeed.npcs[0]] })).toBe(false)
    expect(succeeds({ ...validSeed, locations: [validSeed.locations[0]] })).toBe(false)
  })

  it.each([
    ['theme', { ...validSeed, themePack: 'space-opera' }],
    ['tone', { ...validSeed, tone: 'comedic' }],
    ['disposition', {
      ...validSeed,
      npcs: [{ ...validSeed.npcs[0], disposition: 'unknown' }, validSeed.npcs[1]],
    }],
    ['allowed theme', {
      ...validSeed,
      generationHints: {
        ...validSeed.generationHints,
        allowedThemePack: 'space-opera',
      },
    }],
    ['opening arc pattern', {
      ...validSeed,
      openingArc: { ...validSeed.openingArc, pattern: 'conquer' },
    }],
  ] as const)('rejects an invalid %s', (_field, candidate) => {
    expect(succeeds(candidate)).toBe(false)
  })

  it('rejects the wrong schema version and permits empty optional-count collections', () => {
    expect(succeeds({ ...validSeed, schemaVersion: 2 })).toBe(false)
    expect(WorldBibleSeedSchema.parse({
      ...validSeed,
      factions: [],
      canonNotes: [],
    })).toMatchObject({ factions: [], canonNotes: [] })
  })
})
