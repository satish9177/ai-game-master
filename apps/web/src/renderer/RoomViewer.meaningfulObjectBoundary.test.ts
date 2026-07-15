import { describe, expect, it } from 'vitest'
import roomViewerSource from './RoomViewer.tsx?raw'
import engineSource from './engine/Engine.ts?raw'

describe('meaningful object renderer boundary', () => {
  it('receives derived choices and emits intent without transition authority', () => {
    expect(roomViewerSource).toContain('getMeaningfulObjectView')
    expect(roomViewerSource).toContain('resolveMeaningfulObject')
    for (const forbidden of [
      'meaningfulObjectStateFlagKey',
      'deriveMeaningfulObjectState',
      'derivedTransition',
      'validatedSearchItem',
      'WorldCommandSchema',
      'applyEvent',
    ]) {
      expect(roomViewerSource).not.toContain(forbidden)
      expect(engineSource).not.toContain(forbidden)
    }
  })

  it('does not introduce clue, objective, journal, provider, or prompt authority', () => {
    const meaningfulBlock = roomViewerSource.slice(
      roomViewerSource.indexOf('getMeaningfulObjectView'),
      roomViewerSource.indexOf('const resetNPCDialogue'),
    )
    expect(meaningfulBlock).not.toMatch(/reveal-clue|progress-objective|Journal|Provider|prompt generator/i)
  })
})
