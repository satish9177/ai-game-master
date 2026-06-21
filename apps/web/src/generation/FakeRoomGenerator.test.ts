import { describe, it, expect } from 'vitest'
import { FakeRoomGenerator } from './FakeRoomGenerator'
import { loadRoomSpec } from '../domain/loadRoomSpec'

// The published vocabulary the renderer has builders for (ADR-0001, CONVENTIONS.md).
const KNOWN_TYPES = ['throne', 'pillar', 'rug', 'torch', 'arch', 'scroll', 'npc', 'prop']

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
      expect(await gen.generate(p)).toBe(out) // determinism holds for these too
    }
  })
})
