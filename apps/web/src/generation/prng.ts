/**
 * Tiny, dependency-free seeded PRNG for deterministic generation.
 *
 * Generation must be reproducible: the same prompt has to yield byte-identical
 * output on every run — no `Date.now`, no `Math.random`, no IO. Two well-known
 * routines give us that. `xmur3` hashes a string seed into a 32-bit state, and
 * `mulberry32` turns that state into a fast stream of floats in [0, 1).
 *
 * Pure functions only: this module imports nothing and performs no side effects.
 */

/**
 * xmur3 string-hash seeder. Returns a generator that yields successive 32-bit
 * unsigned integers derived from `str`; use the first value to seed mulberry32.
 */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

/**
 * mulberry32 PRNG. Given a 32-bit seed, returns a function producing a
 * deterministic sequence of floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A small deterministic helper surface over a single mulberry32 stream. */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number
  /** Float in [min, max). */
  range(min: number, max: number): number
  /** Integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number
  /** Deterministically pick one element of a non-empty array. */
  pick<T>(items: readonly T[]): T
  /** True with probability `p` (default 0.5). */
  bool(p?: number): boolean
}

/**
 * Build an {@link Rng} seeded by an arbitrary string (e.g. a prompt). The seed
 * is hashed with xmur3, so the entire downstream sequence is a pure function of
 * `seed`. All helpers draw from one shared stream, advancing it in call order.
 */
export function createRng(seed: string): Rng {
  const next = mulberry32(xmur3(seed)())
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min)),
    pick<T>(items: readonly T[]): T {
      // The index is provably in range; the assertion satisfies
      // noUncheckedIndexedAccess without a runtime guard.
      return items[Math.floor(next() * items.length)]!
    },
    bool: (p = 0.5) => next() < p,
  }
}
