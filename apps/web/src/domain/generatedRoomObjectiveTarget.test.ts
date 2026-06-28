import { describe, expect, it } from 'vitest'
import { ensureGeneratedObjectiveTarget } from './generatedRoomObjectiveTarget'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'

function makeRoom(objects: unknown[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'objective-target-test',
    name: 'Objective Target Test',
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

function interactionAt(room: LoadedRoom, index: number) {
  const object = room.objects[index]!
  return 'interaction' in object ? object.interaction : undefined
}

function ids(room: LoadedRoom): (string | undefined)[] {
  return room.objects.map((object) => object.id)
}

describe('ensureGeneratedObjectiveTarget', () => {
  it('promotes one valid candidate', () => {
    const room = makeRoom([
      {
        type: 'book',
        id: 'target-book',
        position: [0, 0.3, 0],
        interaction: { key: 'E', prompt: 'Read', title: 'Read', body: 'Fixed body.' },
      },
      {
        type: 'paper',
        id: 'other-paper',
        position: [2, 0.3, 0],
        interaction: { key: 'E', prompt: 'Read', title: 'Read', body: 'Other body.' },
      },
    ])

    const result = ensureGeneratedObjectiveTarget(room)

    expect(result.objectiveTargetEnriched).toBe(true)
    expect(interactionAt(result.room, 0)?.effect).toEqual({ kind: 'inspect' })
    expect(interactionAt(result.room, 1)).not.toHaveProperty('effect')
  })

  it('adds deterministic id when missing', () => {
    const room = makeRoom([
      {
        type: 'map',
        position: [0, 0.3, 0],
        interaction: { key: 'E', prompt: 'Read' },
      },
    ])

    const result = ensureGeneratedObjectiveTarget(room)

    expect(result.room.objects[0]?.id).toBe('generated-objective-target')
  })

  it('preserves existing id', () => {
    const room = makeRoom([
      {
        type: 'artifact',
        id: 'existing-artifact',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Examine' },
      },
    ])

    const result = ensureGeneratedObjectiveTarget(room)

    expect(result.room.objects[0]?.id).toBe('existing-artifact')
  })

  it('uses deterministic collision suffixes', () => {
    const room = makeRoom([
      { type: 'pillar', id: 'generated-objective-target', position: [-2, 0, 0] },
      { type: 'pillar', id: 'generated-objective-target-2', position: [2, 0, 0] },
      {
        type: 'chest',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Inspect' },
      },
    ])

    const result = ensureGeneratedObjectiveTarget(room)

    expect(result.room.objects[2]?.id).toBe('generated-objective-target-3')
  })

  it('avoids deterministic id collisions with skipped raw object ids', () => {
    const room = makeRoom([
      {
        type: 'book',
        position: [0, 0.3, 0],
        interaction: { key: 'E', prompt: 'Read' },
      },
      { type: 'unknown-type', id: 'generated-objective-target', position: [1, 0, 0] },
      { type: 'unknown-type', id: 'generated-objective-target-2', position: [2, 0, 0] },
    ])

    const result = ensureGeneratedObjectiveTarget(room)

    expect(room.skipped).toHaveLength(2)
    expect(result.room.objects[0]?.id).toBe('generated-objective-target-3')
  })

  it('adds inspect effect without effect.flag', () => {
    const room = makeRoom([
      {
        type: 'table',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Inspect' },
      },
    ])

    const result = ensureGeneratedObjectiveTarget(room)
    const effect = interactionAt(result.room, 0)?.effect

    expect(effect).toEqual({ kind: 'inspect' })
    expect(effect).not.toHaveProperty('flag')
  })

  it('preserves interaction key, prompt, title, and body', () => {
    const room = makeRoom([
      {
        type: 'corpse',
        position: [0, 0, 0],
        interaction: {
          key: 'F',
          prompt: 'Search carefully',
          title: 'Existing title',
          body: 'Existing body.',
        },
      },
    ])

    const result = ensureGeneratedObjectiveTarget(room)

    expect(interactionAt(result.room, 0)).toEqual({
      key: 'F',
      prompt: 'Search carefully',
      title: 'Existing title',
      body: 'Existing body.',
      effect: { kind: 'inspect' },
    })
  })

  it('no-ops when already objective-ready', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'objective-document',
        position: [0, 0.5, 0],
        interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
      },
      {
        type: 'altar',
        position: [2, 0, 0],
        interaction: { key: 'E', prompt: 'Examine' },
      },
    ])

    const result = ensureGeneratedObjectiveTarget(room)

    expect(result.room).toBe(room)
    expect(result.objectiveTargetEnriched).toBe(false)
    expect(interactionAt(result.room, 1)).not.toHaveProperty('effect')
  })

  it('no-ops when no candidate exists', () => {
    const room = makeRoom([
      { type: 'pillar', position: [0, 0, 0] },
      { type: 'torch', position: [7, 2.2, -7] },
    ])

    const result = ensureGeneratedObjectiveTarget(room)

    expect(result.room).toBe(room)
    expect(result.objectiveTargetEnriched).toBe(false)
  })

  it('does not mutate input', () => {
    const room = makeRoom([
      {
        type: 'book',
        position: [0, 0.3, 0],
        interaction: { key: 'E', prompt: 'Read' },
      },
    ])
    const before = cloneRoom(room)
    const originalObject = room.objects[0]!

    const result = ensureGeneratedObjectiveTarget(room)

    expect(result.room).not.toBe(room)
    expect(room).toEqual(before)
    expect(room.objects[0]).toBe(originalObject)
    expect(interactionAt(room, 0)).not.toHaveProperty('effect')
  })

  it('does not change object count', () => {
    const room = makeRoom([
      {
        type: 'book',
        position: [0, 0.3, 0],
        interaction: { key: 'E', prompt: 'Read' },
      },
      { type: 'pillar', position: [2, 0, 0] },
    ])

    const result = ensureGeneratedObjectiveTarget(room)

    expect(result.room.objects).toHaveLength(room.objects.length)
  })

  it('does not change non-target objects', () => {
    const room = makeRoom([
      { type: 'pillar', id: 'pillar-1', position: [-2, 0, 0] },
      {
        type: 'book',
        position: [0, 0.3, 0],
        interaction: { key: 'E', prompt: 'Read' },
      },
      {
        type: 'paper',
        id: 'paper-1',
        position: [2, 0.3, 0],
        interaction: { key: 'E', prompt: 'Read' },
      },
    ])
    const nonTargetBefore: RoomObject[] = [room.objects[0]!, room.objects[2]!]

    const result = ensureGeneratedObjectiveTarget(room)

    expect(result.room.objects[0]).toBe(nonTargetBefore[0])
    expect(result.room.objects[2]).toBe(nonTargetBefore[1])
    expect(ids(result.room)).toEqual(['pillar-1', 'generated-objective-target', 'paper-1'])
  })

  it('never selects npc, exit, encounter, or effect objects', () => {
    const room = makeRoom([
      {
        type: 'npc',
        id: 'guide',
        name: 'Guide',
        position: [-4, 0, 0],
        interaction: { key: 'F', prompt: 'Talk' },
      },
      {
        type: 'arch',
        id: 'north-exit',
        position: [0, 0, -8],
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'next-room' } },
      },
      {
        type: 'chest',
        id: 'encounter-chest',
        position: [2, 0, 0],
        interaction: {
          key: 'E',
          prompt: 'Open',
          encounter: { description: 'A trap waits.', choices: [] },
        },
      },
      {
        type: 'crate',
        id: 'effect-crate',
        position: [4, 0, 0],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
    ])

    const result = ensureGeneratedObjectiveTarget(room)

    expect(result.room).toBe(room)
    expect(result.objectiveTargetEnriched).toBe(false)
  })

  it('uses deterministic priority and index tiebreak', () => {
    const room = makeRoom([
      {
        type: 'book',
        id: 'book-1',
        position: [-4, 0.3, 0],
        interaction: { key: 'E', prompt: 'Read' },
      },
      {
        type: 'artifact',
        id: 'artifact-1',
        position: [-2, 0, 0],
        interaction: { key: 'E', prompt: 'Examine' },
      },
      {
        type: 'statue',
        id: 'statue-1',
        position: [0, 0, 0],
        interaction: { key: 'E', prompt: 'Examine' },
      },
      {
        type: 'altar',
        id: 'altar-1',
        position: [2, 0, 0],
        interaction: { key: 'E', prompt: 'Examine' },
      },
      {
        type: 'altar',
        id: 'altar-2',
        position: [4, 0, 0],
        interaction: { key: 'E', prompt: 'Examine' },
      },
    ])

    const first = ensureGeneratedObjectiveTarget(room)
    const second = ensureGeneratedObjectiveTarget(room)

    expect(interactionAt(first.room, 3)?.effect).toEqual({ kind: 'inspect' })
    expect(interactionAt(first.room, 4)).not.toHaveProperty('effect')
    expect(second).toEqual(first)
  })
})
