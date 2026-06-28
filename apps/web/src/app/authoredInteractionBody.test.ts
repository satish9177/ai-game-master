import { describe, expect, it } from 'vitest'
import type { WorldState } from '../domain/world/worldState'
import { authoredPostUseInteractionBody } from './authoredInteractionBody'

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
    currentRoomId: 'throne-room',
    player: { health: { current: 10, max: 10 }, status: [] },
    inventory: [],
    roomStates: {
      'throne-room': {
        visited: true,
        flags: { 'interaction:offering-coffer': true },
      },
    },
    revision: 1,
    updatedAt: '2026-06-28T00:00:00.000Z',
    ...overrides,
  }
}

describe('authoredPostUseInteractionBody', () => {
  it('returns the authored post-use body for the claimed offering coffer', () => {
    expect(authoredPostUseInteractionBody({
      objectId: 'offering-coffer',
      state: makeState(),
    })).toBe('The coffer lies open and empty - the coin is gone.')
  })

  it('returns undefined when the coffer flag is unset', () => {
    expect(authoredPostUseInteractionBody({
      objectId: 'offering-coffer',
      state: makeState({ roomStates: { 'throne-room': { visited: true } } }),
    })).toBeUndefined()
  })

  it('returns undefined for unknown object ids', () => {
    expect(authoredPostUseInteractionBody({
      objectId: 'some-other-object',
      state: makeState(),
    })).toBeUndefined()
  })

  it('returns undefined when room state is missing', () => {
    expect(authoredPostUseInteractionBody({
      objectId: 'offering-coffer',
      state: makeState({ roomStates: {} }),
    })).toBeUndefined()
  })

  it('returns undefined for generated or unrelated rooms', () => {
    expect(authoredPostUseInteractionBody({
      objectId: 'offering-coffer',
      state: makeState({
        currentRoomId: 'generated-room',
        roomStates: {
          'throne-room': {
            visited: true,
            flags: { 'interaction:offering-coffer': true },
          },
        },
      }),
    })).toBeUndefined()
  })
})
