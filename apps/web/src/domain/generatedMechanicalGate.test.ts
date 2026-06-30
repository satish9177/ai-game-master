import { describe, expect, it } from 'vitest'
import {
  buildGeneratedMechanicalGate,
  evaluateGeneratedGate,
  isGeneratedGateSatisfiable,
  validateGeneratedMechanicalGate,
  type GeneratedMechanicalGate,
} from './generatedMechanicalGate'
import { loadRoomSpec, type LoadedRoom } from './loadRoomSpec'
import { evaluateCondition } from './quests/evaluateQuest'
import type { RoomSpec } from './roomSpec'
import type { WorldState } from './world/worldState'

const WORLD_ID = '00000000-0000-4000-8000-000000000001'
const SESSION_ID = '00000000-0000-4000-8000-000000000002'
const UPDATED_AT = '2026-01-01T00:00:00.000Z'

function validGate(overrides: Partial<GeneratedMechanicalGate> = {}): GeneratedMechanicalGate {
  return {
    id: 'gate-1',
    kind: 'locked-exit',
    condition: { kind: 'room-flag', roomId: 'generated-room', flag: 'interaction:control-panel' },
    effect: { kind: 'unlock-exit', toRoomId: 'north-room' },
    ...overrides,
  }
}

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    schemaVersion: 1,
    worldId: WORLD_ID,
    sessionId: SESSION_ID,
    currentRoomId: 'generated-room',
    player: { health: { current: 75, max: 100 }, status: [] },
    inventory: [],
    roomStates: {},
    revision: 1,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

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

function exitObject(toRoomId = 'north-room'): unknown {
  return {
    type: 'arch',
    id: 'north-arch',
    position: [0, 0, -8],
    interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId } },
  }
}

describe('buildGeneratedMechanicalGate', () => {
  it('derives a valid satisfiable gate from an inspect flag-writer and an exit', () => {
    const room = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      exitObject(),
    ])

    const gate = buildGeneratedMechanicalGate(room)

    expect(gate).toEqual({
      id: 'generated-room:mechanical-gate',
      kind: 'locked-exit',
      condition: {
        kind: 'room-flag',
        roomId: 'generated-room',
        flag: 'interaction:control-panel',
      },
      effect: { kind: 'unlock-exit', toRoomId: 'north-room' },
    })
    expect(validateGeneratedMechanicalGate(gate)).toEqual(gate)
    expect(gate && isGeneratedGateSatisfiable(gate, room)).toBe(true)
  })

  it('derives a valid satisfiable gate from a take-item flag-writer', () => {
    const room = makeRoom([
      {
        type: 'crate',
        id: 'supply-crate',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Take',
          effect: {
            kind: 'take-item',
            item: { itemId: 'battery', name: 'Battery', quantity: 1 },
          },
        },
      },
      exitObject('east-room'),
    ])

    const gate = buildGeneratedMechanicalGate(room)

    expect(gate?.condition.flag).toBe('interaction:supply-crate')
    expect(gate?.effect.toRoomId).toBe('east-room')
    expect(gate && isGeneratedGateSatisfiable(gate, room)).toBe(true)
  })

  it('returns null when no flag-writing interaction exists', () => {
    const room = makeRoom([
      { type: 'pillar', id: 'quiet-pillar', position: [0, 0, -2] },
      exitObject(),
    ])

    expect(buildGeneratedMechanicalGate(room)).toBeNull()
  })

  it('returns null when no generated exit exists', () => {
    const room = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
    ])

    expect(buildGeneratedMechanicalGate(room)).toBeNull()
  })

  it('returns null for use-item and encounter-owned interactions', () => {
    const useItemRoom = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Use',
          effect: { kind: 'use-item', itemId: 'battery', quantity: 1 },
        },
      },
      exitObject(),
    ])
    const encounterRoom = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Open',
          effect: { kind: 'inspect' },
          encounter: {
            description: 'A guarded mechanism.',
            choices: [{ id: 'try', action: 'force', label: 'Try', outcome: { effects: [] } }],
          },
        },
      },
      exitObject(),
    ])

    expect(buildGeneratedMechanicalGate(useItemRoom)).toBeNull()
    expect(buildGeneratedMechanicalGate(encounterRoom)).toBeNull()
  })

  it('is deterministic and picks the first flag-writer and first exit in room order', () => {
    const room = makeRoom([
      {
        type: 'machine',
        id: 'first-panel',
        position: [-2, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      {
        type: 'machine',
        id: 'second-panel',
        position: [2, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      exitObject('first-exit'),
      exitObject('second-exit'),
    ])

    expect(buildGeneratedMechanicalGate(room)).toEqual(buildGeneratedMechanicalGate(room))
    expect(buildGeneratedMechanicalGate(room)?.condition.flag).toBe('interaction:first-panel')
    expect(buildGeneratedMechanicalGate(room)?.effect.toRoomId).toBe('first-exit')
  })

  it('does not mutate the room', () => {
    const room = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      exitObject(),
    ])
    const before = structuredClone(room)

    buildGeneratedMechanicalGate(room)

    expect(room).toEqual(before)
  })
})

