/** Static knobs: cap is the maximum real attempts; enabled is false for the fake provider. */
export type UsageGuardConfig = {
  cap: number
  enabled: boolean
}

/** Mutable-by-projection counter: real attempts in this App lifetime. */
export type UsageGuardState = {
  count: number
}

/**
 * Derived display verdict. `inert` = fake provider selected (no guard active);
 * `ok` = below warning threshold; `approaching` = one below cap;
 * `at-cap` = cap reached, confirm-to-continue required.
 */
export type UsageGuardStatus = 'inert' | 'ok' | 'approaching' | 'at-cap'

export function initialUsageState(): UsageGuardState {
  return { count: 0 }
}

export function recordAttempt(state: UsageGuardState): UsageGuardState {
  return { count: state.count + 1 }
}

export function resetUsage(): UsageGuardState {
  return { count: 0 }
}

/**
 * Derive the display verdict from the current count and config.
 * Pure — no I/O, no mutation, no React/provider imports.
 *
 * Thresholds (cap = N):
 *   count  0 … N-2  → ok
 *   count  N-1      → approaching
 *   count  >= N     → at-cap
 */
export function evaluate(state: UsageGuardState, config: UsageGuardConfig): UsageGuardStatus {
  if (!config.enabled) return 'inert'
  if (state.count >= config.cap) return 'at-cap'
  if (state.count === config.cap - 1) return 'approaching'
  return 'ok'
}
