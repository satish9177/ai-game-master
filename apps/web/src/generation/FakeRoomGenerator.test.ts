import { describe, it, expect } from 'vitest'
import { FakeRoomGenerator } from './FakeRoomGenerator'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { validateRoom } from '../domain/validateRoom'
import { assembleRoom } from '../domain/assembleRoom'
import { GENERATED_ROOM } from '../domain/generatedRoomLayout'
import { fallbackRoom } from '../domain/examples/fallbackRoom'
import { buildExitLookup } from '../app/exits'

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
]

const VISUAL_VOCABULARY_TYPES = [
  'book',
  'paper',
  'map',
  'chest',
  'corpse',
  'table',
  'altar',
  'statue',
  'machine',
  'artifact',
  'candle',
] as const

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
      expect(room.objects.length).toBeLessThanOrEqual(GENERATED_ROOM.MAX_OBJECTS)
      expect(await gen.generate(p)).toBe(out) // determinism holds for these too
    }
  })

  it('stays under the generated-room object cap across the coverage matrix', async () => {
    for (const prompt of COVERAGE_PROMPTS) {
      const room = loadRoomSpec(JSON.parse(await gen.generate(prompt)))
      expect(room.objects.length).toBeLessThanOrEqual(GENERATED_ROOM.MAX_OBJECTS)
    }
  })

  it('covers the new visual vocabulary across a fixed prompt matrix', async () => {
    const seen = new Set<string>()
    for (const prompt of COVERAGE_PROMPTS) {
      const room = loadRoomSpec(JSON.parse(await gen.generate(prompt)))
      for (const object of room.objects) seen.add(object.type)
    }

    for (const type of VISUAL_VOCABULARY_TYPES) {
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
})
