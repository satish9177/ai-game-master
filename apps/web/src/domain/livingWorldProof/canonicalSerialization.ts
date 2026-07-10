/**
 * Canonical serialization and content hashing for the Compaction
 * Preservation Test v0 (ADR-0007 D8, spec compaction-preservation-test.md
 * §1.1/§2.7). A proof-local stand-in only: it fixes *a* deterministic
 * byte form so mint hashes are meaningful inside this rig, not a
 * production canonical-serialization or cryptographic-hash choice.
 * ADR-0007 open Q1 owns the real versioned format/algorithm; this hash is
 * not collision-resistant and must never be treated as one outside this
 * proof. No I/O, no Date.now/Math.random/crypto -- pure and total.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

function sortKeysDeep(value: unknown): Json {
  if (value === null || typeof value !== 'object') {
    // number/string/boolean/null pass through; undefined/function have no
    // place in these record types and would fail JSON.stringify anyway.
    return value as Json
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry))
  }
  const sorted: { [key: string]: Json } = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
  }
  return sorted
}

/**
 * Deterministic key-sorted JSON serialization: object key order never
 * affects the output, so two structurally-equal values always produce
 * byte-identical bytes regardless of construction order.
 */
export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const FNV_64_MASK = 0xffffffffffffffffn

/**
 * Pure FNV-1a-64 over UTF-8 bytes of a string, versioned and prefixed so a
 * future format change never collides with or silently reinterprets a
 * hash minted under this version (ADR-0007 D8 migration constraint).
 */
export function mintHash(bytes: string): string {
  const encoded = new TextEncoder().encode(bytes)
  let hash = FNV_OFFSET_BASIS
  for (const byte of encoded) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & FNV_64_MASK
  }
  return `fnv1a64-v1:${hash.toString(16).padStart(16, '0')}`
}

/** Convenience: canonical-serialize then hash in one step (mint-time use). */
export function canonicalHash(value: unknown): string {
  return mintHash(canonicalSerialize(value))
}
