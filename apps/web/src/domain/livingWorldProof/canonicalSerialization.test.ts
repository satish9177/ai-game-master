import { describe, expect, it } from 'vitest'
import { canonicalHash, canonicalSerialize, mintHash } from './canonicalSerialization'

describe('canonicalSerialize', () => {
  it('is independent of object key construction order', () => {
    const a = { z: 1, a: 2, m: { y: 1, b: 2 } }
    const b = { a: 2, m: { b: 2, y: 1 }, z: 1 }
    expect(canonicalSerialize(a)).toBe(canonicalSerialize(b))
  })

  it('sorts keys inside array elements too', () => {
    const value = [{ b: 1, a: 2 }, { d: 3, c: 4 }]
    expect(canonicalSerialize(value)).toBe('[{"a":2,"b":1},{"c":4,"d":3}]')
  })

  it('is sensitive to actual value differences', () => {
    expect(canonicalSerialize({ a: 1 })).not.toBe(canonicalSerialize({ a: 2 }))
  })

  it('does not mutate its input', () => {
    const value = { z: 1, a: 2 }
    const snapshot = structuredClone(value)
    canonicalSerialize(value)
    expect(value).toEqual(snapshot)
  })
})

describe('mintHash', () => {
  it('is deterministic for the same bytes', () => {
    expect(mintHash('hello')).toBe(mintHash('hello'))
  })

  it('differs for different bytes', () => {
    expect(mintHash('hello')).not.toBe(mintHash('hellp'))
  })

  it('is prefixed with the versioned algorithm tag', () => {
    expect(mintHash('anything')).toMatch(/^fnv1a64-v1:[0-9a-f]{16}$/)
  })
})

describe('canonicalHash', () => {
  it('is stable across key-order-varied but structurally equal inputs', () => {
    expect(canonicalHash({ z: 1, a: 2 })).toBe(canonicalHash({ a: 2, z: 1 }))
  })

  it('changes when the underlying value changes', () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }))
  })
})
