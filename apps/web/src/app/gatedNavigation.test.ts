import { describe, expect, it, vi } from 'vitest'
import type { WorldState } from '../domain/world/worldState'
import type { WorldStateResult } from '../world-session/WorldSession'
import type { NavigationResult } from './NavigationService'
import { navigateWithExitGate } from './gatedNavigation'

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
    currentRoomId: 'throne-room',
    player: { health: { current: 10, max: 10 }, status: [] },
    inventory: [],
    roomStates: { 'throne-room': { visited: true } },
    revision: 1,
    updatedAt: '2026-06-28T00:00:00.000Z',
    ...overrides,
  }
}

function stateResult(state: WorldState): WorldStateResult {
  return { ok: true, state }
}

function notFoundResult(): WorldStateResult {
  return { ok: false, error: { code: 'not-found', message: 'Session not found.' } }
}

const delegatedResult: NavigationResult = { status: 'rejected', reason: 'unknown-room' }

function run(overrides: Partial<Parameters<typeof navigateWithExitGate>[0]> = {}) {
  const navigate = vi.fn<() => Promise<NavigationResult>>()
    .mockResolvedValue(delegatedResult)
  const getWorldState = vi.fn<(sessionId: string) => Promise<WorldStateResult>>()
    .mockResolvedValue(stateResult(makeState()))

  const result = navigateWithExitGate({
    sessionId: '00000000-0000-4000-8000-000000000002',
    fromRoomId: 'throne-room',
    toRoomId: 'ruined-safehouse',
    demoQuestEnabled: true,
    getWorldState,
    navigate,
    ...overrides,
  })

  return { getWorldState, navigate, result }
}

describe('navigateWithExitGate', () => {
  it('returns blocked and does not call navigation before Malik is resolved', async () => {
    const { getWorldState, navigate, result } = run()

    await expect(result).resolves.toEqual({ status: 'rejected', reason: 'blocked' })
    expect(getWorldState).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('delegates after Malik is resolved', async () => {
    const { navigate, result } = run({
      getWorldState: async () => stateResult(makeState({
        roomStates: {
          'throne-room': {
            visited: true,
            flags: { 'encounter:malik-encounter': true },
          },
        },
      })),
    })

    await expect(result).resolves.toBe(delegatedResult)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('does not gate non-demo sessions', async () => {
    const { getWorldState, navigate, result } = run({ demoQuestEnabled: false })

    await expect(result).resolves.toBe(delegatedResult)
    expect(getWorldState).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('does not gate generated or unrelated room paths', async () => {
    const { navigate, result } = run({
      fromRoomId: 'generated-room-a',
      toRoomId: 'generated-room-b',
    })

    await expect(result).resolves.toBe(delegatedResult)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('delegates to existing navigation behavior when authoritative state is unavailable', async () => {
    const { navigate, result } = run({ getWorldState: async () => notFoundResult() })

    await expect(result).resolves.toBe(delegatedResult)
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})
