import { describe, expect, it } from 'vitest'
import { ruinedRoom } from './ruinedRoom'
import { loadRoomSpec } from '../loadRoomSpec'
import { validateRoom } from '../validateRoom'

/**
 * The asset-pack showcase room must load cleanly (no skipped objects — every
 * type is in the vocabulary) and pass the semantic validator with no issues,
 * proving the new schema, builders' data contract, and validator updates line
 * up end-to-end.
 */
describe('ruinedRoom example', () => {
  it('loads with zero skipped objects and no warnings', () => {
    const loaded = loadRoomSpec(structuredClone(ruinedRoom))
    expect(loaded.skipped).toEqual([])
    expect(loaded.warnings).toEqual([])
  })

  it('passes semantic validation with no issues', () => {
    const result = validateRoom(loadRoomSpec(structuredClone(ruinedRoom)))
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('exercises the full post-apoc vocabulary', () => {
    const loaded = loadRoomSpec(structuredClone(ruinedRoom))
    const types = new Set(loaded.objects.map((o) => o.type))
    for (const type of ['crate', 'barrel', 'debris', 'barricade', 'zombie'] as const) {
      expect(types.has(type)).toBe(true)
    }
  })
})
