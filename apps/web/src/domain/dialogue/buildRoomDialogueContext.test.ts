import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../loadRoomSpec'
import { buildRoomDialogueContext } from './buildRoomDialogueContext'

function makeRoom(objects: unknown[], name = 'Room Name That Must Not Leak'): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'room-dialogue-context-test',
    name,
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 6] },
    objects,
  })
}

const inspectInteraction = {
  key: 'E',
  prompt: 'Inspect prompt that must not leak',
  title: 'Inspect title that must not leak',
  body: 'Inspect body that must not leak',
} as const

describe('buildRoomDialogueContext', () => {
  it('selects focus from story anchor with correct type and direction', () => {
    const room = makeRoom([
      { type: 'scroll', position: [4, 0, 0], interaction: inspectInteraction },
      { type: 'altar', position: [0, 0, -5] },
    ])

    expect(buildRoomDialogueContext(room).focus).toEqual({ type: 'altar', direction: 'north' })
  })

  it('falls back to first non-exit interactable or npc when no anchor exists', () => {
    const room = makeRoom([
      { type: 'arch', position: [0, 0, -8], interaction: { key: 'E', prompt: 'Exit', exit: { toRoomId: 'next' } } },
      { type: 'crate', position: [5, 0, 0], interaction: inspectInteraction },
      { type: 'npc', name: 'Name That Must Not Leak', position: [0, 0, -4], interaction: { key: 'F', prompt: 'Talk' } },
    ])

    expect(buildRoomDialogueContext(room).focus).toEqual({ type: 'crate', direction: 'east' })
  })

  it('omits focus when no anchor/interactable/npc exists', () => {
    const room = makeRoom([
      { type: 'pillar', position: [3, 0, -3] },
      { type: 'rug', position: [0, 0.01, 2] },
    ])

    expect(buildRoomDialogueContext(room)).not.toHaveProperty('focus')
  })

  it('features include only notable allowlisted types', () => {
    const room = makeRoom([
      { type: 'corpse', position: [0, 0, -5] },
      { type: 'machine', position: [5, 0, 0] },
      { type: 'crate', position: [0, 0, 5] },
    ])

    expect(buildRoomDialogueContext(room).features).toEqual([
      { type: 'corpse', direction: 'north' },
      { type: 'machine', direction: 'east' },
    ])
  })

  it('features exclude pure decor', () => {
    const room = makeRoom([
      { type: 'pillar', position: [0, 0, -5] },
      { type: 'rug', position: [0, 0.01, 5] },
      { type: 'torch', position: [5, 3, 0] },
      { type: 'candle', position: [-5, 0, 0] },
      { type: 'prop', position: [0, 0, 0] },
      { type: 'arch', position: [0, 0, -8] },
      { type: 'altar', position: [0, 0, -4] },
    ])

    expect(buildRoomDialogueContext(room).features).toEqual([
      { type: 'altar', direction: 'north' },
    ])
  })

  it('features are deduped, capped, and deterministic', () => {
    const room = makeRoom([
      { type: 'zombie', position: [0, 0, 5] },
      { type: 'corpse', position: [0, 0, -5] },
      { type: 'corpse', position: [5, 0, 0] },
      { type: 'altar', position: [-5, 0, 0] },
      { type: 'statue', position: [5, 0, 0] },
      { type: 'throne', position: [0, 0, 0] },
      { type: 'chest', position: [0, 0, 5] },
    ])

    expect(buildRoomDialogueContext(room).features).toEqual([
      { type: 'corpse', direction: 'north' },
      { type: 'altar', direction: 'west' },
      { type: 'statue', direction: 'east' },
      { type: 'throne', direction: 'center' },
    ])
  })

  it('affordances are deduped closed values', () => {
    const room = makeRoom([
      { type: 'arch', position: [0, 0, -8], interaction: { key: 'E', prompt: 'Exit', exit: { toRoomId: 'next' } } },
      { type: 'npc', name: 'Talker', position: [0, 0, -4], interaction: { key: 'F', prompt: 'Talk' } },
      { type: 'corpse', position: [2, 0, 0], interaction: inspectInteraction },
      { type: 'paper', position: [-2, 0, 0], interaction: inspectInteraction },
      {
        type: 'zombie',
        position: [0, 0, 3],
        interaction: {
          key: 'F',
          prompt: 'Approach',
          encounter: {
            description: 'A threat blocks the way.',
            choices: [{ id: 'run', action: 'run', label: 'Run', outcome: { effects: [] } }],
          },
        },
      },
    ])

    expect(buildRoomDialogueContext(room).affordances).toEqual(['inspect', 'talk', 'exit', 'approach'])
  })

  it('npcCount counts npc objects', () => {
    const room = makeRoom([
      { type: 'npc', name: 'One', position: [0, 0, -4], interaction: { key: 'F', prompt: 'Talk' } },
      { type: 'npc', name: 'Two', position: [2, 0, -4], interaction: { key: 'F', prompt: 'Talk' } },
      { type: 'zombie', name: 'Not counted', position: [0, 0, 3] },
    ])

    expect(buildRoomDialogueContext(room).npcCount).toBe(2)
  })

  it('npcCount is capped at ten', () => {
    const npcs = Array.from({ length: 11 }, (_, index) => ({
      type: 'npc',
      name: `NPC ${index}`,
      position: [index - 5, 0, -4],
      interaction: { key: 'F', prompt: 'Talk' },
    }))

    expect(buildRoomDialogueContext(makeRoom(npcs)).npcCount).toBe(10)
  })

  it('empty room returns features, affordances, npcCount, and no focus safely', () => {
    expect(buildRoomDialogueContext(makeRoom([]))).toEqual({
      features: [],
      affordances: [],
      npcCount: 0,
    })
  })

  it('does not leak object names, room names, interaction text, or other free text into output', () => {
    const base = makeRoom([
      {
        type: 'npc',
        name: 'First Secret Name',
        position: [0, 0, -4],
        interaction: {
          key: 'F',
          prompt: 'First secret prompt',
          title: 'First secret title',
          body: 'First secret body',
          dialogue: {
            persona: 'First persona',
            greeting: 'First greeting',
            prompts: [{ id: 'first-id', label: 'First label' }],
          },
        },
      },
      {
        type: 'corpse',
        position: [0, 0, 5],
        interaction: {
          key: 'E',
          prompt: 'First corpse prompt',
          title: 'First corpse title',
          body: 'First corpse body',
        },
      },
    ], 'First Secret Room Name')
    const changedText = makeRoom([
      {
        type: 'npc',
        name: 'Second Secret Name',
        position: [0, 0, -4],
        interaction: {
          key: 'F',
          prompt: 'Second secret prompt',
          title: 'Second secret title',
          body: 'Second secret body',
          dialogue: {
            persona: 'Second persona',
            greeting: 'Second greeting',
            prompts: [{ id: 'second-id', label: 'Second label' }],
          },
        },
      },
      {
        type: 'corpse',
        position: [0, 0, 5],
        interaction: {
          key: 'E',
          prompt: 'Second corpse prompt',
          title: 'Second corpse title',
          body: 'Second corpse body',
        },
      },
    ], 'Second Secret Room Name')

    expect(buildRoomDialogueContext(changedText)).toEqual(buildRoomDialogueContext(base))
  })

  it('does not mutate input', () => {
    const room = makeRoom([
      { type: 'corpse', position: [0, 0, -5], interaction: inspectInteraction },
      { type: 'npc', name: 'NPC', position: [4, 0, 0], interaction: { key: 'F', prompt: 'Talk' } },
    ])
    const before = structuredClone(room)

    buildRoomDialogueContext(room)

    expect(room).toEqual(before)
  })

  it('is deterministic across repeated calls', () => {
    const room = makeRoom([
      { type: 'corpse', position: [0, 0, -5], interaction: inspectInteraction },
      { type: 'npc', name: 'NPC', position: [4, 0, 0], interaction: { key: 'F', prompt: 'Talk' } },
    ])
    const first = buildRoomDialogueContext(room)

    expect(buildRoomDialogueContext(room)).toEqual(first)
    expect(buildRoomDialogueContext(room)).toEqual(first)
  })
})
