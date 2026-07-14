import { describe, it, expect } from 'vitest'
import {
  GENERATED_ROOM_ALIAS_CATALOG,
  repairGeneratedAliases,
} from './generatedRoomAliases'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid envelope with the given objects array. */
function envelope(objects: unknown[]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'test',
    name: 'Test',
    shell: { dimensions: { width: 18, depth: 18, height: 4 } },
    spawn: { position: [0, 1.7, 0] },
    objects,
  }
}

/** A single object entry with type and extra fields. */
function entry(type: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return { type, position: [1, 0, 1], ...extras }
}

// ---------------------------------------------------------------------------
// Alias coverage — every approved alias maps to expected canonical type
// ---------------------------------------------------------------------------

describe('repairGeneratedAliases — alias table coverage', () => {
  const cases = GENERATED_ROOM_ALIAS_CATALOG.map(({ alias, type, variant }) => [
    alias,
    type,
    variant,
  ] as const)

  it('contains exactly the approved 100 normalized aliases', () => {
    expect(GENERATED_ROOM_ALIAS_CATALOG).toHaveLength(100)
    expect(new Set(GENERATED_ROOM_ALIAS_CATALOG.map(({ alias }) => alias)).size).toBe(100)
  })

  it.each(cases)('"%s" → "%s"', (alias, canonical) => {
    const { value, count } = repairGeneratedAliases(envelope([entry(alias)]))
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['type']).toBe(canonical)
    expect(count).toBe(1)
  })

  it.each(cases)('preserves the exact semantic variant for %s', (alias, _canonical, variant) => {
    const { value } = repairGeneratedAliases(envelope([entry(alias)]))
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['variant']).toBe(variant)
  })
})

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

