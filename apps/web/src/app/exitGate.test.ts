import { describe, expect, it } from 'vitest'
import type { WorldState } from '../domain/world/worldState'
import { evaluateExitGate } from './exitGate'

function makeState(flags?: Record<string, boolean>): WorldState {
  return {
    schemaVersion: 1,
    worldId: '00000000-0000-4000-8000-000000000001',
    sessionId: '00000000-0000-4000-8000-000000000002',
    currentRoomId: 'throne-room',
    player: { health: { current: 10, max: 10 }, status: [] },
    inventory: [],
    roomStates: {
      'throne-room': { visited: true, ...(flags ? { flags } : {}) },
    },
    revision: 1,
    updatedAt: '2026-06-28T00:00:00.000Z',
  }
}

function gate(overrides: Partial<Parameters<typeof evaluateExitGate>[0]> = {}) {
  return evaluateExitGate({
    fromRoomId: 'throne-room',
    toRoomId: 'ruined-safehouse',
    state: makeState(),
    demoQuestEnabled: true,
    ...overrides,
  })
}

describe('evaluateExitGate', () => {
  it('gates throne-room to ruined-safehouse before Malik is resolved', () => {
    expect(gate()).toEqual({ gated: true, reason: 'malik-unresolved' })
  })

  it('does not gate after Malik is resolved', () => {
    expect(gate({
      state: makeState({ 'encounter:malik-encounter': true }),
    })).toEqual({ gated: false })
  })

  it('does not gate unrelated room paths', () => {
    expect(gate({ fromRoomId: 'ruined-safehouse' })).toEqual({ gated: false })
    expect(gate({ toRoomId: 'generated-room' })).toEqual({ gated: false })
  })

  it('does not gate when the demo quest is not enabled', () => {
    expect(gate({ demoQuestEnabled: false })).toEqual({ gated: false })
  })

  it('does not gate when state or room state is missing', () => {
    expect(gate({ state: undefined })).toEqual({ gated: false })
    expect(gate({ state: null })).toEqual({ gated: false })
    expect(gate({ state: {} })).toEqual({ gated: false })
    expect(gate({ state: { roomStates: {} } })).toEqual({ gated: false })
  })

  it('does not gate generated or unrelated paths even with missing state', () => {
    expect(gate({
      fromRoomId: 'generated-a',
      toRoomId: 'generated-b',
      state: undefined,
    })).toEqual({ gated: false })
  })

  it('does not mutate input state', () => {
    const state = makeState({ 'encounter:malik-encounter': false })
    const before = JSON.stringify(state)

    evaluateExitGate({
      fromRoomId: 'throne-room',
      toRoomId: 'ruined-safehouse',
      state,
      demoQuestEnabled: true,
    })

    expect(JSON.stringify(state)).toBe(before)
  })
})
