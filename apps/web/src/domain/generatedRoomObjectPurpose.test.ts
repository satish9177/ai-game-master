import { describe, expect, it } from 'vitest'
import { assignGeneratedObjectPurpose } from './generatedRoomObjectPurpose'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

const BOOK_BODY = 'You read it and mark it as reviewed.'
const PAPER_BODY = 'You read the page and mark it as reviewed.'
const MAP_BODY = 'You study the route and mark the map as reviewed.'
const CHEST_BODY = 'You open the chest and check its authored contents.'
const CRATE_BODY = 'You open the crate and check its authored contents.'
const BARREL_BODY = 'You check the barrel and leave it visibly searched.'
const CORPSE_BODY = 'You search the remains for clues and mark them as searched.'
const TABLE_BODY = 'You inspect the work surface and mark it as searched.'
const MACHINE_BODY = 'You inspect the mechanism and leave its indicator activated.'
const ALTAR_BODY = 'You examine the altar and leave its markings activated.'
const STATUE_BODY = 'You examine the monument and mark its details as reviewed.'
const ARTIFACT_BODY = 'You examine the artifact and leave it visibly activated.'

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

function interactionAt(room: LoadedRoom, index: number): NonNullable<Extract<RoomObject, { interaction?: unknown }>['interaction']> | undefined {
  const object = room.objects[index]!
  return 'interaction' in object ? object.interaction : undefined
}

