const FNV_OFFSET_BASIS = 2166136261
const FNV_PRIME = 16777619

/** Deterministic FNV-1a hash of `input`, as an unsigned 32-bit integer. */
export function stableHash32(input: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

/** Deterministic hash of `input` mapped into `[0, 1)`. */
export function stableHash01(input: string): number {
  return stableHash32(input) / 4294967296
}
