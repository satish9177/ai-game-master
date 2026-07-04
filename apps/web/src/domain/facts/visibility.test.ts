import { describe, expect, it } from 'vitest'
import { FACT_SCHEMA_VERSION } from './contracts'
import type { Fact } from './contracts'
import { filterVisibleFacts } from './visibility'
import type { NPCFactViewer } from './visibility'

function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    schemaVersion: FACT_SCHEMA_VERSION,
    factId: 'fact-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    kind: 'observed',
    source: 'game',
    authority: 'unverified',
    confidence: 'medium',
    visibility: { scope: 'public' },
    ...overrides,
  }
}

const matchingViewer: NPCFactViewer = {
  kind: 'npc',
  worldId: 'world-1',
  sessionId: 'session-1',
  npcId: 'npc-1',
  roomId: 'room-1',
}

const sameRoomDifferentNpcViewer: NPCFactViewer = {
  ...matchingViewer,
  npcId: 'npc-2',
}

const differentRoomViewer: NPCFactViewer = {
  ...matchingViewer,
  roomId: 'room-2',
}

const crossWorldViewer: NPCFactViewer = {
  ...matchingViewer,
  worldId: 'world-2',
}

const crossSessionViewer: NPCFactViewer = {
  ...matchingViewer,
  sessionId: 'session-2',
}

describe('filterVisibleFacts', () => {
  it('applies the visibility matrix for NPC viewers', () => {
    const facts = [
      fact({ factId: 'public', visibility: { scope: 'public' } }),
      fact({ factId: 'player-known', visibility: { scope: 'player-known' } }),
      fact({ factId: 'room-known', visibility: { scope: 'room-known', roomId: 'room-1' } }),
      fact({ factId: 'npc-known', visibility: { scope: 'npc-known', npcIds: ['npc-1'] } }),
      fact({ factId: 'hidden', visibility: { scope: 'hidden' } }),
    ]

    expect(filterVisibleFacts(facts, matchingViewer).map(({ factId }) => factId)).toEqual([
      'public',
      'room-known',
      'npc-known',
    ])
    expect(filterVisibleFacts(facts, sameRoomDifferentNpcViewer).map(({ factId }) => factId)).toEqual([
      'public',
      'room-known',
    ])
    expect(filterVisibleFacts(facts, differentRoomViewer).map(({ factId }) => factId)).toEqual(['public', 'npc-known'])
    expect(filterVisibleFacts(facts, crossWorldViewer)).toEqual([])
    expect(filterVisibleFacts(facts, crossSessionViewer)).toEqual([])
  })

  it('never leaks hidden facts', () => {
    const hiddenFacts = [
      fact({ factId: 'hidden-1', visibility: { scope: 'hidden' } }),
      fact({ factId: 'hidden-2', kind: 'hidden', authority: 'world-derived', visibility: { scope: 'hidden' } }),
    ]

    for (const viewer of [matchingViewer, sameRoomDifferentNpcViewer, differentRoomViewer]) {
      expect(filterVisibleFacts(hiddenFacts, viewer)).toEqual([])
    }
  })

  it('never leaks player-known facts to NPC viewers', () => {
    const playerKnownFacts = [
      fact({
        factId: 'claim',
        kind: 'player-claim',
        source: 'player',
        visibility: { scope: 'player-known' },
      }),
    ]

    for (const viewer of [matchingViewer, sameRoomDifferentNpcViewer, differentRoomViewer]) {
      expect(filterVisibleFacts(playerKnownFacts, viewer)).toEqual([])
    }
  })

  it('drops cross-world and cross-session facts even when visibility otherwise matches', () => {
    const facts = [
      fact({ factId: 'keep-public', visibility: { scope: 'public' } }),
      fact({ factId: 'drop-world-public', worldId: 'world-2', visibility: { scope: 'public' } }),
      fact({ factId: 'drop-session-public', sessionId: 'session-2', visibility: { scope: 'public' } }),
      fact({
        factId: 'drop-world-npc',
        worldId: 'world-2',
        visibility: { scope: 'npc-known', npcIds: ['npc-1'] },
      }),
      fact({
        factId: 'drop-session-room',
        sessionId: 'session-2',
        visibility: { scope: 'room-known', roomId: 'room-1' },
      }),
    ]

    expect(filterVisibleFacts(facts, matchingViewer).map(({ factId }) => factId)).toEqual(['keep-public'])
  })

  it('preserves input order for visible facts', () => {
    const facts = [
      fact({ factId: 'a', visibility: { scope: 'npc-known', npcIds: ['npc-1'] } }),
      fact({ factId: 'drop', visibility: { scope: 'hidden' } }),
      fact({ factId: 'b', visibility: { scope: 'public' } }),
      fact({ factId: 'c', visibility: { scope: 'room-known', roomId: 'room-1' } }),
    ]

    expect(filterVisibleFacts(facts, matchingViewer).map(({ factId }) => factId)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input array or fact objects', () => {
    const facts = [
      fact({ factId: 'a', visibility: { scope: 'public' } }),
      fact({ factId: 'b', visibility: { scope: 'hidden' } }),
    ]
    const snapshot = structuredClone(facts)

    const filtered = filterVisibleFacts(facts, matchingViewer)

    expect(facts).toEqual(snapshot)
    expect(filtered).toEqual([facts[0]])
    expect(filtered).not.toBe(facts)
  })

  it('is deterministic for the same input and viewer', () => {
    const facts = [
      fact({ factId: 'a', visibility: { scope: 'public' } }),
      fact({ factId: 'b', visibility: { scope: 'npc-known', npcIds: ['npc-2'] } }),
      fact({ factId: 'c', visibility: { scope: 'room-known', roomId: 'room-1' } }),
    ]

    expect(filterVisibleFacts(facts, matchingViewer)).toEqual(filterVisibleFacts(facts, matchingViewer))
  })
})

