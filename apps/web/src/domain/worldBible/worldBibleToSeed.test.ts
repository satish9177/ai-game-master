import { describe, expect, it, vi } from 'vitest'
import type { WorldBibleSeed } from './worldBibleSeed'
import { worldBibleToGeneratorSeed } from './worldBibleToSeed'

const bible: WorldBibleSeed = {
  schemaVersion: 1,
  title: 'The Ember Crown',
  themePack: 'fantasy-keep',
  tone: 'mysterious',
  premise: 'A sealed keep wakes.',
  startingLocation: 'The rain-dark gatehouse',
  majorConflict: 'Rival houses seek the crown.',
  factions: ['The Ash Wardens'],
  npcs: [
    { name: 'Mara', role: 'Gate captain', disposition: 'ally' },
    { name: 'Orin', role: 'Archivist', disposition: 'neutral' },
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
  canonNotes: [],
}

describe('worldBibleToGeneratorSeed', () => {
  it('returns deterministic output for the same WorldBibleSeed', () => {
    expect(worldBibleToGeneratorSeed(bible)).toBe(worldBibleToGeneratorSeed(bible))
  })

  it('puts the title first', () => {
    expect(worldBibleToGeneratorSeed(bible)).toMatch(/^The Ember Crown \| /)
  })

  it('keeps the projected seed bounded to 160 characters', () => {
    const maximalBible: WorldBibleSeed = {
      ...bible,
      title: 't'.repeat(60),
      premise: 'p'.repeat(240),
      generationHints: {
        ...bible.generationHints,
        keywords: Array.from({ length: 6 }, () => 'k'.repeat(24)),
      },
    }

    expect(worldBibleToGeneratorSeed(maximalBible)).toHaveLength(160)
  })

  it('includes the opening arc in a stable compact field order', () => {
    expect(worldBibleToGeneratorSeed(bible)).toBe(
      'The Ember Crown | fantasy-keep | mysterious | investigate:Find the failing ward. | A sealed keep wakes. | embers,rain,old stone',
    )
  })

  it('does not mutate its input', () => {
    const input = structuredClone(bible)
    const before = structuredClone(input)
    Object.freeze(input.generationHints.keywords)
    Object.freeze(input.openingArc)
    Object.freeze(input.generationHints)
    Object.freeze(input)

    expect(() => worldBibleToGeneratorSeed(input)).not.toThrow()
    expect(input).toEqual(before)
  })

  it('changes when a projected field meaningfully differs', () => {
    const variants: WorldBibleSeed[] = [
      bible,
      { ...bible, title: 'The Cinder Throne' },
      { ...bible, themePack: 'post-apoc' },
      { ...bible, tone: 'tense' },
      { ...bible, premise: 'The last safehouse is failing.' },
      {
        ...bible,
        generationHints: { ...bible.generationHints, keywords: ['ash', 'omens'] },
      },
      {
        ...bible,
        openingArc: { ...bible.openingArc, pattern: 'rescue' },
      },
    ]
    const projections = variants.map(worldBibleToGeneratorSeed)

    expect(new Set(projections).size).toBe(variants.length)
  })

  it('imports and projects without logger or console side effects', async () => {
    vi.resetModules()
    const methods = ['debug', 'info', 'warn', 'error'] as const
    const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))

    try {
      const projectionModule = await import('./worldBibleToSeed')
      expect(projectionModule.worldBibleToGeneratorSeed(bible)).toBe(
        worldBibleToGeneratorSeed(bible),
      )
      expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true)
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
  })
})