describe('assignGeneratedObjectPurpose', () => {
  it('allowlisted types synthesize key, prompt, title, and body', () => {
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
    expect(result.room.objects.map((_, index) => interactionAt(result.room, index))).toEqual([
      { key: 'E', prompt: 'Read', title: 'Read', body: BOOK_BODY, effect: { kind: 'inspect' } },
      { key: 'E', prompt: 'Read', title: 'Read', body: PAPER_BODY, effect: { kind: 'inspect' } },
      { key: 'E', prompt: 'Read', title: 'Read', body: MAP_BODY, effect: { kind: 'inspect' } },
      { key: 'E', prompt: 'Inspect', title: 'Inspect', body: CHEST_BODY, effect: { kind: 'inspect' } },
      { key: 'E', prompt: 'Inspect', title: 'Inspect', body: CRATE_BODY, effect: { kind: 'inspect' } },
      { key: 'E', prompt: 'Inspect', title: 'Inspect', body: BARREL_BODY, effect: { kind: 'inspect' } },
      { key: 'E', prompt: 'Inspect', title: 'Inspect', body: CORPSE_BODY, effect: { kind: 'inspect' } },
      { key: 'E', prompt: 'Inspect', title: 'Inspect', body: TABLE_BODY, effect: { kind: 'inspect' } },
      { key: 'E', prompt: 'Inspect', title: 'Inspect', body: MACHINE_BODY, effect: { kind: 'inspect' } },
      { key: 'E', prompt: 'Examine', title: 'Examine', body: ALTAR_BODY, effect: { kind: 'inspect' } },
      { key: 'E', prompt: 'Examine', title: 'Examine', body: STATUE_BODY, effect: { kind: 'inspect' } },
      { key: 'E', prompt: 'Examine', title: 'Examine', body: ARTIFACT_BODY, effect: { kind: 'inspect' } },
    ])
  })

  it('sets the synthesized title equal to the prompt', () => {
    const room = makeRoom([
      { type: 'book', position: [-2, 0.3, 0] },
      { type: 'machine', position: [0, 0, 0] },
      { type: 'artifact', position: [2, 0, 0] },
    ])

    const result = assignGeneratedObjectPurpose(room)

    for (let index = 0; index < result.room.objects.length; index += 1) {
      const interaction = interactionAt(result.room, index)!
      expect(interaction.title).toBe(interaction.prompt)
    }
  })

  it('uses the correct fixed body per object type group', () => {
    const room = makeRoom([
      { type: 'book', position: [-5, 0.3, 0] },
      { type: 'paper', position: [-4, 0.3, 0] },
      { type: 'map', position: [-3, 0.3, 0] },
      { type: 'chest', position: [-2, 0, 0] },
      { type: 'crate', position: [-1, 0, 0] },
      { type: 'barrel', position: [0, 0, 0] },
      { type: 'table', position: [1, 0, 0] },
      { type: 'machine', position: [2, 0, 0] },
      { type: 'altar', position: [3, 0, 0] },
      { type: 'statue', position: [4, 0, 0] },
      { type: 'artifact', position: [5, 0, 0] },
    ])

    const result = assignGeneratedObjectPurpose(room)

    expect(result.room.objects.map((_, index) => interactionAt(result.room, index)?.body)).toEqual([
      BOOK_BODY,
      PAPER_BODY,
      MAP_BODY,
      CHEST_BODY,
      CRATE_BODY,
      BARREL_BODY,
      TABLE_BODY,
      MACHINE_BODY,
      ALTAR_BODY,
      STATUE_BODY,
      ARTIFACT_BODY,
    ])
  })

  it('uses the special remains line for corpse', () => {
    const room = makeRoom([{ type: 'corpse', position: [1, 0, 0] }])

    const result = assignGeneratedObjectPurpose(room)

    expect(interactionAt(result.room, 0)).toEqual({
      key: 'E',
      prompt: 'Inspect',
      title: 'Inspect',
      body: CORPSE_BODY,
      effect: { kind: 'inspect' },
    })
  })

  it('synthesizes interactions with only safe presentation fields', () => {
    const room = makeRoom([{ type: 'machine', position: [2, 0, 0] }])

    const result = assignGeneratedObjectPurpose(room)
    const interaction = interactionAt(result.room, 0)

    expect(interaction).toStrictEqual({
      key: 'E',
      prompt: 'Inspect',
      title: 'Inspect',
      body: MACHINE_BODY,
      effect: { kind: 'inspect' },
    })
    expect(interaction?.effect).toEqual({ kind: 'inspect' })
    expect(interaction).not.toHaveProperty('encounter')
    expect(interaction).not.toHaveProperty('dialogue')
    expect(interaction).not.toHaveProperty('exit')
    expect(interaction).not.toHaveProperty('item')
    expect(interaction).not.toHaveProperty('inventory')
    expect(interaction).not.toHaveProperty('quest')
    expect(interaction).not.toHaveProperty('combat')
    expect(interaction).not.toHaveProperty('state')
    expect(interaction).not.toHaveProperty('stateMutation')
  })

  it('never overwrites existing interactions, including existing title and body', () => {
    const room = makeRoom([
      {
        type: 'chest',
        position: [2, 0, 0],
        interaction: {
          key: 'E',
          prompt: 'Open',
          title: 'Existing title',
          body: 'The latch is already marked by authored content.',
          effect: { kind: 'inspect', flag: 'chest-seen' },
        },
      },
      { type: 'book', position: [-2, 0.3, 0] },
    ])
    const existingObject = room.objects[0]!
    const existingInteraction = interactionAt(room, 0)

    const result = assignGeneratedObjectPurpose(room)

    expect(result.room.objects[0]).toBe(existingObject)
    expect(interactionAt(result.room, 0)).toBe(existingInteraction)
    expect(interactionAt(result.room, 0)).toEqual({
      key: 'E',
      prompt: 'Open',
      title: 'Existing title',
      body: 'The latch is already marked by authored content.',
      effect: { kind: 'inspect', flag: 'chest-seen' },
    })
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

  it('upgrades inspectable scrolls while preserving NPC interactions for dialogue normalization', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        position: [1, 0.5, 0],
        interaction: { key: 'E', prompt: 'Read scroll', title: 'Scroll', body: 'Existing scroll text.' },
      },
      {
        type: 'npc',
        name: 'Mira',
        position: [-1, 0, 0],
        interaction: { key: 'F', prompt: 'Talk', title: 'Mira', body: 'Mira waits.' },
      },
    ])
    const scroll = room.objects[0]!
    const npc = room.objects[1]!

    const result = assignGeneratedObjectPurpose(room)

    expect(result.room).not.toBe(room)
    expect(result.purposesAssigned).toBe(1)
    expect(interactionAt(result.room, 0)?.effect).toEqual({ kind: 'inspect' })
    expect(interactionAt(result.room, 1)).toBe(interactionAt(room, 1))
    expect(result.room.objects[0]).not.toBe(scroll)
    expect(result.room.objects[1]).toBe(npc)
    expect(result.room.objects[0]?.id).toBe('generated-inspect-scroll-0')
  })

  it('returns the same room reference when nothing is assigned', () => {
    const room = makeRoom([{ type: 'pillar', position: [2, 0, 2] }])

    const result = assignGeneratedObjectPurpose(room)

    expect(result.room).toBe(room)
    expect(result.purposesAssigned).toBe(0)
  })

  it('upgrades an allowlisted body-only interaction to a purposeful inspect effect', () => {
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

    expect(result.purposesAssigned).toBe(4)
    expect(interactionAt(result.room, 2)?.effect).toEqual({ kind: 'inspect' })
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

  it('does not leak generated-looking object names into synthesized interaction text', () => {
    const leakedText = 'ProviderTrace raw-json {"prompt":"steal-name"} generated_object_name'
    const room = makeRoom([
      {
        type: 'chest',
        name: leakedText,
        position: [2, 0, 0],
      },
    ])

    const result = assignGeneratedObjectPurpose(room)
    const interaction = interactionAt(result.room, 0)
    const serializedInteraction = JSON.stringify(interaction)

    expect(interaction).toStrictEqual({
      key: 'E',
      prompt: 'Inspect',
      title: 'Inspect',
      body: CHEST_BODY,
      effect: { kind: 'inspect' },
    })
    expect(serializedInteraction).not.toContain('ProviderTrace')
    expect(serializedInteraction).not.toContain('raw-json')
    expect(serializedInteraction).not.toContain('steal-name')
    expect(serializedInteraction).not.toContain('generated_object_name')
  })
})
