import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../loadRoomSpec'
import type { LoadedRoom } from '../loadRoomSpec'
import { listInteractObjectiveCandidates } from './objectiveCandidates'

function makeRoom(objects: unknown[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'candidate-room',
    name: 'Candidate Room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 5] },
    objects,
  })
}

describe('listInteractObjectiveCandidates', () => {
  it('returns only objective-ready interact-object candidates', () => {
    const room = makeRoom([
      {
        type: 'book',
        id: 'book-1',
        position: [0, 0.3, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
      {
        type: 'crate',
        id: 'crate-1',
        position: [2, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect' },
      },
      {
        type: 'paper',
        position: [-2, 0.3, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
      {
        type: 'artifact',
        id: 'artifact-1',
        position: [0, 0, 2],
        interaction: {
          key: 'E',
          prompt: 'Touch',
          effect: { kind: 'inspect' },
          encounter: { description: 'A guardian stirs.', choices: [] },
        },
      },
    ])

    expect(listInteractObjectiveCandidates(room)).toEqual([
      { objectId: 'book-1', type: 'book' },
    ])
  })

  it('emits only objectId and type', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'scroll-1',
        position: [0, 0.5, -2],
        name: 'Secret Object Name',
        interaction: {
          key: 'E',
          prompt: 'Read secret prompt',
          title: 'Secret title',
          body: 'Secret generated body',
          effect: { kind: 'inspect' },
        },
      },
    ])

    const candidates = listInteractObjectiveCandidates(room)
    const serialized = JSON.stringify(candidates)

    expect(candidates).toEqual([{ objectId: 'scroll-1', type: 'scroll' }])
    expect(Object.keys(candidates[0]!)).toEqual(['objectId', 'type'])
    expect(serialized).not.toContain('Secret Object Name')
    expect(serialized).not.toContain('Read secret prompt')
    expect(serialized).not.toContain('Secret title')
    expect(serialized).not.toContain('Secret generated body')
  })

  it('rejects derived flag-like object ids', () => {
    const room = makeRoom([
      {
        type: 'book',
        id: 'interaction:book-1',
        position: [0, 0.3, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
      {
        type: 'paper',
        id: 'encounter:paper-1',
        position: [2, 0.3, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
    ])

    expect(listInteractObjectiveCandidates(room)).toEqual([])
  })

  it('is deterministic and does not mutate the room', () => {
    const room = makeRoom([
      {
        type: 'map',
        id: 'map-1',
        position: [0, 0.3, -2],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
    ])
    const before = JSON.stringify(room)

    expect(listInteractObjectiveCandidates(room)).toEqual(listInteractObjectiveCandidates(room))
    expect(JSON.stringify(room)).toBe(before)
  })
})
