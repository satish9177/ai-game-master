/**
 * Typed SQLite FTS MATCH value for the headless memory search adapter.
 *
 * Slice 1 intentionally does not accept raw player/query text. Callers must
 * provide already-normalized safe tokens; this helper quotes and OR-joins only
 * `[A-Za-z0-9]+` tokens so FTS syntax never comes from user text.
 */

const memoryFtsQueryBrand: unique symbol = Symbol('MemoryFtsQuery')

export type MemoryFtsQuery = {
  readonly expression: string
  readonly [memoryFtsQueryBrand]: true
}

const SAFE_TOKEN = /^[A-Za-z0-9]+$/

export function createMemoryFtsQueryFromTokens(tokens: readonly string[]): MemoryFtsQuery | null {
  const safeTokens = tokens.filter((token) => SAFE_TOKEN.test(token))
  if (safeTokens.length === 0) return null
  return {
    expression: safeTokens.map((token) => `"${token}"`).join(' OR '),
    [memoryFtsQueryBrand]: true,
  }
}
