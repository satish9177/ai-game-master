import { describe, expect, it } from 'vitest'
import { readDebugConfig, type DebugRawEnv } from './debugConfig'

function read(env: DebugRawEnv) {
  return readDebugConfig(env).roomMemoryDebugViewerEnabled
}

describe('readDebugConfig room memory debug viewer gate', () => {
  it('enables only when DEV is true and VITE_ROOM_MEMORY_DEBUG_VIEWER is exactly true', () => {
    expect(read({ DEV: true, VITE_ROOM_MEMORY_DEBUG_VIEWER: 'true' })).toBe(true)
  })

  it('stays disabled when DEV is false even with the opt-in flag', () => {
    expect(read({ DEV: false, VITE_ROOM_MEMORY_DEBUG_VIEWER: 'true' })).toBe(false)
  })

  it('stays disabled in dev without the exact opt-in flag', () => {
    expect(read({ DEV: true })).toBe(false)
    expect(read({ DEV: true, VITE_ROOM_MEMORY_DEBUG_VIEWER: 'false' })).toBe(false)
    expect(read({ DEV: true, VITE_ROOM_MEMORY_DEBUG_VIEWER: ' TRUE ' })).toBe(false)
  })
})

describe('readDebugConfig ruined kingdom showcase gate', () => {
  it.each([
    'village-square',
    'ruined-tavern',
    'crypt-entrance',
  ] as const)('accepts the closed %s fixture in development', (showcaseId) => {
    expect(readDebugConfig({ DEV: true }, '?showcase=' + showcaseId))
      .toMatchObject({ ruinedKingdomShowcaseId: showcaseId })
  })

  it('ignores the query outside development', () => {
    expect(readDebugConfig({ DEV: false }, '?showcase=village-square'))
      .not.toHaveProperty('ruinedKingdomShowcaseId')
  })

  it('rejects unknown and path-like fixture selectors', () => {
    expect(readDebugConfig({ DEV: true }, '?showcase=custom-room')).not.toHaveProperty('ruinedKingdomShowcaseId')
    expect(readDebugConfig({ DEV: true }, '?showcase=../village-square')).not.toHaveProperty('ruinedKingdomShowcaseId')
  })
})
