import { describe, expect, it } from 'vitest'
import { RoomObjectSchema } from './roomSpec'
import { loadRoomSpec } from './loadRoomSpec'

/**
 * Schema-level coverage for the post-apocalyptic asset pack v0. Confirms each
 * new object type parses from a minimal literal (defaults + shared transform
 * fill the rest) and that the lenient loader keeps skipping genuinely unknown
 * types — adding vocabulary must not change the trust boundary.
 */

const minimalRoom = (objects: unknown[]): unknown => ({
  schemaVersion: 1,
  id: 'pack-test',
  name: 'Pack Test',
  shell: { dimensions: { width: 12, depth: 12, height: 4 }, exits: [] },
  spawn: { position: [0, 1.7, 4] },
  objects,
})

describe('post-apoc object schema', () => {
  it.each(['crate', 'barrel', 'debris', 'barricade', 'zombie'] as const)(
    'parses a minimal %s and fills shared transform defaults',
    (type) => {
      const parsed = RoomObjectSchema.parse({ type, position: [1, 0, 2] })
      expect(parsed.type).toBe(type)
      expect(parsed.position).toEqual([1, 0, 2])
      expect(parsed.rotationY).toBe(0) // transform default
      expect(parsed.scale).toBe(1) // transform default
    },
  )

  it('lets a zombie carry the shared optional interaction', () => {
    const parsed = RoomObjectSchema.parse({
      type: 'zombie',
      position: [0, 0, 0],
      interaction: { key: 'F', prompt: 'Press F to examine the corpse' },
    })
    expect(parsed.type === 'zombie' && parsed.interaction?.key).toBe('F')
  })

  it('omits interaction on a zombie that does not declare one', () => {
    const parsed = RoomObjectSchema.parse({ type: 'zombie', position: [0, 0, 0] })
    expect('interaction' in parsed).toBe(false)
  })

  it('loads the new types without skipping while still skipping unknown ones', () => {
    const loaded = loadRoomSpec(
      minimalRoom([
        { type: 'crate', position: [2, 0, 2] },
        { type: 'barrel', position: [-2, 0, 2] },
        { type: 'debris', position: [2, 0, -2] },
        { type: 'barricade', position: [-2, 0, -2] },
        { type: 'zombie', position: [0, 0, -3] },
        { type: 'mutant', position: [0, 0, 0] }, // not in the vocabulary
      ]),
    )
    expect(loaded.objects.map((o) => o.type)).toEqual([
      'crate',
      'barrel',
      'debris',
      'barricade',
      'zombie',
    ])
    expect(loaded.skipped).toHaveLength(1)
    expect(loaded.skipped[0]?.type).toBe('mutant')
  })
})
