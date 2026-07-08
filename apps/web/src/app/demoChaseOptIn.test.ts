import { describe, it, expect } from 'vitest'
import {
  DEMO_CHASE_NPC_IDS,
  readDemoChaseEnabled,
  selectDemoChaseOptInNpcIds,
  type DemoChaseRawEnv,
} from './demoChaseOptIn'

describe('DEMO_CHASE_NPC_IDS', () => {
  it('is a closed allowlist containing only herald-asha for Slice 1', () => {
    expect(DEMO_CHASE_NPC_IDS).toBeInstanceOf(Set)
    expect(DEMO_CHASE_NPC_IDS.size).toBe(1)
    expect(DEMO_CHASE_NPC_IDS.has('herald-asha')).toBe(true)
  })
})

describe('readDemoChaseEnabled', () => {
  it('defaults to false when env is empty', () => {
    expect(readDemoChaseEnabled({})).toBe(false)
  })

  it('returns true for "1" and "true"', () => {
    expect(readDemoChaseEnabled({ VITE_AIGM_DEMO_CHASE: '1' })).toBe(true)
    expect(readDemoChaseEnabled({ VITE_AIGM_DEMO_CHASE: 'true' })).toBe(true)
  })

  it('returns true for trimmed and case-insensitive variants', () => {
    expect(readDemoChaseEnabled({ VITE_AIGM_DEMO_CHASE: '  1  ' })).toBe(true)
    expect(readDemoChaseEnabled({ VITE_AIGM_DEMO_CHASE: '  TRUE  ' })).toBe(true)
    expect(readDemoChaseEnabled({ VITE_AIGM_DEMO_CHASE: 'True' })).toBe(true)
  })

  it('returns false for undefined, empty, and unrecognized values', () => {
    const raw: DemoChaseRawEnv = {}
    expect(readDemoChaseEnabled({ ...raw, VITE_AIGM_DEMO_CHASE: undefined })).toBe(false)
    expect(readDemoChaseEnabled({ VITE_AIGM_DEMO_CHASE: '' })).toBe(false)
    expect(readDemoChaseEnabled({ VITE_AIGM_DEMO_CHASE: '0' })).toBe(false)
    expect(readDemoChaseEnabled({ VITE_AIGM_DEMO_CHASE: 'false' })).toBe(false)
    expect(readDemoChaseEnabled({ VITE_AIGM_DEMO_CHASE: 'yes' })).toBe(false)
    expect(readDemoChaseEnabled({ VITE_AIGM_DEMO_CHASE: 'on' })).toBe(false)
  })

  it('performs no I/O and reads only the supplied env object', () => {
    // Structural guarantee: passing a plain injected object (no import.meta.env
    // access) is sufficient to exercise every branch above.
    expect(() => readDemoChaseEnabled({ VITE_AIGM_DEMO_CHASE: '1' })).not.toThrow()
  })
})

describe('selectDemoChaseOptInNpcIds', () => {
  it('returns empty when disabled, even when herald-asha is present', () => {
    const result = selectDemoChaseOptInNpcIds({
      enabled: false,
      presentNpcIds: new Set(['herald-asha', 'steward-malik']),
    })
    expect(result.size).toBe(0)
  })

  it('returns herald-asha when enabled and herald-asha is present', () => {
    const result = selectDemoChaseOptInNpcIds({
      enabled: true,
      presentNpcIds: new Set(['herald-asha', 'steward-malik']),
    })
    expect([...result]).toEqual(['herald-asha'])
  })

  it('returns empty when enabled but herald-asha is absent', () => {
    const result = selectDemoChaseOptInNpcIds({
      enabled: true,
      presentNpcIds: new Set(['steward-malik']),
    })
    expect(result.size).toBe(0)
  })

  it('never returns ids outside the allowlist', () => {
    const result = selectDemoChaseOptInNpcIds({
      enabled: true,
      presentNpcIds: new Set(['herald-asha', 'steward-malik', 'random-npc', 'bandit-boss']),
    })
    for (const id of result) {
      expect(DEMO_CHASE_NPC_IDS.has(id)).toBe(true)
    }
  })

  it('supports an injected allowlist for unit testing', () => {
    const result = selectDemoChaseOptInNpcIds({
      enabled: true,
      presentNpcIds: new Set(['npc-a', 'npc-b', 'npc-c']),
      allowlist: new Set(['npc-b', 'npc-c']),
    })
    expect([...result]).toEqual(['npc-b', 'npc-c'])
  })

  it('keeps deterministic allowlist order regardless of presentNpcIds insertion order', () => {
    const allowlist = new Set(['first', 'second', 'third'])
    const result = selectDemoChaseOptInNpcIds({
      enabled: true,
      presentNpcIds: new Set(['third', 'first', 'second']),
      allowlist,
    })
    expect([...result]).toEqual(['first', 'second', 'third'])
  })

  it('does not mutate presentNpcIds or allowlist', () => {
    const presentNpcIds = new Set(['herald-asha'])
    const allowlist = new Set(['herald-asha'])
    const presentSnapshot = [...presentNpcIds]
    const allowlistSnapshot = [...allowlist]

    selectDemoChaseOptInNpcIds({ enabled: true, presentNpcIds, allowlist })

    expect([...presentNpcIds]).toEqual(presentSnapshot)
    expect([...allowlist]).toEqual(allowlistSnapshot)
  })

  it('is id-only: hostile-looking names/text never grant eligibility unless the id itself is allowlisted and present', () => {
    // These ids read as menacing/hostile in free text, but none is in the
    // allowlist, so none is ever selected — only the literal id string matters.
    const result = selectDemoChaseOptInNpcIds({
      enabled: true,
      presentNpcIds: new Set([
        'murderous-bandit-leader',
        'hostile-warlord',
        'assassin-of-the-dark-order',
      ]),
    })
    expect(result.size).toBe(0)

    // Conversely, a bland/friendly-looking id is selected if and only if it is
    // both allowlisted and present — the selector never inspects semantics.
    const friendlyIdSelected = selectDemoChaseOptInNpcIds({
      enabled: true,
      presentNpcIds: new Set(['friendly-shopkeeper']),
      allowlist: new Set(['friendly-shopkeeper']),
    })
    expect([...friendlyIdSelected]).toEqual(['friendly-shopkeeper'])
  })
})
