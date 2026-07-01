import { describe, expect, it } from 'vitest'
import { assembleGate } from './generatedMechanicalGateProposal'
import {
  isGeneratedGateSatisfiable,
  validateGeneratedMechanicalGate,
} from './generatedMechanicalGate'
import { interactionFlagKey } from './interactions/planInteraction'
import { loadRoomSpec, type LoadedRoom } from './loadRoomSpec'
import type { RoomSpec } from './roomSpec'

function makeRoom(objects: unknown[], id = 'generated-room'): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id,
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

function inspectObject(id = 'control-panel'): unknown {
  return {
    type: 'machine',
    id,
    position: [0, 0, -2],
    interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
  }
}

function takeItemObject(id = 'supply-crate'): unknown {
  return {
    type: 'crate',
    id,
    position: [1, 0, -2],
    interaction: {
      key: 'E',
      prompt: 'Take',
      effect: {
        kind: 'take-item',
        item: { itemId: 'battery', name: 'Battery', quantity: 1 },
      },
    },
  }
}

function exitObject(toRoomId = 'north-room'): unknown {
  return {
    type: 'arch',
    id: 'north-arch',
    position: [0, 0, -8],
    interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId } },
  }
}

function proposal(unlockObjectId = 'control-panel', exitToRoomId = 'north-room'): string {
  return JSON.stringify({ unlockObjectId, exitToRoomId })
}

function expectDropped(rawText: string, room: LoadedRoom): void {
  expect(assembleGate(rawText, room)).toBeNull()
}

describe('assembleGate', () => {
  it('accepts a valid proposal and derives a contract-valid satisfiable gate', () => {
    const room = makeRoom([inspectObject(), exitObject()])

    const result = assembleGate(proposal(), room)

    expect(result?.gate).toEqual({
      id: 'generated-room:mechanical-gate',
      kind: 'locked-exit',
      condition: {
        kind: 'room-flag',
        roomId: 'generated-room',
        flag: interactionFlagKey(undefined, 'control-panel'),
      },
      effect: { kind: 'unlock-exit', toRoomId: 'north-room' },
    })
    expect(validateGeneratedMechanicalGate(result?.gate)).toEqual(result?.gate)
    expect(result?.gate && isGeneratedGateSatisfiable(result.gate, room)).toBe(true)
  })

  it('derives take-item flags through the frozen interaction flag helper', () => {
    const room = makeRoom([takeItemObject(), exitObject('east-room')])

    const result = assembleGate(proposal('supply-crate', 'east-room'), room)

    expect(result?.gate.condition.flag).toBe(interactionFlagKey(undefined, 'supply-crate'))
    expect(result?.gate.effect.toRoomId).toBe('east-room')
  })

  it('returns null for bad JSON', () => {
    expectDropped('{', makeRoom([inspectObject(), exitObject()]))
  })

  it('returns null for extra keys, wrong types, empty strings, and derived flag prefixes', () => {
    const room = makeRoom([inspectObject(), exitObject()])

    expectDropped(
      JSON.stringify({ unlockObjectId: 'control-panel', exitToRoomId: 'north-room', extra: true }),
      room,
    )
    expectDropped(
      JSON.stringify({ unlockObjectId: 12, exitToRoomId: 'north-room' }),
      room,
    )
    expectDropped(
      JSON.stringify({ unlockObjectId: 'control-panel', exitToRoomId: 12 }),
      room,
    )
    expectDropped(
      JSON.stringify({ unlockObjectId: '', exitToRoomId: 'north-room' }),
      room,
    )
    expectDropped(
      JSON.stringify({ unlockObjectId: 'control-panel', exitToRoomId: '   ' }),
      room,
    )
    expectDropped(
      JSON.stringify({ unlockObjectId: 'interaction:control-panel', exitToRoomId: 'north-room' }),
      room,
    )
    expectDropped(
      JSON.stringify({ unlockObjectId: 'encounter:control-panel', exitToRoomId: 'north-room' }),
      room,
    )
  })

  it('returns null when the object is missing', () => {
    expectDropped(proposal('missing-panel'), makeRoom([inspectObject(), exitObject()]))
  })

  it('returns null when the object has no flag-writing interaction', () => {
    const visualOnlyRoom = makeRoom([
      { type: 'pillar', id: 'quiet-pillar', position: [0, 0, -2] },
      exitObject(),
    ])
    const noEffectRoom = makeRoom([
      {
        type: 'machine',
        id: 'quiet-machine',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect' },
      },
      exitObject(),
    ])

    expectDropped(proposal('quiet-pillar'), visualOnlyRoom)
    expectDropped(proposal('quiet-machine'), noEffectRoom)
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

    expectDropped(proposal(), useItemRoom)
    expectDropped(proposal(), encounterRoom)
  })

  it('returns null when the exit target is missing', () => {
    expectDropped(proposal('control-panel', 'missing-room'), makeRoom([inspectObject(), exitObject()]))
  })

  it('returns null when the derived candidate fails contract validation', () => {
    const room = makeRoom([inspectObject(), exitObject()], '')

    expectDropped(proposal(), room)
  })

  it('is deterministic for the same input', () => {
    const room = makeRoom([inspectObject(), exitObject()])
    const rawText = proposal()

    expect(assembleGate(rawText, room)).toEqual(assembleGate(rawText, room))
  })

  it('does not mutate the room input', () => {
    const room = makeRoom([inspectObject(), exitObject()])
    const before = structuredClone(room)

    assembleGate(proposal(), room)

    expect(room).toEqual(before)
  })
})
