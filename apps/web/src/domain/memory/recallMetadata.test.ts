import { describe, expect, it } from 'vitest'

import {
  EntitySnapshotsSchema,
  MAX_DEDUPE_KEY_CHARS,
  MAX_DISPLAY_NAME_CHARS,
  MAX_ENTITY_SNAPSHOTS,
  MAX_IMPORTANCE,
  MemoryDedupeKeySchema,
  MemoryImportanceSchema,
  validateRecallMetadata,
} from './recallMetadata'

describe('recall metadata schemas', () => {
  it('importance accepts integers 0..MAX and rejects out-of-range / non-integer', () => {
    expect(MemoryImportanceSchema.safeParse(0).success).toBe(true)
    expect(MemoryImportanceSchema.safeParse(MAX_IMPORTANCE).success).toBe(true)
    expect(MemoryImportanceSchema.safeParse(-1).success).toBe(false)
    expect(MemoryImportanceSchema.safeParse(MAX_IMPORTANCE + 1).success).toBe(false)
    expect(MemoryImportanceSchema.safeParse(2.5).success).toBe(false)
  })

  it('dedupeKey is non-empty and bounded', () => {
    expect(MemoryDedupeKeySchema.safeParse('w|s|room-state-changed|e1').success).toBe(true)
    expect(MemoryDedupeKeySchema.safeParse('').success).toBe(false)
    expect(MemoryDedupeKeySchema.safeParse('a'.repeat(MAX_DEDUPE_KEY_CHARS)).success).toBe(true)
    expect(MemoryDedupeKeySchema.safeParse('a'.repeat(MAX_DEDUPE_KEY_CHARS + 1)).success).toBe(false)
  })

  it('entitySnapshots requires bounded {id, displayName} and rejects extras/missing', () => {
    expect(
      EntitySnapshotsSchema.safeParse({ room: { id: 'room_library_3a', displayName: 'Old Library' } })
        .success,
    ).toBe(true)
    expect(
      EntitySnapshotsSchema.safeParse({
        room: { id: 'r', displayName: 'a'.repeat(MAX_DISPLAY_NAME_CHARS + 1) },
      }).success,
    ).toBe(false)
    expect(EntitySnapshotsSchema.safeParse({ room: { id: 'r', displayName: 'X', extra: 'y' } }).success).toBe(false)
    expect(EntitySnapshotsSchema.safeParse({ room: { id: 'r' } }).success).toBe(false)
  })

  it('entitySnapshots caps the number of entries', () => {
    const tooMany: Record<string, { id: string; displayName: string }> = {}
    for (let i = 0; i <= MAX_ENTITY_SNAPSHOTS; i++) tooMany[`e${i}`] = { id: `id${i}`, displayName: `N${i}` }
    expect(EntitySnapshotsSchema.safeParse(tooMany).success).toBe(false)
  })
})

describe('validateRecallMetadata', () => {
  it('accepts absent fields (all optional)', () => {
    expect(validateRecallMetadata({})).toEqual({ ok: true, value: {} })
  })

  it('passes through valid fields unchanged', () => {
    const result = validateRecallMetadata({
      importance: 4,
      dedupeKey: 'w|s|t|e',
      entitySnapshots: { room: { id: 'r', displayName: 'Old Library' } },
    })
    expect(result).toEqual({
      ok: true,
      value: {
        importance: 4,
        dedupeKey: 'w|s|t|e',
        entitySnapshots: { room: { id: 'r', displayName: 'Old Library' } },
      },
    })
  })

  it('returns the matching reject reason per field', () => {
    expect(validateRecallMetadata({ importance: 9 })).toEqual({ ok: false, reason: 'invalid-importance' })
    expect(validateRecallMetadata({ dedupeKey: '' })).toEqual({ ok: false, reason: 'invalid-dedupe-key' })
    expect(validateRecallMetadata({ entitySnapshots: { room: { id: 'r' } } } as never)).toEqual({
      ok: false,
      reason: 'invalid-entity-snapshots',
    })
  })

  it('does not mutate its input', () => {
    const input = { importance: 3, dedupeKey: 'k', entitySnapshots: { room: { id: 'r', displayName: 'N' } } }
    const snapshot = structuredClone(input)
    validateRecallMetadata(input)
    expect(input).toEqual(snapshot)
  })
})