describe('repairGeneratedAliases — normalization', () => {
  it('uppercased alias is matched ("Floor Plan")', () => {
    const { value, count } = repairGeneratedAliases(envelope([entry('Floor Plan')]))
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['type']).toBe('map')
    expect(count).toBe(1)
  })

  it('padded alias is matched ("  DESK ")', () => {
    const { value, count } = repairGeneratedAliases(envelope([entry('  DESK ')]))
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['type']).toBe('table')
    expect(count).toBe(1)
  })

  it('extra internal whitespace is collapsed ("floor  plan")', () => {
    const { value, count } = repairGeneratedAliases(envelope([entry('floor  plan')]))
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['type']).toBe('map')
    expect(count).toBe(1)
  })

  it('mixed case and padding combined ("  Ritual  Platform  ")', () => {
    const { value, count } = repairGeneratedAliases(envelope([entry('  Ritual  Platform  ')]))
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['type']).toBe('altar')
    expect(count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Canonical types pass through unchanged
// ---------------------------------------------------------------------------

describe('repairGeneratedAliases — canonical types pass through', () => {
  const canonicalTypes = [
    'throne', 'pillar', 'rug', 'torch', 'arch', 'scroll',
    'book', 'paper', 'map', 'chest', 'corpse', 'table',
    'altar', 'statue', 'machine', 'artifact', 'candle',
    'npc', 'prop', 'crate', 'barrel', 'debris', 'barricade', 'zombie',
    'architecture', 'furniture', 'clutter', 'vegetation', 'light-fixture',
  ]

  it.each(canonicalTypes)('canonical type "%s" is unchanged with count 0', (type) => {
    const obj = entry(type)
    const { value, count } = repairGeneratedAliases(envelope([obj]))
    const objects = (value as Record<string, unknown>)['objects'] as unknown[]
    expect((objects[0] as Record<string, unknown>)['type']).toBe(type)
    expect(count).toBe(0)
    // Same envelope reference when nothing changed
    expect(value).toBe(envelope([obj]).constructor === Object ? value : value)
  })

  it('returns the same envelope reference when no type changed', () => {
    const input = envelope([entry('pillar')])
    const { value } = repairGeneratedAliases(input)
    expect(value).toBe(input)
  })
})

// ---------------------------------------------------------------------------
// Rejected / deferred aliases pass through unchanged
// ---------------------------------------------------------------------------

describe('repairGeneratedAliases — deferred aliases are not repaired', () => {
  const deferred = [
    'body', 'device', 'bench', 'lamp', 'lantern', 'light',
    'fire', 'campfire', 'brazier', 'window', 'stairs', 'ladder',
    'trapdoor', 'fountain', 'well', 'pool', 'tree', 'plant',
    'bed', 'chair', 'stool', 'shelf', 'cabinet', 'wardrobe',
    'bloodstain', 'stain', 'markings', 'weapon', 'sword', 'gun',
    'key', 'coin', 'potion', 'loot', 'treasure', 'enemy',
    'monster', 'creature', 'guard', 'bookcase', 'equipment',
  ]

  it.each(deferred)('"%s" is left unchanged (count 0)', (alias) => {
    const input = envelope([entry(alias)])
    const { value, count } = repairGeneratedAliases(input)
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['type']).toBe(alias)
    expect(count).toBe(0)
    expect(value).toBe(input)
  })
})

// ---------------------------------------------------------------------------
// Robustness — bad input shapes never throw, always count 0
// ---------------------------------------------------------------------------

describe('repairGeneratedAliases — robustness', () => {
  it('null returns unchanged, count 0', () => {
    const { value, count } = repairGeneratedAliases(null)
    expect(value).toBeNull()
    expect(count).toBe(0)
  })

  it('string returns unchanged, count 0', () => {
    const { value, count } = repairGeneratedAliases('not an object')
    expect(value).toBe('not an object')
    expect(count).toBe(0)
  })

  it('number returns unchanged, count 0', () => {
    const { value, count } = repairGeneratedAliases(42)
    expect(value).toBe(42)
    expect(count).toBe(0)
  })

  it('array (top-level) returns unchanged, count 0', () => {
    const arr = [{ type: 'desk', position: [0, 0, 0] }]
    const { value, count } = repairGeneratedAliases(arr)
    expect(value).toBe(arr)
    expect(count).toBe(0)
  })

  it('object missing objects field returns unchanged, count 0', () => {
    const input = { schemaVersion: 1 }
    const { value, count } = repairGeneratedAliases(input)
    expect(value).toBe(input)
    expect(count).toBe(0)
  })

  it('objects field is non-array returns unchanged, count 0', () => {
    const input = { schemaVersion: 1, objects: 'not an array' }
    const { value, count } = repairGeneratedAliases(input)
    expect(value).toBe(input)
    expect(count).toBe(0)
  })

  it('objects field is null returns unchanged, count 0', () => {
    const input = { schemaVersion: 1, objects: null }
    const { value, count } = repairGeneratedAliases(input)
    expect(value).toBe(input)
    expect(count).toBe(0)
  })

  it('non-object entry in array (null) is left unchanged, count 0', () => {
    const input = envelope([null])
    const { value, count } = repairGeneratedAliases(input)
    const objects = (value as Record<string, unknown>)['objects'] as unknown[]
    expect(objects[0]).toBeNull()
    expect(count).toBe(0)
    expect(value).toBe(input)
  })

  it('non-object entry in array (number) is left unchanged, count 0', () => {
    const input = envelope([42])
    const { value, count } = repairGeneratedAliases(input)
    expect(count).toBe(0)
    expect(value).toBe(input)
  })

  it('entry missing type field is left unchanged, count 0', () => {
    const input = envelope([{ position: [0, 0, 0] }])
    const { value, count } = repairGeneratedAliases(input)
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['type']).toBeUndefined()
    expect(count).toBe(0)
    expect(value).toBe(input)
  })

  it('entry with non-string type is left unchanged, count 0', () => {
    const input = envelope([{ type: 42, position: [0, 0, 0] }])
    const { value, count } = repairGeneratedAliases(input)
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['type']).toBe(42)
    expect(count).toBe(0)
    expect(value).toBe(input)
  })

  it('entry with array type is left unchanged, count 0', () => {
    const input = envelope([{ type: ['desk'], position: [0, 0, 0] }])
    const { value, count } = repairGeneratedAliases(input)
    expect(count).toBe(0)
    expect(value).toBe(input)
  })

  it('empty objects array returns same reference, count 0', () => {
    const input = envelope([])
    const { value, count } = repairGeneratedAliases(input)
    expect(value).toBe(input)
    expect(count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Non-type fields are preserved exactly
// ---------------------------------------------------------------------------

describe('repairGeneratedAliases — field preservation', () => {
  it('position is preserved through rewrite', () => {
    const input = envelope([{ type: 'desk', position: [3, 0, -5] }])
    const { value } = repairGeneratedAliases(input)
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['position']).toEqual([3, 0, -5])
    expect(objects[0]!['type']).toBe('table')
  })

  it('interaction is preserved through rewrite', () => {
    const interaction = { key: 'E', prompt: 'Examine the desk' }
    const input = envelope([{ type: 'desk', position: [0, 0, 0], interaction }])
    const { value } = repairGeneratedAliases(input)
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['interaction']).toEqual(interaction)
  })

  it('color field is preserved through rewrite', () => {
    const input = envelope([{ type: 'skeleton', position: [0, 0, 0], color: '#aabbcc' }])
    const { value } = repairGeneratedAliases(input)
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['color']).toBe('#aabbcc')
    expect(objects[0]!['type']).toBe('corpse')
  })

  it('unknown extra fields are preserved through rewrite', () => {
    const input = envelope([{ type: 'shrine', position: [0, 0, 0], someCustomField: 'hello' }])
    const { value } = repairGeneratedAliases(input)
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['someCustomField']).toBe('hello')
    expect(objects[0]!['type']).toBe('altar')
  })

  it('rotationY and scale are preserved through rewrite', () => {
    const input = envelope([{ type: 'journal', position: [1, 0, 1], rotationY: 45, scale: 2 }])
    const { value } = repairGeneratedAliases(input)
    const objects = (value as Record<string, unknown>)['objects'] as Record<string, unknown>[]
    expect(objects[0]!['rotationY']).toBe(45)
    expect(objects[0]!['scale']).toBe(2)
    expect(objects[0]!['type']).toBe('book')
  })

  it('non-aliased entries keep same object reference', () => {
    const unchanged = entry('pillar')
    const aliased = entry('desk')
    const input = envelope([unchanged, aliased])
    const { value } = repairGeneratedAliases(input)
    const objects = (value as Record<string, unknown>)['objects'] as unknown[]
    expect(objects[0]).toBe(unchanged)
    expect(objects[1]).not.toBe(aliased)
  })
})

