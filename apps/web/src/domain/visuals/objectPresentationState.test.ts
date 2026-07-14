import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../loadRoomSpec'
import {
  projectObjectPresentationState,
  projectRoomObjectPresentationStates,
} from './objectPresentationState'

describe('projectObjectPresentationState', () => {
  it('keeps static damage condition orthogonal to a dynamic looted state', () => {
    const object = room([
      {
        id: 'locker',
        type: 'chest',
        condition: 'burned',
        position: [0, 0, 0],
        interaction: {
          key: 'E',
          prompt: 'Take bandage',
          effect: {
            kind: 'take-item',
            item: { itemId: 'bandage', name: 'Bandage', quantity: 1 },
          },
        },
      },
    ]).objects[0]!

    expect(projectObjectPresentationState(object, { resolved: true })).toEqual({
      condition: 'burned',
      interactionState: 'looted',
      resolved: true,
    })
  })

  it('projects documents as read and inspected containers as open', () => {
    const loaded = room([
      {
        id: 'ledger',
        type: 'book',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
      {
        id: 'coffer',
        type: 'chest',
        position: [1, 0, 0],
        interaction: { key: 'E', prompt: 'Open', effect: { kind: 'inspect' } },
      },
    ])
    expect(projectObjectPresentationState(loaded.objects[0]!, { resolved: true }).interactionState)
      .toBe('read')
    expect(projectObjectPresentationState(loaded.objects[1]!, { resolved: true }).interactionState)
      .toBe('open')
  })

  it('projects generated exit gate results as locked or open without changing truth', () => {
    const exit = room([
      {
        id: 'crypt-gate',
        type: 'arch',
        variant: 'iron-gate',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Enter', exit: { toRoomId: 'crypt' } },
      },
    ]).objects[0]!

    expect(projectObjectPresentationState(exit, {
      exitGateResult: { gated: true },
    }).interactionState).toBe('locked')
    expect(projectObjectPresentationState(exit, {
      exitGateResult: { gated: false },
    }).interactionState).toBe('open')
  })
})

describe('projectRoomObjectPresentationStates', () => {
  it('uses the existing resolved-id projection and excludes id-less objects from live updates', () => {
    const loaded = room([
      {
        id: 'note',
        type: 'paper',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
      { type: 'crate', position: [1, 0, 0] },
    ])
    const states = projectRoomObjectPresentationStates({
      room: loaded,
      resolvedObjectIds: new Set(['note']),
    })
    expect(states.size).toBe(1)
    expect(states.get('note')).toMatchObject({
      interactionState: 'read',
      resolved: true,
    })
  })

  it('keys gate projections by the validated exit target', () => {
    const loaded = room([
      {
        id: 'gate',
        type: 'architecture',
        kind: 'gate',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'village' } },
      },
    ])
    const states = projectRoomObjectPresentationStates({
      room: loaded,
      exitGateResults: new Map([['village', { gated: true }]]),
    })
    expect(states.get('gate')?.interactionState).toBe('locked')
  })
})

function room(objects: unknown[]) {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'presentation-state-test',
    name: 'Presentation State Test',
    shell: { dimensions: { width: 12, depth: 12, height: 4 } },
    spawn: { position: [0, 1.7, 4] },
    objects,
  })
}
