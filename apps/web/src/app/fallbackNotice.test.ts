import { describe, it, expect } from 'vitest'
import { FALLBACK_NOTICE, shouldShowFallbackNotice } from './fallbackNotice'

describe('shouldShowFallbackNotice', () => {
  it('shows the notice for a repaired room', () => {
    expect(shouldShowFallbackNotice('repaired')).toBe(true)
  })

  it('shows the notice for a fallback room', () => {
    expect(shouldShowFallbackNotice('fallback')).toBe(true)
  })

  it('hides the notice for a cleanly generated room', () => {
    expect(shouldShowFallbackNotice('generated')).toBe(false)
  })

  it('hides the notice when provenance is unset (e.g. a static/preloaded source)', () => {
    expect(shouldShowFallbackNotice(undefined)).toBe(false)
  })
})

describe('FALLBACK_NOTICE copy', () => {
  it('is the exact approved static string', () => {
    expect(FALLBACK_NOTICE).toBe(
      "We couldn't build that room exactly, so here's a safe one. Try another prompt.",
    )
  })

  it('mentions neither a prompt nor any diagnostic detail', () => {
    const lower = FALLBACK_NOTICE.toLowerCase()
    expect(lower).not.toContain('prompt:')
    expect(lower).not.toContain('error')
    expect(lower).not.toContain('json')
    expect(lower).not.toContain('code')
  })
})
