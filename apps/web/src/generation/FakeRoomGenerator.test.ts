import { describe, it, expect } from 'vitest'
import { FakeRoomGenerator } from './FakeRoomGenerator'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { validateRoom } from '../domain/validateRoom'
import { assembleRoom } from '../domain/assembleRoom'
import { ROOM_OBJECT_ENTRY_LIMIT } from '../domain/roomSpec'
import { fallbackRoom } from '../domain/examples/fallbackRoom'
import { buildExitLookup } from '../app/exits'
import { themeVocabulary } from '../domain/generatedRoomThemeVocabulary'
import { ENVIRONMENT_KINDS } from '../domain/visuals/contracts'

// The published vocabulary the renderer has builders for (ADR-0001, CONVENTIONS.md).
const KNOWN_TYPES = [
  'throne',
  'altar',
  'statue',
  'pillar',
  'rug',
  'torch',
  'arch',
  'scroll',
  'book',
  'paper',
  'map',
  'chest',
  'corpse',
  'table',
  'machine',
  'artifact',
  'candle',
  'npc',
  'prop',
  'crate',
  'barrel',
  'debris',
  'barricade',
  'zombie',
  'architecture',
  'furniture',
  'clutter',
  'vegetation',
  'light-fixture',
]

const FANTASY_ANCHORS = ['throne', 'altar', 'statue'] as const
const POST_APOC_SUITABLE_TYPES = ['machine', 'corpse', 'table', 'chest', 'crate', 'barrel', 'debris', 'barricade', 'paper'] as const

const COVERAGE_PROMPTS = [
  'a haunted library',
  'a sunlit throne hall',
  'a dungeon cell',
  'a market square',
  'a quiet chapel',
  'crystal engine room',
  'forgotten archive',
  'ashen reliquary',
  'clockwork shrine',
  'candlelit crypt',
  'broken machine vault',
  'statue garden',
] as const

const POST_APOC_PROMPTS = [
  'abandoned clinic checkpoint',
  'burned highway triage camp',
  'sealed bunker infirmary',
  'raider barricade supply room',
] as const

type GeneratedRoomJson = {
  environmentKind?: string
  shell: {
    floorColor?: string
    wallColor?: string
    exits?: unknown[]
  }
  objects: {
    type: string
    color?: string
    interaction?: { exit?: unknown }
  }[]
}

function parseGenerated(out: string): GeneratedRoomJson {
  return JSON.parse(out) as GeneratedRoomJson
}