describe('validateGeneratedMechanicalGate', () => {
  it('parses a valid locked-exit gate', () => {
    expect(validateGeneratedMechanicalGate(validGate())).toEqual(validGate())
  })

  it('returns null for unknown gate, condition, or effect kinds', () => {
    expect(validateGeneratedMechanicalGate({ ...validGate(), kind: 'blocked-door' })).toBeNull()
    expect(validateGeneratedMechanicalGate({
      ...validGate(),
      condition: { kind: 'has-item', itemId: 'key' },
    })).toBeNull()
    expect(validateGeneratedMechanicalGate({
      ...validGate(),
      effect: { kind: 'open-object', toRoomId: 'north-room' },
    })).toBeNull()
  })

  it('returns null for extra keys at every level', () => {
    expect(validateGeneratedMechanicalGate({ ...validGate(), extra: true })).toBeNull()
    expect(validateGeneratedMechanicalGate({
      ...validGate(),
      condition: { ...validGate().condition, extra: true },
    })).toBeNull()
    expect(validateGeneratedMechanicalGate({
      ...validGate(),
      effect: { ...validGate().effect, extra: true },
    })).toBeNull()
  })

  it('returns null for missing required fields', () => {
    expect(validateGeneratedMechanicalGate({
      kind: 'locked-exit',
      condition: validGate().condition,
      effect: validGate().effect,
    })).toBeNull()
    expect(validateGeneratedMechanicalGate({
      id: 'gate-1',
      kind: 'locked-exit',
      effect: validGate().effect,
    })).toBeNull()
    expect(validateGeneratedMechanicalGate({
      id: 'gate-1',
      kind: 'locked-exit',
      condition: validGate().condition,
    })).toBeNull()
  })

  it('returns null for empty ids and keys', () => {
    expect(validateGeneratedMechanicalGate(validGate({ id: '' }))).toBeNull()
    expect(validateGeneratedMechanicalGate(validGate({
      condition: { kind: 'room-flag', roomId: '', flag: 'interaction:control-panel' },
    }))).toBeNull()
    expect(validateGeneratedMechanicalGate(validGate({
      condition: { kind: 'room-flag', roomId: 'generated-room', flag: '' },
    }))).toBeNull()
    expect(validateGeneratedMechanicalGate(validGate({
      effect: { kind: 'unlock-exit', toRoomId: '' },
    }))).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(validateGeneratedMechanicalGate(null)).toBeNull()
    expect(validateGeneratedMechanicalGate('gate')).toBeNull()
    expect(validateGeneratedMechanicalGate([])).toBeNull()
  })
})

describe('evaluateGeneratedGate', () => {
  it('returns unlocked when the condition flag is set in the named room', () => {
    const gate = validGate()
    const state = makeState({
      roomStates: {
        'generated-room': { visited: true, flags: { 'interaction:control-panel': true } },
      },
    })

    expect(evaluateGeneratedGate(gate, state)).toBe('unlocked')
  })

  it('returns locked when the flag is absent, false, in another room, or the room state is missing', () => {
    const gate = validGate()

    expect(evaluateGeneratedGate(gate, makeState({
      roomStates: { 'generated-room': { visited: true } },
    }))).toBe('locked')
    expect(evaluateGeneratedGate(gate, makeState({
      roomStates: {
        'generated-room': { visited: true, flags: { 'interaction:control-panel': false } },
      },
    }))).toBe('locked')
    expect(evaluateGeneratedGate(gate, makeState({
      roomStates: {
        'other-room': { visited: true, flags: { 'interaction:control-panel': true } },
      },
    }))).toBe('locked')
    expect(() => evaluateGeneratedGate(gate, makeState())).not.toThrow()
    expect(evaluateGeneratedGate(gate, makeState())).toBe('locked')
  })

  it('matches evaluateCondition for the same room-flag condition', () => {
    const gate = validGate()
    const state = makeState({
      roomStates: {
        'generated-room': { visited: true, flags: { 'interaction:control-panel': true } },
      },
    })

    expect(evaluateGeneratedGate(gate, state) === 'unlocked').toBe(
      evaluateCondition(gate.condition, state),
    )
  })
})

