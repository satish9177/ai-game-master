import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import { sanitizeGeneratedDisplayText } from './sanitizeGeneratedDisplayText'

function makeRoom(objects: unknown[] = [], overrides: Partial<Parameters<typeof loadRoomSpec>[0]> = {}): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'adjacent:gen-abc12345:exit:north',
    name: 'Generated room',
    shell: {
      dimensions: { width: 18, depth: 18, height: 5 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 6], yaw: 180 },
    lighting: {},
    objects,
    ...overrides,
  })
}

function firstObject(room: LoadedRoom): LoadedRoom['objects'][number] {
  const object = room.objects[0]
  if (object == null) throw new Error('expected object')
  return object
}

function interactionOf(object: LoadedRoom['objects'][number]) {
  if (!('interaction' in object) || object.interaction == null) {
    throw new Error('expected interaction')
  }
  return object.interaction
}

describe('sanitizeGeneratedDisplayText', () => {
  it('sanitizes room.name containing a generated structural id to fixed safe text', () => {
    const room = makeRoom([], { name: 'Generated room - adjacent:gen-abc12345:exit:north' })

    const result = sanitizeGeneratedDisplayText(room)

    expect(result.room.name).toBe('Generated room')
    expect(result.displayTextSanitized).toBe(true)
    expect(result.displayTextSanitizationCount).toBe(1)
  })

  it('sanitizes interaction.body and preserves surrounding text', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'scroll-1',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Read',
          body: 'The scroll reads: "adjacent:gen-83d18466:exit:north"',
        },
      },
    ])

    const result = sanitizeGeneratedDisplayText(room)
    const object = firstObject(result.room)

    expect(interactionOf(object).body).toBe('The scroll reads: "a nearby room"')
    expect(result.displayTextSanitizationCount).toBe(1)
  })

  it('sanitizes interaction.prompt and interaction.title', () => {
    const room = makeRoom([
      {
        type: 'book',
        id: 'book-1',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Open gen-abc12345',
          title: 'Generated room - adjacent:gen-abc12345',
          body: 'Clean body',
        },
      },
    ])

    const result = sanitizeGeneratedDisplayText(room)
    const object = firstObject(result.room)

    expect(interactionOf(object).prompt).toBe('Open a nearby room')
    expect(interactionOf(object).title).toBe('Generated room - a nearby room')
    expect(result.displayTextSanitizationCount).toBe(2)
  })

  it('sanitizes npc and zombie names if contaminated', () => {
    const room = makeRoom([
      {
        type: 'npc',
        id: 'npc-1',
        name: 'Keeper adjacent:gen-abc12345:exit:north',
        position: [1, 0, -2],
        interaction: { key: 'F', prompt: 'Talk' },
      },
      {
        type: 'zombie',
        id: 'zombie-1',
        name: 'Shambler gen-abc12345',
        position: [-1, 0, -2],
      },
    ])

    const result = sanitizeGeneratedDisplayText(room)

    expect(result.room.objects[0]).toMatchObject({ name: 'Keeper a nearby room' })
    expect(result.room.objects[1]).toMatchObject({ name: 'Shambler a nearby room' })
    expect(result.displayTextSanitizationCount).toBe(2)
  })

  it('sanitizes dialogue greeting and dialogue prompt labels', () => {
    const room = makeRoom([
      {
        type: 'npc',
        id: 'npc-1',
        name: 'Mira',
        position: [1, 0, -2],
        interaction: {
          key: 'F',
          prompt: 'Talk',
          dialogue: {
            persona: 'adjacent:gen-abc12345:exit:north',
            greeting: 'I came from gen-abc12345:exit:north',
            prompts: [
              { id: 'ask-adjacent:gen-abc12345', label: 'Ask about adjacent:gen-abc12345' },
              { id: 'clean-id', label: 'Clean label' },
            ],
          },
        },
      },
    ])

    const result = sanitizeGeneratedDisplayText(room)
    const object = firstObject(result.room)
    const dialogue = interactionOf(object).dialogue

    expect(dialogue?.greeting).toBe('I came from a nearby room')
    expect(dialogue?.prompts?.[0]).toEqual({
      id: 'ask-adjacent:gen-abc12345',
      label: 'Ask about a nearby room',
    })
    expect(dialogue?.persona).toBe('adjacent:gen-abc12345:exit:north')
    expect(result.displayTextSanitizationCount).toBe(2)
  })

  it('handles chained suffixes and generated-exit variants', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'scroll-1',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Trace adjacent:gen-abc12345:exit:north:exit:south',
          body: 'Door gen-abc12345:generated-exit:west:2 waits',
        },
      },
    ])

    const result = sanitizeGeneratedDisplayText(room)
    const object = firstObject(result.room)

    expect(interactionOf(object).prompt).toBe('Trace a nearby room')
    expect(interactionOf(object).body).toBe('Door a nearby room waits')
    expect(result.displayTextSanitizationCount).toBe(2)
  })

  it('does not change structural fields', () => {
    const room = makeRoom([
      {
        type: 'arch',
        id: 'adjacent:gen-abc12345:exit:north',
        position: [0, 0, -9],
        interaction: {
          key: 'E',
          prompt: 'Enter adjacent:gen-abc12345:exit:north',
          exit: { toRoomId: 'adjacent:gen-abc12345:exit:north' },
        },
      },
    ])

    const result = sanitizeGeneratedDisplayText(room)
    const object = firstObject(result.room)

    expect(result.room.id).toBe('adjacent:gen-abc12345:exit:north')
    expect(object.id).toBe('adjacent:gen-abc12345:exit:north')
    expect(object.type).toBe('arch')
    expect(interactionOf(object).key).toBe('E')
    expect(interactionOf(object).exit?.toRoomId).toBe('adjacent:gen-abc12345:exit:north')
    expect(interactionOf(object).prompt).toBe('Enter a nearby room')
    expect(result.displayTextSanitizationCount).toBe(1)
  })

  it('does not mutate input', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'scroll-1',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Read adjacent:gen-abc12345:exit:north',
          body: 'Clean body',
        },
      },
    ])
    const before = structuredClone(room)

    sanitizeGeneratedDisplayText(room)

    expect(room).toEqual(before)
  })

  it('returns the same room reference when room is clean', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'scroll-1',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Read',
          title: 'Old parchment',
          body: 'The next chamber is quiet.',
        },
      },
    ])

    const result = sanitizeGeneratedDisplayText(room)

    expect(result.room).toBe(room)
    expect(result.displayTextSanitized).toBe(false)
    expect(result.displayTextSanitizationCount).toBe(0)
  })

  it('is deterministic for the same input', () => {
    const room = makeRoom([
      {
        type: 'npc',
        id: 'npc-1',
        name: 'Mira gen-abc12345',
        position: [1, 0, -2],
        interaction: {
          key: 'F',
          prompt: 'Talk gen-abc12345:exit:north',
          dialogue: {
            greeting: 'Welcome adjacent:gen-abc12345',
            prompts: [{ id: 'ask-room', label: 'Ask gen-abc12345:2' }],
          },
        },
      },
    ])

    const first = sanitizeGeneratedDisplayText(room)
    const second = sanitizeGeneratedDisplayText(room)

    expect(second).toEqual(first)
  })

  it('does not false-positive normal words', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'scroll-1',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'generator generated north exit the next chamber',
          title: 'Generated room \u2014 a dusty crypt',
          body: 'The generator generated an exit north of the next chamber.',
        },
      },
    ], { name: 'Generated room \u2014 a dusty crypt' })

    const result = sanitizeGeneratedDisplayText(room)

    expect(result.room).toBe(room)
    expect(result.displayTextSanitized).toBe(false)
    expect(result.displayTextSanitizationCount).toBe(0)
  })

  it('counts changed display string fields, not token occurrences', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'scroll-1',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Read gen-abc12345 and adjacent:gen-abc12345:exit:north',
          title: 'Clean title',
          body: 'Body gen-abc12345:exit:east and gen-abc12345:exit:west',
        },
      },
    ], { name: 'Generated room - gen-abc12345 and gen-abc12345:2' })

    const result = sanitizeGeneratedDisplayText(room)

    expect(result.room.name).toBe('Generated room')
    expect(result.displayTextSanitizationCount).toBe(3)
    expect(result.displayTextSanitized).toBe(true)
  })
})
