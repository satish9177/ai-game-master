import { describe, expect, it } from 'vitest'
import { assignGeneratedObjectPurpose } from './generatedRoomObjectPurpose'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'

function makeRoom(objects: unknown[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'purpose-test',
    name: 'Purpose Test',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 5] },
    objects,
  })
}

function cloneRoom(room: LoadedRoom): LoadedRoom {
  return JSON.parse(JSON.stringify(room)) as LoadedRoom
}

describe('assignGeneratedObjectPurpose', () => {
  it('assigns the correct verb per allowlisted object type', () => {
    const room = makeRoom([
      { type: 'book', position: [-5, 0.3, 0] },
      { type: 'paper', position: [-4, 0.3, 0] },
      { type: 'map', position: [-3, 0.3, 0] },
      { type: 'chest', position: [-2, 0, 0] },
      { type: 'crate', position: [-1, 0, 0] },
      { type: 'barrel', position: [0, 0, 0] },
      { type: 'corpse', position: [1, 0, 0] },
      { type: 'table', position: [2, 0, 0] },
      { type: 'machine', position: [3, 0, 0] },
      { type: 'altar', position: [4, 0, 0] },
      { type: 'statue', position: [5, 0, 0] },
      { type: 'artifact', position: [6, 0, 0] },
    ])

    const result = assignGeneratedObjectPurpose(room)

    expect(result.purposesAssigned).toBe(12)
    expect(result.room.objects.map((object) =>
      'interaction' in object ? object.interaction?.prompt : undefined,
    )).toEqual([
      'Read',
      'Read',
      'Read',
      'Inspect',
      'Inspect',
      'Inspect',
      'Inspect',
      'Inspect',
      'Inspect',
      'Examine',
      'Examine',
      'Examine',
    ])
  })

  it('synthesizes interactions with only safe presentation fields', () => {
    const room = makeRoom([{ type: 'machine', position: [2, 0, 0] }])

    const result = assignGeneratedObjectPurpose(room)
    const object = result.room.objects[0]!
    const interaction = 'interaction' in object ? object.interaction : undefined

    expect(interaction).toStrictEqual({ key: 'E', prompt: 'Inspect' })
    expect(interaction).not.toHaveProperty('effect')
    expect(interaction).not.toHaveProperty('encounter')
    expect(interaction).not.toHaveProperty('dialogue')
    expect(interaction).not.toHaveProperty('exit')
    expect(interaction).not.toHaveProperty('item')
    expect(interaction).not.toHaveProperty('inventory')
    expect(interaction).not.toHaveProperty('quest')
    expect(interaction).not.toHaveProperty('combat')
  })

  it('never overwrites existing interactions and preserves that object reference', () => {
    const room = makeRoom([
      {
        type: 'chest',
        position: [2, 0, 0],
        interaction: {
          key: 'E',
          prompt: 'Open',
          body: 'The latch is already marked by authored content.',
          effect: { kind: 'inspect', flag: 'chest-seen' },
        },
      },
      { type: 'book', position: [-2, 0.3, 0] },
    ])
    const existingObject = room.objects[0]!

    const result = assignGeneratedObjectPurpose(room)

    expect(result.room.objects[0]).toBe(existingObject)
    expect(result.room.objects[0]).toEqual(existingObject)
    expect(
      'interaction' in result.room.objects[0]! ? result.room.objects[0].interaction?.prompt : undefined,
    ).toBe('Open')
    expect(result.purposesAssigned).toBe(1)
  })

  it('leaves excluded optional-interaction types unchanged', () => {
    const room = makeRoom([
      { type: 'throne', position: [0, 0, -6] },
      { type: 'arch', position: [0, 0, -8] },
      { type: 'pillar', position: [-4, 0, -4] },
      { type: 'rug', position: [0, 0.01, 0] },
      { type: 'torch', position: [7, 2.2, -7] },
      { type: 'candle', position: [2, 0.8, 2] },
      { type: 'prop', position: [3, 0, 3] },
      { type: 'debris', position: [-3, 0, 3] },
      { type: 'barricade', position: [4, 0, 0] },
      { type: 'zombie', name: 'Shambler', position: [-4, 0, 0] },
    ])
    const originalObjects = [...room.objects]

    const result = assignGeneratedObjectPurpose(room)

    expect(result.room).toBe(room)
    expect(result.purposesAssigned).toBe(0)
    expect(result.room.objects).toEqual(originalObjects)
    expect(result.room.objects).toEqual(room.objects)
  })

  it('leaves scroll and npc unchanged', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        position: [1, 0.5, 0],
        interaction: { key: 'E', prompt: 'Read scroll', body: 'Existing scroll text.' },
      },
      {
        type: 'npc',
        name: 'Mira',
        position: [-1, 0, 0],
        interaction: { key: 'F', prompt: 'Talk', body: 'Mira waits.' },
      },
    ])
    const scroll = room.objects[0]!
    const npc = room.objects[1]!

    const result = assignGeneratedObjectPurpose(room)

    expect(result.room).toBe(room)
    expect(result.purposesAssigned).toBe(0)
    expect(result.room.objects[0]).toBe(scroll)
    expect(result.room.objects[1]).toBe(npc)
  })

  it('returns the same room reference when nothing is assigned', () => {
    const room = makeRoom([{ type: 'pillar', position: [2, 0, 2] }])

    const result = assignGeneratedObjectPurpose(room)

    expect(result.room).toBe(room)
    expect(result.purposesAssigned).toBe(0)
  })

  it('reports the number of purposes assigned', () => {
    const room = makeRoom([
      { type: 'book', position: [-3, 0.3, 0] },
      { type: 'chest', position: [-1, 0, 0] },
      {
        type: 'crate',
        position: [1, 0, 0],
        interaction: { key: 'E', prompt: 'Search', body: 'Existing crate text.' },
      },
      { type: 'statue', position: [3, 0, 0] },
      { type: 'torch', position: [7, 2.2, 7] },
    ])

    const result = assignGeneratedObjectPurpose(room)

    expect(result.purposesAssigned).toBe(3)
  })

  it('does not mutate the input room', () => {
    const room = makeRoom([
      { type: 'book', position: [-2, 0.3, 0] },
      { type: 'pillar', position: [2, 0, 0] },
    ])
    const before = cloneRoom(room)
    const originalBook = room.objects[0]!

    const result = assignGeneratedObjectPurpose(room)

    expect(result.room).not.toBe(room)
    expect(room).toEqual(before)
    expect(room.objects[0]).toBe(originalBook)
    expect(room.objects[0]).not.toHaveProperty('interaction')
  })

  it('is deterministic across repeated calls', () => {
    const room = makeRoom([
      { type: 'paper', position: [-2, 0.3, 0] },
      { type: 'artifact', position: [2, 0, 0] },
    ])

    const first = assignGeneratedObjectPurpose(room)
    const second = assignGeneratedObjectPurpose(room)
    const third = assignGeneratedObjectPurpose(first.room)

    expect(second).toEqual(first)
    expect(third.room).toBe(first.room)
    expect(third.purposesAssigned).toBe(0)
  })

  it('does not leak generated-looking object names into synthesized prompts', () => {
    const room = makeRoom([
      {
        type: 'chest',
        name: 'Vault of Nyx-779 with ProviderTrace alpha-beta',
        position: [2, 0, 0],
      },
    ])

    const result = assignGeneratedObjectPurpose(room)
    const object = result.room.objects[0]!
    const interaction = 'interaction' in object ? object.interaction : undefined

    expect(interaction).toStrictEqual({ key: 'E', prompt: 'Inspect' })
    expect(JSON.stringify(interaction)).not.toContain('Vault of Nyx-779')
    expect(JSON.stringify(interaction)).not.toContain('ProviderTrace')
  })
})
