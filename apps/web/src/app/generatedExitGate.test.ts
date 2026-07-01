import { describe, expect, it } from 'vitest'
import { validateGeneratedMechanicalGate, type GeneratedMechanicalGate } from '../domain/generatedMechanicalGate'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import type { RoomSpec } from '../domain/roomSpec'
import type { WorldState } from '../domain/world/worldState'
import { evaluateGeneratedExitGate } from './generatedExitGate'

function makeRoom(objects: unknown[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'generated-room',
    name: 'Generated Room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      wallThickness: 0.3,
      floorColor: '#4a4036',
      wallColor: '#6b6355',
      exits: [{ side: 'north', width: 2.5 }],
    },
    spawn: { position: [0, 0, 0], yaw: 0 },
    lighting: {
      ambient: { color: '#404858', intensity: 0.6 },
    },
    objects,
  } satisfies RoomSpec)
}

function gatedRoom(): LoadedRoom {
  return makeRoom([
    {
      type: 'machine',
      id: 'control-panel',
      position: [0, 0, -2],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    },
    {
      type: 'arch',
      id: 'north-arch',
      position: [0, 0, -8],
      interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'north-room' } },
    },
  ])
}

function gateState(flags?: Record<string, boolean>): Pick<WorldState, 'roomStates'> {
  return {
    roomStates: {
      'generated-room': { visited: true, ...(flags ? { flags } : {}) },
    },
  }
}

function providerGate(overrides: Partial<GeneratedMechanicalGate> = {}): GeneratedMechanicalGate {
  const gate = validateGeneratedMechanicalGate({
    id: 'provider-gate',
    kind: 'locked-exit',
    condition: {
      kind: 'room-flag',
      roomId: 'generated-room',
      flag: 'interaction:control-panel',
    },
    effect: { kind: 'unlock-exit', toRoomId: 'north-room' },
    ...overrides,
  })
  if (gate === null) throw new Error('invalid test gate')
  return gate
}

describe('evaluateGeneratedExitGate', () => {
  it('fails open when state is null or undefined for all provider statuses', () => {
    for (const providerGateStatus of [undefined, 'not-attempted', 'rejected', 'accepted'] as const) {
      expect(evaluateGeneratedExitGate({
        room: gatedRoom(),
        toRoomId: 'north-room',
        state: null,
        providerGateStatus,
        providerGate: providerGate(),
      })).toEqual({ gated: false })
      expect(evaluateGeneratedExitGate({
        room: gatedRoom(),
        toRoomId: 'north-room',
        state: undefined,
        providerGateStatus,
        providerGate: providerGate(),
      })).toEqual({ gated: false })
    }
  })

  it('gates the governed exit when the unlock flag is missing', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState(),
    })).toEqual({ gated: true })
  })

  it('gates the governed exit when the unlock flag is false', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState({ 'interaction:control-panel': false }),
    })).toEqual({ gated: true })
  })

  it('does not gate the governed exit when the unlock flag is true', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState({ 'interaction:control-panel': true }),
    })).toEqual({ gated: false })
  })

  it('does not gate a non-governed exit', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'side-room',
      state: gateState(),
    })).toEqual({ gated: false })
  })

  it('does not gate when the room has no gate ingredients', () => {
    const room = makeRoom([
      { type: 'pillar', id: 'quiet-pillar', position: [0, 0, -2] },
      {
        type: 'arch',
        id: 'north-arch',
        position: [0, 0, -8],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'north-room' } },
      },
    ])

    expect(evaluateGeneratedExitGate({
      room,
      toRoomId: 'north-room',
      state: gateState(),
    })).toEqual({ gated: false })
  })

  it('does not gate when the builder cannot derive a satisfiable gate', () => {
    const room = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
    ])

    expect(evaluateGeneratedExitGate({
      room,
      toRoomId: 'north-room',
      state: gateState(),
    })).toEqual({ gated: false })
  })

  it('gates when the room state is missing from the provided state', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: { roomStates: {} },
    })).toEqual({ gated: true })
  })

  it('does not mutate the room or state', () => {
    const room = gatedRoom()
    const state = gateState({ 'interaction:control-panel': false })
    const roomBefore = structuredClone(room)
    const stateBefore = structuredClone(state)

    evaluateGeneratedExitGate({ room, toRoomId: 'north-room', state })

    expect(room).toEqual(roomBefore)
    expect(state).toEqual(stateBefore)
  })

  it('returns only a boolean gate result with no derived gate details', () => {
    const result = evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState(),
    })

    expect(Object.keys(result)).toEqual(['gated'])
    expect(JSON.stringify(result)).not.toContain('generated-room')
    expect(JSON.stringify(result)).not.toContain('control-panel')
    expect(JSON.stringify(result)).not.toContain('interaction:control-panel')
    expect(JSON.stringify(result)).not.toContain('north-room')
    expect(JSON.stringify(result)).not.toContain('mechanical-gate')
  })

  it('provider rejected fails open and does not fall back to deterministic gating', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState(),
      providerGateStatus: 'rejected',
    })).toEqual({ gated: false })
  })

  it('provider accepted gates when satisfiable and the provider flag is missing or false', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState(),
      providerGateStatus: 'accepted',
      providerGate: providerGate(),
    })).toEqual({ gated: true })
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState({ 'interaction:control-panel': false }),
      providerGateStatus: 'accepted',
      providerGate: providerGate(),
    })).toEqual({ gated: true })
  })

  it('provider accepted opens when satisfiable and the provider flag is true', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState({ 'interaction:control-panel': true }),
      providerGateStatus: 'accepted',
      providerGate: providerGate(),
    })).toEqual({ gated: false })
  })

  it('provider accepted opens for non-governed exits', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'side-room',
      state: gateState(),
      providerGateStatus: 'accepted',
      providerGate: providerGate(),
    })).toEqual({ gated: false })
  })

  it('provider accepted with an unsatisfiable gate fails open and does not fall back to deterministic gating', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState(),
      providerGateStatus: 'accepted',
      providerGate: providerGate({
        condition: {
          kind: 'room-flag',
          roomId: 'other-room',
          flag: 'interaction:control-panel',
        },
      }),
    })).toEqual({ gated: false })
  })

  it('provider accepted with a missing provider gate fails open', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState(),
      providerGateStatus: 'accepted',
    })).toEqual({ gated: false })
  })

  it('provider not-attempted preserves deterministic behavior', () => {
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState(),
      providerGateStatus: 'not-attempted',
    })).toEqual({ gated: true })
    expect(evaluateGeneratedExitGate({
      room: gatedRoom(),
      toRoomId: 'north-room',
      state: gateState({ 'interaction:control-panel': true }),
      providerGateStatus: 'not-attempted',
    })).toEqual({ gated: false })
  })
})
