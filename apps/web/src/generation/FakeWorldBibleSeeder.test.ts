import { describe, expect, it, vi } from 'vitest'
import { WorldBibleSeedSchema } from '../domain/worldBible/worldBibleSeed'
import { FakeWorldBibleSeeder } from './FakeWorldBibleSeeder'

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

describe('FakeWorldBibleSeeder', () => {
  const seeder = new FakeWorldBibleSeeder()

  it('returns a byte-identical WorldBibleSeed for the same prompt', async () => {
    const first = await seeder.seed('a haunted keep under a red moon')
    const second = await seeder.seed('a haunted keep under a red moon')

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('produces meaningfully different fields for different prompts', async () => {
    const keep = await seeder.seed('a haunted keep under a red moon')
    const wasteland = await seeder.seed('survivors crossing a poisoned wasteland')

    expect(wasteland).not.toEqual(keep)
    expect(wasteland.title).not.toBe(keep.title)
    expect(wasteland.themePack).not.toBe(keep.themePack)
    expect(wasteland.openingArc).not.toEqual(keep.openingArc)
  })

  it.each(POST_APOC_KEYWORDS)('maps the %s keyword to the post-apoc pack', async (keyword) => {
    const bible = await seeder.seed(`a world shaped by ${keyword}`)

    expect(bible.themePack).toBe('post-apoc')
    expect(bible.generationHints.allowedThemePack).toBe('post-apoc')
  })

  it('defaults prompts without post-apoc keywords to fantasy-keep', async () => {
    const bible = await seeder.seed('a moonlit library inside an old castle')

    expect(bible.themePack).toBe('fantasy-keep')
    expect(bible.generationHints.allowedThemePack).toBe('fantasy-keep')
  })

  it('always returns internally validated, bounded data', async () => {
    const prompts = [
      '',
      '   ',
      'x',
      'a'.repeat(1_000),
      'dragon lair 🐉',
      'tavern, "busy" & loud\n\t',
      '<script>not executable</script>',
      'an infected survivor in the ruins',
    ]

    for (const prompt of prompts) {
      const bible = await seeder.seed(prompt)
      expect(WorldBibleSeedSchema.safeParse(bible).success).toBe(true)
      expect(bible.title.length).toBeLessThanOrEqual(60)
      expect(bible.factions.length).toBeGreaterThanOrEqual(2)
      expect(bible.factions.length).toBeLessThanOrEqual(3)
      expect(bible.npcs.length).toBeGreaterThanOrEqual(2)
      expect(bible.npcs.length).toBeLessThanOrEqual(3)
      expect(bible.locations.length).toBeGreaterThanOrEqual(2)
      expect(bible.locations.length).toBeLessThanOrEqual(4)
      expect(bible.generationHints.keywords.length).toBeLessThanOrEqual(6)
      expect(bible.canonNotes.length).toBeLessThanOrEqual(4)
      expect(bible.openingArc.hook.length).toBeLessThanOrEqual(120)
      expect(bible.openingArc.firstObjective.length).toBeLessThanOrEqual(120)
      expect(bible.openingArc.pressure.length).toBeLessThanOrEqual(120)
    }
  })

  it('keeps prompt-derived content inert and data-only', async () => {
    const prompt = '<script>globalThis.compromised = true</script>'
    const bible = await seeder.seed(prompt)
    const serialized = JSON.stringify(bible)

    expect(bible.title).toContain('<script>')
    expect(JSON.parse(serialized)).toEqual(bible)
    expect(serialized).toContain('<script>')
    expect(Object.values(bible).some((value) => typeof value === 'function')).toBe(false)
  })

  it('uses no clock, global randomness, or logging side effects', async () => {
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now must not be called')
    })
    const mathRandom = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called')
    })
    const methods = ['debug', 'info', 'warn', 'error'] as const
    const consoleSpies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )

    try {
      await expect(seeder.seed('a deterministic keep')).resolves.toBeDefined()
      expect(dateNow).not.toHaveBeenCalled()
      expect(mathRandom).not.toHaveBeenCalled()
      expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true)
    } finally {
      dateNow.mockRestore()
      mathRandom.mockRestore()
      consoleSpies.forEach((spy) => spy.mockRestore())
    }
  })
})
