import { describe, it, expect } from 'vitest'
import { createRng, mulberry32, xmur3 } from './prng'

describe('prng', () => {
  it('xmur3 is deterministic for the same string', () => {
    expect(xmur3('hello')()).toBe(xmur3('hello')())
    expect(Number.isInteger(xmur3('hello')())).toBe(true)
  })

  it('xmur3 differs for different strings', () => {
    expect(xmur3('hello')()).not.toBe(xmur3('world')())
  })

  it('mulberry32 is deterministic for a given numeric seed', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('createRng with the same seed yields the same sequence', () => {
    const r1 = createRng('seed-1')
    const r2 = createRng('seed-1')
    const s1 = Array.from({ length: 16 }, () => r1.next())
    const s2 = Array.from({ length: 16 }, () => r2.next())
    expect(s1).toEqual(s2)
  })

  it('createRng with different seeds diverges', () => {
    const s1 = Array.from({ length: 16 }, createRng('seed-1').next)
    const s2 = Array.from({ length: 16 }, createRng('seed-2').next)
    expect(s1).not.toEqual(s2)
  })

  it('next() stays within [0, 1)', () => {
    const rng = createRng('range-check')
    for (let i = 0; i < 1000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('int() returns integers in the half-open range', () => {
    const rng = createRng('int-check')
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(2, 5)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(2)
      expect(v).toBeLessThan(5)
    }
  })

  it('pick() only ever returns members of the array', () => {
    const rng = createRng('pick-check')
    const items = ['a', 'b', 'c'] as const
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(rng.pick(items))
    }
  })
})
