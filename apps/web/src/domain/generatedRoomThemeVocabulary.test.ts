import { describe, expect, it } from 'vitest'
import {
  type GeneratedRoomThemeVocabulary,
  type GeneratedRoomVisualTheme,
  themeVocabulary,
} from './generatedRoomThemeVocabulary'
import { RoomObjectSchema, type RoomObject } from './roomSpec'

const ALL_THEMES: readonly GeneratedRoomVisualTheme[] = ['fantasy-keep', 'post-apoc']
const HEX_COLOR = /^#[0-9a-f]{6}$/

function allPools(vocabulary: GeneratedRoomThemeVocabulary): readonly RoomObject['type'][] {
  return [
    ...vocabulary.anchorPool,
    ...vocabulary.documentPool,
    ...vocabulary.practicalPool,
    ...vocabulary.strangePool,
    ...vocabulary.neverAppear,
  ]
}

function minimalObject(type: RoomObject['type']): unknown {
  const base = { type, position: [0, 0, 0] }
  if (type === 'scroll') {
    return { ...base, interaction: { key: 'E', prompt: 'Read' } }
  }
  if (type === 'npc') {
    return { ...base, name: 'Guide', interaction: { key: 'F', prompt: 'Talk' } }
  }
  return base
}

function colors(vocabulary: GeneratedRoomThemeVocabulary): readonly string[] {
  return [
    ...vocabulary.palette.floor,
    ...vocabulary.palette.wall,
    ...vocabulary.palette.prop,
    vocabulary.palette.accent,
    vocabulary.palette.emissive,
  ]
}

describe('themeVocabulary', () => {
  it('returns machine and corpse anchors for post-apoc rooms', () => {
    const vocabulary = themeVocabulary('post-apoc')

    expect(vocabulary.anchorPool).toContain('machine')
    expect(vocabulary.anchorPool).toContain('corpse')
  })

  it('suppresses fantasy-only object types for post-apoc rooms', () => {
    const vocabulary = themeVocabulary('post-apoc')

    expect(vocabulary.neverAppear).toEqual(
      expect.arrayContaining(['throne', 'altar', 'statue', 'scroll', 'candle', 'rug']),
    )
  })

  it('keeps arch and npc available to post-apoc navigation and presence rules', () => {
    const vocabulary = themeVocabulary('post-apoc')

    expect(vocabulary.neverAppear).not.toContain('arch')
    expect(vocabulary.neverAppear).not.toContain('npc')
  })

  it('does not include post-apoc suppressed types in active pools', () => {
    const vocabulary = themeVocabulary('post-apoc')
    const activePools = [
      ...vocabulary.anchorPool,
      ...vocabulary.documentPool,
      ...vocabulary.practicalPool,
      ...vocabulary.strangePool,
    ]

    for (const type of vocabulary.neverAppear) {
      expect(activePools).not.toContain(type)
    }
  })

  it('preserves fantasy story anchors', () => {
    const vocabulary = themeVocabulary('fantasy-keep')

    expect(vocabulary.anchorPool).toEqual(expect.arrayContaining(['throne', 'altar', 'statue']))
  })

  it('preserves fantasy document vocabulary', () => {
    const vocabulary = themeVocabulary('fantasy-keep')

    expect(vocabulary.documentPool).toEqual(expect.arrayContaining(['scroll', 'book', 'map', 'paper']))
  })

  it('uses fantasy vocabulary when no theme is provided', () => {
    expect(themeVocabulary()).toEqual(themeVocabulary('fantasy-keep'))
  })

  it('uses only valid RoomObject types in every pool', () => {
    for (const theme of ALL_THEMES) {
      for (const type of allPools(themeVocabulary(theme))) {
        expect(RoomObjectSchema.safeParse(minimalObject(type)).success).toBe(true)
      }
    }
  })

  it('uses valid lowercase #rrggbb colors', () => {
    for (const theme of ALL_THEMES) {
      for (const color of colors(themeVocabulary(theme))) {
        expect(color).toMatch(HEX_COLOR)
      }
    }
  })

  it('is deterministic for the same theme', () => {
    expect(themeVocabulary('post-apoc')).toEqual(themeVocabulary('post-apoc'))
    expect(themeVocabulary('fantasy-keep')).toEqual(themeVocabulary('fantasy-keep'))
  })

  it('protects future calls from caller mutation attempts', () => {
    const vocabulary = themeVocabulary('post-apoc')

    expect(() => {
      ;(vocabulary.anchorPool as RoomObject['type'][]).push('throne')
    }).toThrow(TypeError)

    expect(themeVocabulary('post-apoc').anchorPool).toEqual(['machine', 'corpse'])
  })

  it('does not expose a sci-fi or spaceship theme in v0', () => {
    // @ts-expect-error Sci-fi is intentionally deferred to a later theme-pack feature.
    const sciFiTheme: GeneratedRoomVisualTheme = 'sci-fi'
    // @ts-expect-error Spaceship is intentionally deferred to a later theme-pack feature.
    const spaceshipTheme: GeneratedRoomVisualTheme = 'spaceship'

    expect([sciFiTheme, spaceshipTheme]).toEqual(['sci-fi', 'spaceship'])
  })
})