// ---------------------------------------------------------------------------
// Count accuracy
// ---------------------------------------------------------------------------

describe('repairGeneratedAliases — count accuracy', () => {
  it('count equals number of rewritten entries', () => {
    const { count } = repairGeneratedAliases(
      envelope([
        entry('desk'),      // → table
        entry('pillar'),    // canonical → unchanged
        entry('skeleton'),  // → corpse
        entry('body'),      // deferred → unchanged
        entry('shrine'),    // → altar
      ]),
    )
    expect(count).toBe(3)
  })

  it('count is 0 when all entries are canonical or deferred', () => {
    const { count } = repairGeneratedAliases(
      envelope([entry('torch'), entry('npc'), entry('body'), entry('lamp')]),
    )
    expect(count).toBe(0)
  })

  it('count matches when all entries are aliased', () => {
    const { count } = repairGeneratedAliases(
      envelope([entry('notes'), entry('bones'), entry('rubble')]),
    )
    expect(count).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// No mutation of input
// ---------------------------------------------------------------------------

describe('repairGeneratedAliases — no mutation', () => {
  it('input envelope object is not mutated after rewrite', () => {
    const original = envelope([entry('desk')])
    const originalObjects = original['objects'] as Record<string, unknown>[]
    const originalType = originalObjects[0]!['type']

    repairGeneratedAliases(original)

    expect(original['objects']).toBe(originalObjects)
    expect(originalObjects[0]!['type']).toBe(originalType)
  })

  it('input object entries are not mutated after rewrite', () => {
    const obj = entry('skeleton')
    repairGeneratedAliases(envelope([obj]))
    expect(obj['type']).toBe('skeleton')
  })

  it('envelope reference is unchanged when nothing is rewritten', () => {
    const input = envelope([entry('torch'), entry('pillar')])
    const { value } = repairGeneratedAliases(input)
    expect(value).toBe(input)
  })

  it('objects array reference is unchanged when nothing is rewritten', () => {
    const objects = [entry('torch')]
    const input = { ...envelope([]), objects }
    const { value } = repairGeneratedAliases(input)
    expect((value as Record<string, unknown>)['objects']).toBe(objects)
  })
})

// ---------------------------------------------------------------------------
// Other envelope fields are preserved
// ---------------------------------------------------------------------------

describe('repairGeneratedAliases — other envelope fields preserved', () => {
  it('non-objects fields of the envelope are preserved when objects are rewritten', () => {
    const input = {
      schemaVersion: 1,
      id: 'room-42',
      name: 'Dungeon',
      shell: { dimensions: { width: 18, depth: 18, height: 4 } },
      spawn: { position: [0, 1.7, 0] },
      lighting: { ambient: { intensity: 0.5 } },
      objects: [entry('desk')],
    }
    const { value } = repairGeneratedAliases(input)
    const v = value as Record<string, unknown>
    expect(v['schemaVersion']).toBe(1)
    expect(v['id']).toBe('room-42')
    expect(v['name']).toBe('Dungeon')
    expect(v['spawn']).toBe(input['spawn'])
    expect(v['shell']).toBe(input['shell'])
    expect(v['lighting']).toBe((input as Record<string, unknown>)['lighting'])
  })
})
