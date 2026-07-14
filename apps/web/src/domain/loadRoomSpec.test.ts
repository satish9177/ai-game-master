import { describe, it, expect } from 'vitest'
import { loadRoomSpec } from './loadRoomSpec'
import { ROOM_OBJECT_ENTRY_LIMIT } from './roomSpec'
import type { SkippedObjectReasonCounts } from './loadRoomSpec'

/* ---------- shared base spec ---------- */

const BASE = {
  schemaVersion: 1 as const,
  id: 'test-room',
  name: 'Test Room',
  shell: {
    dimensions: { width: 16, depth: 16, height: 4 },
    exits: [] as [],
  },
  spawn: { position: [0, 1.7, 4] as [number, number, number] },
}

function withObjects(objects: unknown[]) {
  return { ...BASE, objects }
}

function totalCount(counts: SkippedObjectReasonCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0)
}

/* ---------- tests ---------- */

describe('loadRoomSpec – skip-reason classification (Slice 7E)', () => {
  it('valid object produces zero reason counts and is not skipped', () => {
    const result = loadRoomSpec(withObjects([{ type: 'pillar', position: [1, 0, 1] }]))
    expect(result.objects).toHaveLength(1)
    expect(result.skipped).toHaveLength(0)
    expect(totalCount(result.skippedObjectReasonCounts)).toBe(0)
  })

  it('all reason counts are zero when no objects are present', () => {
    const result = loadRoomSpec(withObjects([]))
    expect(totalCount(result.skippedObjectReasonCounts)).toBe(0)
    expect(result.skippedObjectReasonCounts.unknownType).toBe(0)
    expect(result.skippedObjectReasonCounts.missingRequiredField).toBe(0)
    expect(result.skippedObjectReasonCounts.invalidPosition).toBe(0)
  })

  it('unknown type → unknownType', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'lamp', position: [1, 0, 1] },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.unknownType).toBe(1)
    expect(totalCount(result.skippedObjectReasonCounts)).toBe(1)
  })

  it('unknown type does not expose the raw type string in the reason counts', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'iron maiden', position: [1, 0, 1] },
    ]))
    expect(result.skippedObjectReasonCounts.unknownType).toBe(1)
    const dump = JSON.stringify(result.skippedObjectReasonCounts)
    expect(dump).not.toContain('iron maiden')
    expect(dump).not.toContain('iron')
  })

  it('malformed position (wrong type) → invalidPosition', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'pillar', position: 'not-a-vec' },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.invalidPosition).toBe(1)
    expect(result.skippedObjectReasonCounts.unknownType).toBe(0)
  })

  it('malformed position (too few elements) → invalidPosition', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'pillar', position: [1, 0] },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.invalidPosition).toBe(1)
  })

  it('missing npc interaction → invalidInteraction', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'npc', name: 'Guard', position: [1, 0, 1] },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.invalidInteraction).toBe(1)
  })

  it('missing scroll interaction → invalidInteraction', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'scroll', position: [1, 0, 1] },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.invalidInteraction).toBe(1)
  })

  it('invalid interaction body (empty prompt) → invalidInteraction', () => {
    const result = loadRoomSpec(withObjects([
      {
        type: 'scroll',
        position: [1, 0, 1],
        interaction: { key: 'E', prompt: '' }, // prompt min(1) fails
      },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.invalidInteraction).toBe(1)
  })

  it('missing npc name → missingRequiredField', () => {
    const result = loadRoomSpec(withObjects([
      {
        type: 'npc',
        position: [1, 0, 1],
        interaction: { key: 'F', prompt: 'Hello' },
      },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.missingRequiredField).toBe(1)
    expect(result.skippedObjectReasonCounts.invalidInteraction).toBe(0)
  })

  it('invalid scale → invalidTransform', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'pillar', position: [1, 0, 1], scale: -1 },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.invalidTransform).toBe(1)
  })

  it('invalid rotationY (wrong type) → invalidTransform', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'pillar', position: [1, 0, 1], rotationY: 'south' },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.invalidTransform).toBe(1)
  })

  it('invalid radius (negative) → invalidDimensions', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'pillar', position: [1, 0, 1], radius: -1 },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.invalidDimensions).toBe(1)
  })

  it('invalid size tuple → invalidDimensions', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'rug', position: [0, 0, 0], size: [-1, 2] },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.invalidDimensions).toBe(1)
  })

  it('invalid color (not #rrggbb) → invalidColor', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'throne', position: [1, 0, 1], color: 'red' },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.invalidColor).toBe(1)
  })

  it('invalid waxColor → invalidColor', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'candle', position: [1, 0, 1], waxColor: 'white' },
    ]))
    expect(result.skipped).toHaveLength(1)
    expect(result.skippedObjectReasonCounts.invalidColor).toBe(1)
  })

  it('aggregate counts equal skipped.length across mixed objects', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'lamp', position: [1, 0, 1] },          // unknownType
      { type: 'pillar', position: 'bad' },              // invalidPosition
      { type: 'scroll', position: [0, 0, 0] },          // invalidInteraction
      { type: 'pillar', position: [2, 0, 2] },          // valid
    ]))
    expect(result.skipped).toHaveLength(3)
    expect(totalCount(result.skippedObjectReasonCounts)).toBe(3)
    expect(result.skippedObjectReasonCounts.unknownType).toBe(1)
    expect(result.skippedObjectReasonCounts.invalidPosition).toBe(1)
    expect(result.skippedObjectReasonCounts.invalidInteraction).toBe(1)
  })

  it('multiple unknown types accumulate in unknownType bucket', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'desk', position: [1, 0, 1] },
      { type: 'skeleton', position: [2, 0, 2] },
      { type: 'lamp', position: [3, 0, 3] },
    ]))
    expect(result.skipped).toHaveLength(3)
    expect(result.skippedObjectReasonCounts.unknownType).toBe(3)
    // Counts are integers only — no raw type strings
    const dump = JSON.stringify(result.skippedObjectReasonCounts)
    expect(dump).not.toContain('desk')
    expect(dump).not.toContain('skeleton')
    expect(dump).not.toContain('lamp')
  })

  it('skippedObjectReasonCounts fields are all numbers', () => {
    const result = loadRoomSpec(withObjects([
      { type: 'lamp', position: [1, 0, 1] },
    ]))
    for (const val of Object.values(result.skippedObjectReasonCounts)) {
      expect(typeof val).toBe('number')
    }
  })

  it('loadRoomSpec is deterministic for the same input', () => {
    const spec = withObjects([
      { type: 'lamp', position: [1, 0, 1] },
      { type: 'pillar', position: 'bad' },
    ])
    expect(loadRoomSpec(spec)).toEqual(loadRoomSpec(spec))
  })
})

describe('loadRoomSpec parser-abuse envelope', () => {
  it('rejects input above the high 4096-entry ceiling without truncating', () => {
    const objects = Array.from(
      { length: ROOM_OBJECT_ENTRY_LIMIT + 1 },
      () => ({ type: 'rug', position: [0, 0, 0] }),
    )
    expect(() => loadRoomSpec(withObjects(objects))).toThrow()
  })
})
