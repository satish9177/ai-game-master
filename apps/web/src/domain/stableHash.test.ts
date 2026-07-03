import { describe, expect, it } from 'vitest'
import { stableHash01, stableHash32 } from './stableHash'

describe('stableHash32', () => {
  it('is deterministic for the same input', () => {
    expect(stableHash32('room-1:npc-1')).toBe(stableHash32('room-1:npc-1'))
  })

  it('usually diverges for different inputs', () => {
    const inputs = ['room-1:npc-1', 'room-1:npc-2', 'room-2:npc-1', 'a', 'b', 'throne-1']
    const hashes = new Set(inputs.map(stableHash32))
    expect(hashes.size).toBe(inputs.length)
  })

  it('returns an unsigned 32-bit integer', () => {
    const hash = stableHash32('some-arbitrary-input')
    expect(Number.isInteger(hash)).toBe(true)
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(hash).toBeLessThanOrEqual(0xffffffff)
  })

  it('handles the empty string', () => {
    expect(stableHash32('')).toBe(FNV_OFFSET_BASIS_UNSIGNED)
  })
})

describe('stableHash01', () => {
  it('is deterministic for the same input', () => {
    expect(stableHash01('room-1:npc-1')).toBe(stableHash01('room-1:npc-1'))
  })

  it('returns a value in [0, 1) for a range of inputs', () => {
    const inputs = ['', 'a', 'room-1:npc-1', 'room-2:npc-99', 'x'.repeat(200)]
    for (const input of inputs) {
      const value = stableHash01(input)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('usually diverges for different inputs', () => {
    const inputs = ['room-1:npc-1', 'room-1:npc-2', 'room-2:npc-1']
    const values = new Set(inputs.map(stableHash01))
    expect(values.size).toBe(inputs.length)
  })
})

const FNV_OFFSET_BASIS_UNSIGNED = 2166136261