describe('isGeneratedGateSatisfiable', () => {
  it('accepts an inspect-derived flag when the governed exit exists', () => {
    const room = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      exitObject(),
    ])

    expect(isGeneratedGateSatisfiable(validGate(), room)).toBe(true)
  })

  it('accepts an explicit inspect flag even when the object has no id', () => {
    const room = makeRoom([
      {
        type: 'machine',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Inspect',
          effect: { kind: 'inspect', flag: 'custom-unlock' },
        },
      },
      exitObject(),
    ])
    const gate = validGate({
      condition: { kind: 'room-flag', roomId: 'generated-room', flag: 'custom-unlock' },
    })

    expect(isGeneratedGateSatisfiable(gate, room)).toBe(true)
  })

  it('accepts a take-item derived flag because the current interaction planner writes it', () => {
    const room = makeRoom([
      {
        type: 'crate',
        id: 'supply-crate',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Take',
          effect: {
            kind: 'take-item',
            item: { itemId: 'battery', name: 'Battery', quantity: 1 },
          },
        },
      },
      exitObject(),
    ])
    const gate = validGate({
      condition: { kind: 'room-flag', roomId: 'generated-room', flag: 'interaction:supply-crate' },
    })

    expect(isGeneratedGateSatisfiable(gate, room)).toBe(true)
  })

  it('rejects gates whose condition room does not match the room', () => {
    const room = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      exitObject(),
    ])
    const gate = validGate({
      condition: { kind: 'room-flag', roomId: 'other-room', flag: 'interaction:control-panel' },
    })

    expect(isGeneratedGateSatisfiable(gate, room)).toBe(false)
  })

  it('rejects gates with no in-room interaction that can write the unlock flag', () => {
    const room = makeRoom([
      {
        type: 'machine',
        id: 'other-panel',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      exitObject(),
    ])

    expect(isGeneratedGateSatisfiable(validGate(), room)).toBe(false)
  })

  it('rejects gates whose effect does not match an actual exit', () => {
    const room = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      exitObject('east-room'),
    ])

    expect(isGeneratedGateSatisfiable(validGate(), room)).toBe(false)
  })

  it('rejects use-item effects and interactions shadowed by encounters', () => {
    const useItemRoom = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Use',
          effect: { kind: 'use-item', itemId: 'battery', quantity: 1 },
        },
      },
      exitObject(),
    ])
    const encounterRoom = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Open',
          effect: { kind: 'inspect' },
          encounter: {
            description: 'A guarded mechanism.',
            choices: [{ id: 'try', action: 'force', label: 'Try', outcome: { effects: [] } }],
          },
        },
      },
      exitObject(),
    ])

    expect(isGeneratedGateSatisfiable(validGate(), useItemRoom)).toBe(false)
    expect(isGeneratedGateSatisfiable(validGate(), encounterRoom)).toBe(false)
  })

  it('rejects derived one-shot flags when the writing object has no stable id', () => {
    const room = makeRoom([
      {
        type: 'machine',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      exitObject(),
    ])

    expect(isGeneratedGateSatisfiable(validGate(), room)).toBe(false)
  })

  it('does not mutate the gate or room', () => {
    const gate = validGate()
    const room = makeRoom([
      {
        type: 'machine',
        id: 'control-panel',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      exitObject(),
    ])
    const gateBefore = structuredClone(gate)
    const roomBefore = structuredClone(room)

    isGeneratedGateSatisfiable(gate, room)

    expect(gate).toEqual(gateBefore)
    expect(room).toEqual(roomBefore)
  })
})