describe('FakeRoomGenerator', () => {
  const gen = new FakeRoomGenerator()

  it('returns a string of parseable JSON', async () => {
    const out = await gen.generate('a haunted library')
    expect(typeof out).toBe('string')
    expect(() => JSON.parse(out)).not.toThrow()
  })

  it('is deterministic: the same prompt yields a byte-identical string', async () => {
    const a = await gen.generate('a haunted library')
    const b = await gen.generate('a haunted library')
    expect(a).toBe(b)
  })

  it('different prompts produce different rooms', async () => {
    const a = await gen.generate('a haunted library')
    const b = await gen.generate('a sunlit throne hall')
    expect(a).not.toBe(b)
  })

  it('output passes loadRoomSpec with zero skipped objects', async () => {
    const room = loadRoomSpec(JSON.parse(await gen.generate('a dungeon cell')))
    expect(room.skipped).toEqual([])
    expect(room.warnings).toEqual([])
    expect(room.objects.length).toBeGreaterThan(0)
    expect(validateRoom(room).ok).toBe(true)
  })

  it('emits only known, published object types', async () => {
    const parsed = JSON.parse(await gen.generate('a market square')) as { objects: { type: string }[] }
    for (const obj of parsed.objects) {
      expect(KNOWN_TYPES).toContain(obj.type)
    }
  })

  it('emits every closed ruined-kingdom environment across bounded deterministic seeds', async () => {
    const seen = new Set<string>()
    for (let index = 0; index < 140; index += 1) {
      const parsed = parseGenerated(await gen.generate('environment coverage ' + index))
      if (parsed.environmentKind !== undefined) seen.add(parsed.environmentKind)
    }
    expect([...seen].sort()).toEqual([...ENVIRONMENT_KINDS].sort())
  })

  it('uses all five semantic families for rich layouts and never emits legacy prop filler', async () => {
    for (const prompt of COVERAGE_PROMPTS) {
      const parsed = parseGenerated(await gen.generate(prompt))
      const types = new Set(parsed.objects.map((object) => object.type))
      expect(types).not.toContain('prop')
      for (const family of ['architecture', 'furniture', 'clutter', 'vegetation', 'light-fixture']) {
        expect(types).toContain(family)
      }
      expect(parsed.objects.length).toBeGreaterThan(40)
    }
  })

  it('keeps fake visual composition semantic and free of renderer asset authority', async () => {
    const output = await gen.generate('a rich ruined kingdom crossing')
    const lower = output.toLowerCase()
    for (const forbidden of [
      '.glb', 'http://', 'https://', 'modelpath', 'materialpath',
      'nodename', 'clipname', 'shader', 'rendererinstruction', '<script',
    ]) {
      expect(lower).not.toContain(forbidden)
    }
  })
  it('round-trips as pure data — re-serializing the parsed value is identical', async () => {
    // If anything non-JSON (a function, undefined) had leaked in, this would differ.
    const out = await gen.generate('a quiet chapel')
    expect(JSON.stringify(JSON.parse(out))).toBe(out)
  })

  it('stays valid across varied, awkward prompts', async () => {
    const prompts = ['', '   ', 'x', 'a'.repeat(500), 'dragon lair 🐉', 'tavern, "busy" & loud\n\t']
    for (const p of prompts) {
      const out = await gen.generate(p)
      const room = loadRoomSpec(JSON.parse(out))
      expect(room.skipped).toEqual([])
      expect(validateRoom(room).ok).toBe(true)
      expect(await gen.generate(p)).toBe(out) // determinism holds for these too
    }
  })

  it('stays within the high parser-abuse envelope across the coverage matrix', async () => {
    for (const prompt of COVERAGE_PROMPTS) {
      const room = loadRoomSpec(JSON.parse(await gen.generate(prompt)))
      expect(room.objects.length).toBeLessThanOrEqual(ROOM_OBJECT_ENTRY_LIMIT)
    }
  })

  it('default/no-vocabulary generator can emit fantasy anchors', async () => {
    const seen = new Set<string>()
    for (const prompt of COVERAGE_PROMPTS) {
      const room = loadRoomSpec(JSON.parse(await gen.generate(prompt)))
      for (const object of room.objects) seen.add(object.type)
    }

    for (const type of FANTASY_ANCHORS) {
      expect(seen.has(type)).toBe(true)
    }
  })

  it('assembles fake generated rooms as generated without fallback', async () => {
    const fallback = loadRoomSpec(fallbackRoom)
    for (const prompt of COVERAGE_PROMPTS) {
      const result = assembleRoom(await gen.generate(prompt), fallback)
      expect(result.diagnostics.provenance).toBe('generated')
      expect(result.diagnostics.exitNavigationEnsured).toBe(true)
      expect(buildExitLookup(result.room).size).toBeGreaterThanOrEqual(1)
      expect(result.diagnostics.failedStage).toBeUndefined()
      expect(result.diagnostics.repairAttempted).toBe(false)
      expect(validateRoom(result.room).ok).toBe(true)
    }
  })

  it('post-apoc vocabulary generator is deterministic for the same seed', async () => {
    const postApoc = new FakeRoomGenerator(themeVocabulary('post-apoc'))

    const a = await postApoc.generate('abandoned clinic checkpoint')
    const b = await postApoc.generate('abandoned clinic checkpoint')

    expect(a).toBe(b)
  })

  it('post-apoc output does not contain suppressed fantasy types', async () => {
    const vocabulary = themeVocabulary('post-apoc')
    const postApoc = new FakeRoomGenerator(vocabulary)

    for (const prompt of POST_APOC_PROMPTS) {
      const parsed = parseGenerated(await postApoc.generate(prompt))
      const emittedTypes = parsed.objects.map((object) => object.type)

      for (const type of vocabulary.neverAppear) {
        expect(emittedTypes).not.toContain(type)
      }
    }
  })

  it('post-apoc output contains at least one suitable post-apoc object', async () => {
    const postApoc = new FakeRoomGenerator(themeVocabulary('post-apoc'))
    const parsed = parseGenerated(await postApoc.generate('sealed bunker infirmary'))
    const emittedTypes = new Set(parsed.objects.map((object) => object.type))

    expect(POST_APOC_SUITABLE_TYPES.some((type) => emittedTypes.has(type))).toBe(true)
  })

  it('post-apoc output uses post-apoc palette colors', async () => {
    const vocabulary = themeVocabulary('post-apoc')
    const postApoc = new FakeRoomGenerator(vocabulary)
    const parsed = parseGenerated(await postApoc.generate('burned highway triage camp'))
    const paletteColors = new Set([
      ...vocabulary.palette.floor,
      ...vocabulary.palette.wall,
      ...vocabulary.palette.prop,
      vocabulary.palette.accent,
      vocabulary.palette.emissive,
    ])

    expect([
      parsed.shell.floorColor,
      parsed.shell.wallColor,
      ...parsed.objects.map((object) => object.color),
    ].some((color) => typeof color === 'string' && paletteColors.has(color))).toBe(true)
  })

  it('post-apoc generated output still loads and validates', async () => {
    const postApoc = new FakeRoomGenerator(themeVocabulary('post-apoc'))

    for (const prompt of POST_APOC_PROMPTS) {
      const room = loadRoomSpec(JSON.parse(await postApoc.generate(prompt)))
      expect(room.skipped).toEqual([])
      expect(validateRoom(room).ok).toBe(true)
    }
  })

  it('existing NPC request path still works with theme vocabulary', async () => {
    const vocabulary = themeVocabulary('post-apoc')
    const postApoc = new FakeRoomGenerator(vocabulary)

    for (const prompt of COVERAGE_PROMPTS) {
      const parsed = parseGenerated(await postApoc.generate(prompt))
      const npc = parsed.objects.find((object) => object.type === 'npc')
      if (!npc) continue

      expect(vocabulary.neverAppear).not.toContain('npc')
      expect(npc.interaction).toMatchObject({ key: 'F' })
      return
    }

    throw new Error('coverage prompts did not emit an NPC')
  })

  it('arch and exit-related generation still assembles with an exit lookup', async () => {
    const fallback = loadRoomSpec(fallbackRoom)
    const postApoc = new FakeRoomGenerator(themeVocabulary('post-apoc'))
    const result = assembleRoom(await postApoc.generate('raider barricade supply room'), fallback)

    expect(result.diagnostics.provenance).toBe('generated')
    expect(result.room.objects.some((object) => object.type === 'arch')).toBe(true)
    expect(buildExitLookup(result.room).size).toBeGreaterThanOrEqual(1)
  })

  it('does not expose sci-fi or spaceship constructor theme support', () => {
    // @ts-expect-error Sci-fi is intentionally deferred to a later theme-pack feature.
    const sciFiVocabulary: ConstructorParameters<typeof FakeRoomGenerator>[0] = 'sci-fi'
    // @ts-expect-error Spaceship is intentionally deferred to a later theme-pack feature.
    const spaceshipVocabulary: ConstructorParameters<typeof FakeRoomGenerator>[0] = 'spaceship'

    expect([sciFiVocabulary, spaceshipVocabulary]).toEqual(['sci-fi', 'spaceship'])
  })
})
