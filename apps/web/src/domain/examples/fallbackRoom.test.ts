import { describe, it, expect } from 'vitest'
import { fallbackRoom } from './fallbackRoom'
import { loadRoomSpec } from '../loadRoomSpec'
import { validateRoom } from '../validateRoom'

describe('fallbackRoom', () => {
  it('loads through loadRoomSpec with no skipped objects', () => {
    const room = loadRoomSpec(fallbackRoom)
    expect(room.id).toBe('fallback-room')
    expect(room.skipped).toEqual([])
    expect(room.warnings).toEqual([])
    expect(room.objects).toHaveLength(fallbackRoom.objects.length)
  })

  it('has zero fatal semantic issues', () => {
    const result = validateRoom(loadRoomSpec(fallbackRoom))
    const fatal = result.issues.filter((issue) => issue.severity === 'fatal')
    expect(fatal).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('is authored pristine — zero semantic warnings too', () => {
    // The fallback room is hand-authored, so it should be clean of warnings as
    // well; this guards against accidental drift if it (or LIMITS) is edited.
    const result = validateRoom(loadRoomSpec(fallbackRoom))
    expect(result.issues).toEqual([])
  })

  it('carries no interaction / prompt / story text (data-only fallback)', () => {
    expect(JSON.stringify(fallbackRoom)).not.toContain('interaction')
  })
})
