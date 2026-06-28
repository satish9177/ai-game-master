import { describe, it, expect } from 'vitest'
import {
  initialUsageState,
  recordAttempt,
  resetUsage,
  canAttemptOptional,
  evaluate,
  type UsageGuardConfig,
} from './usageGuard'

describe('initialUsageState', () => {
  it('returns count 0', () => {
    expect(initialUsageState().count).toBe(0)
  })

  it('returns a fresh object on each call', () => {
    expect(initialUsageState()).not.toBe(initialUsageState())
  })
})

describe('recordAttempt', () => {
  it('increments count by 1', () => {
    expect(recordAttempt({ count: 0 }).count).toBe(1)
    expect(recordAttempt({ count: 5 }).count).toBe(6)
  })

  it('does not mutate the input state', () => {
    const state = { count: 3 }
    const next = recordAttempt(state)
    expect(state.count).toBe(3)
    expect(next).not.toBe(state)
  })

  it('returns a fresh object each call', () => {
    const state = { count: 0 }
    expect(recordAttempt(state)).not.toBe(recordAttempt(state))
  })
})

describe('resetUsage', () => {
  it('returns count 0', () => {
    expect(resetUsage().count).toBe(0)
  })

  it('returns a fresh object on each call', () => {
    expect(resetUsage()).not.toBe(resetUsage())
  })
})

describe('canAttemptOptional', () => {
  const cap10: UsageGuardConfig = { cap: 10, enabled: true }
  const disabled: UsageGuardConfig = { cap: 10, enabled: false }

  describe('disabled guard', () => {
    it('allows count 0', () => {
      expect(canAttemptOptional({ count: 0 }, disabled)).toBe(true)
    })

    it('allows count above cap', () => {
      expect(canAttemptOptional({ count: 100 }, disabled)).toBe(true)
    })
  })

  describe('enabled guard', () => {
    it('allows count 0 below cap', () => {
      expect(canAttemptOptional({ count: 0 }, cap10)).toBe(true)
    })

    it('allows cap - 2', () => {
      expect(canAttemptOptional({ count: 8 }, cap10)).toBe(true)
    })

    it('allows cap - 1', () => {
      expect(canAttemptOptional({ count: 9 }, cap10)).toBe(true)
    })

    it('rejects count == cap', () => {
      expect(canAttemptOptional({ count: 10 }, cap10)).toBe(false)
    })

    it('rejects count > cap', () => {
      expect(canAttemptOptional({ count: 11 }, cap10)).toBe(false)
    })
  })

  describe('cap 1 behavior', () => {
    const cap1: UsageGuardConfig = { cap: 1, enabled: true }

    it('allows count 0', () => {
      expect(canAttemptOptional({ count: 0 }, cap1)).toBe(true)
    })

    it('rejects count 1', () => {
      expect(canAttemptOptional({ count: 1 }, cap1)).toBe(false)
    })
  })

  describe('purity', () => {
    it('does not mutate state or config inputs', () => {
      const state = { count: 9 }
      const config = { cap: 10, enabled: true }
      canAttemptOptional(state, config)
      expect(state.count).toBe(9)
      expect(config.cap).toBe(10)
      expect(config.enabled).toBe(true)
    })
  })
})

describe('evaluate', () => {
  const cap10: UsageGuardConfig = { cap: 10, enabled: true }
  const disabled: UsageGuardConfig = { cap: 10, enabled: false }

  describe('inert when disabled', () => {
    it('returns inert for any count when enabled is false', () => {
      expect(evaluate({ count: 0 }, disabled)).toBe('inert')
      expect(evaluate({ count: 9 }, disabled)).toBe('inert')
      expect(evaluate({ count: 10 }, disabled)).toBe('inert')
      expect(evaluate({ count: 100 }, disabled)).toBe('inert')
    })
  })

  describe('ok below cap-1', () => {
    it('returns ok from count 0 to cap-2 (0..8 for cap=10)', () => {
      expect(evaluate({ count: 0 }, cap10)).toBe('ok')
      expect(evaluate({ count: 1 }, cap10)).toBe('ok')
      expect(evaluate({ count: 7 }, cap10)).toBe('ok')
      expect(evaluate({ count: 8 }, cap10)).toBe('ok') // cap-2
    })
  })

  describe('approaching at cap-1', () => {
    it('returns approaching at count = cap-1 (9 for cap=10)', () => {
      expect(evaluate({ count: 9 }, cap10)).toBe('approaching')
    })
  })

  describe('at-cap at cap and above', () => {
    it('returns at-cap at count = cap', () => {
      expect(evaluate({ count: 10 }, cap10)).toBe('at-cap')
    })

    it('returns at-cap beyond cap', () => {
      expect(evaluate({ count: 11 }, cap10)).toBe('at-cap')
      expect(evaluate({ count: 100 }, cap10)).toBe('at-cap')
    })
  })

  describe('respects different cap values', () => {
    it('uses cap=5 thresholds correctly', () => {
      const cap5: UsageGuardConfig = { cap: 5, enabled: true }
      expect(evaluate({ count: 3 }, cap5)).toBe('ok') // cap-2
      expect(evaluate({ count: 4 }, cap5)).toBe('approaching') // cap-1
      expect(evaluate({ count: 5 }, cap5)).toBe('at-cap') // cap
      expect(evaluate({ count: 6 }, cap5)).toBe('at-cap')
    })

    it('uses cap=1 thresholds correctly', () => {
      const cap1: UsageGuardConfig = { cap: 1, enabled: true }
      expect(evaluate({ count: 0 }, cap1)).toBe('approaching') // cap-1=0
      expect(evaluate({ count: 1 }, cap1)).toBe('at-cap') // cap
    })

    it('uses cap=2 thresholds correctly', () => {
      const cap2: UsageGuardConfig = { cap: 2, enabled: true }
      expect(evaluate({ count: 0 }, cap2)).toBe('ok') // cap-2=0
      expect(evaluate({ count: 1 }, cap2)).toBe('approaching') // cap-1=1
      expect(evaluate({ count: 2 }, cap2)).toBe('at-cap') // cap
    })
  })

  describe('purity', () => {
    it('does not mutate state or config inputs', () => {
      const state = { count: 9 }
      const config = { cap: 10, enabled: true }
      evaluate(state, config)
      expect(state.count).toBe(9)
      expect(config.cap).toBe(10)
      expect(config.enabled).toBe(true)
    })
  })
})
