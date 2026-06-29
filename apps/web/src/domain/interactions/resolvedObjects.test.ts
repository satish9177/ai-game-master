import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../loadRoomSpec'
import type { LoadedRoom } from '../loadRoomSpec'
import type { RoomSpec } from '../roomSpec'
import type { RoomState } from '../world/worldState'
import { resolvedObjectIds } from './resolvedObjects'

function roomWith(objects: unknown[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'generated-room',
    name: 'Generated Room',
    shell: {
      dimensions: { width: 12, depth: 12, height: 4 },
      wallThickness: 0.3,
      floorColor: '#4a4036',
      wallColor: '#6b6355',
      exits: [],
    },
    spawn: { position: [0, 0, 0], yaw: 0 },
    lighting: {
      ambient: { color: '#404858', intensity: 0.6 },
    },
    objects,
  } satisfies RoomSpec)
}

function roomState(flags?: Record<string, boolean>): RoomState {
  return flags === undefined
    ? { visited: true }
    : { visited: true, flags }
}

function ids(set: ReadonlySet<string>): string[] {
  return [...set].sort()
}

describe('resolvedObjectIds', () => {
  it('includes an inspect object when its derived flag is set', () => {
    const room = roomWith([{
      type: 'scroll',
      id: 'case-file',
      position: [1, 0, 1],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    }])

    expect(ids(resolvedObjectIds(room, roomState({ 'interaction:case-file': true })))).toEqual([
      'case-file',
    ])
  })

  it('includes a take-item object when its derived flag is set', () => {
    const room = roomWith([{
      type: 'crate',
      id: 'supply-crate',
      position: [1, 0, 1],
      interaction: {
        key: 'E',
        prompt: 'Take',
        effect: {
          kind: 'take-item',
          item: { itemId: 'battery', name: 'Battery', quantity: 1 },
        },
      },
    }])

    expect(ids(resolvedObjectIds(room, roomState({ 'interaction:supply-crate': true })))).toEqual([
      'supply-crate',
    ])
  })

  it('excludes one-shot objects when their flags are unset', () => {
    const room = roomWith([{
      type: 'scroll',
      id: 'case-file',
      position: [1, 0, 1],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    }])

    expect(ids(resolvedObjectIds(room, roomState({ 'interaction:other-object': true })))).toEqual([])
  })

  it('excludes use-item objects even when a matching flag is set', () => {
    const room = roomWith([{
      type: 'machine',
      id: 'med-station',
      position: [1, 0, 1],
      interaction: {
        key: 'E',
        prompt: 'Use',
        effect: { kind: 'use-item', itemId: 'battery', quantity: 1 },
      },
    }])

    expect(ids(resolvedObjectIds(room, roomState({ 'interaction:med-station': true })))).toEqual([])
  })

  it('excludes objects without interactions or effects', () => {
    const room = roomWith([
      {
        type: 'crate',
        id: 'decorative-crate',
        position: [1, 0, 1],
      },
      {
        type: 'book',
        id: 'plain-book',
        position: [-1, 0, 1],
        interaction: { key: 'E', prompt: 'Read' },
      },
    ])

    expect(ids(resolvedObjectIds(room, roomState({
      'interaction:decorative-crate': true,
      'interaction:plain-book': true,
    })))).toEqual([])
  })

  it('uses an explicit inspect effect flag when one is provided', () => {
    const room = roomWith([{
      type: 'scroll',
      id: 'case-file',
      position: [1, 0, 1],
      interaction: {
        key: 'E',
        prompt: 'Inspect',
        effect: { kind: 'inspect', flag: 'custom-flag' },
      },
    }])

    expect(ids(resolvedObjectIds(room, roomState({ 'interaction:case-file': true })))).toEqual([])
    expect(ids(resolvedObjectIds(room, roomState({ 'custom-flag': true })))).toEqual([
      'case-file',
    ])
  })

  it('returns an empty set for missing roomState or missing and empty flags', () => {
    const room = roomWith([{
      type: 'scroll',
      id: 'case-file',
      position: [1, 0, 1],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    }])

    expect(ids(resolvedObjectIds(room, undefined))).toEqual([])
    expect(ids(resolvedObjectIds(room, roomState()))).toEqual([])
    expect(ids(resolvedObjectIds(room, roomState({})))).toEqual([])
  })

  it('does not mutate the room or roomState inputs', () => {
    const room = roomWith([{
      type: 'scroll',
      id: 'case-file',
      position: [1, 0, 1],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    }])
    const state = roomState({ 'interaction:case-file': true })
    const roomBefore = structuredClone(room)
    const stateBefore = structuredClone(state)

    resolvedObjectIds(room, state)

    expect(room).toEqual(roomBefore)
    expect(state).toEqual(stateBefore)
  })
})
