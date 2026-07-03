import { describe, expect, it } from 'vitest'
import { createMemoryFtsQueryFromTokens } from './ftsQuery'

describe('createMemoryFtsQueryFromTokens', () => {
  it('quotes safe tokens and OR-joins them deterministically', () => {
    expect(createMemoryFtsQueryFromTokens(['bridge', 'Gate42'])?.expression).toBe(
      '"bridge" OR "Gate42"',
    )
  })

  it('drops empty and unsafe tokens without mutating the input', () => {
    const tokens = ['bridge', '', 'bad-token!', '"quote"', 'AND']
    expect(createMemoryFtsQueryFromTokens(tokens)?.expression).toBe('"bridge" OR "AND"')
    expect(tokens).toEqual(['bridge', '', 'bad-token!', '"quote"', 'AND'])
  })

  it('returns null when no safe tokens remain', () => {
    expect(createMemoryFtsQueryFromTokens(['', 'bad-token!', '*', ':'])).toBeNull()
  })
})
