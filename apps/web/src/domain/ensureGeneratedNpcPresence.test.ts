import { describe, expect, it } from 'vitest'
import { buildDialogueLookup } from '../app/dialogue'
import { ensureGeneratedNpcDialogue, ensureGeneratedNpcPresence } from './ensureGeneratedNpcPresence'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'
import { validateRoom } from './validateRoom'

const EAST_FLANK: [number, number, number] = [4.050000000000001, 0, 0]
const WEST_FLANK: [number, number, number] = [-4.050000000000001, 0, 0]
const DEFAULT_NAMES = ['Nara', 'Oren', 'Lio', 'Tessa']
const FANTASY_NAMES = ['Elian', 'Seris', 'Tovan', 'Maera']
const POST_APOC_NAMES = ['Pax', 'Ren', 'Juno', 'Calder']
const DEFAULT_PERSONAS = ['generated-room-guide', 'generated-calm-witness']
const FANTASY_PERSONAS = ['generated-keep-warden', 'generated-archive-aide']
const POST_APOC_PERSONAS = ['generated-wasteland-scout', 'generated-shelter-watch']
const GENERIC_ROOM_PROMPTS = [
  'What should I look at first?',
  'What stands out to you here?',
  'What feels important in this room?',
]
const HELP_PROMPTS = [
  'Can you guide me?',
  'What should I do next?',
  'Can you watch my back?',
  'How can you help?',
]
const ALTAR_PROMPTS = ['What was this altar used for?', 'What kind of ritual happened here?']
const MACHINE_PROMPTS = ['What is this machine for?', 'Is the machine still dangerous?']

function roomWith(objects: unknown[], overrides: Partial<Parameters<typeof loadRoomSpec>[0]> = {}): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'generated-room',
    name: 'Secret Room Name',
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

function insertedNpc(room: LoadedRoom): Extract<RoomObject, { type: 'npc' }> {
  const npc = room.objects.find((object) => object.type === 'npc')
  if (npc?.type !== 'npc') throw new Error('expected inserted npc')
  return npc
}

function ensureInserted(
  room: LoadedRoom,
  options: Omit<Parameters<typeof ensureGeneratedNpcPresence>[1], 'requested'> = {},
): LoadedRoom {
  const result = ensureGeneratedNpcPresence(room, { requested: true, ...options })
  expect(result.npcInserted).toBe(true)
  return result.room
}

function visibleNpcText(npc: Extract<RoomObject, { type: 'npc' }>): string {
  return JSON.stringify({
    name: npc.name,
    prompt: npc.interaction.prompt,
    body: npc.interaction.body,
    greeting: npc.interaction.dialogue?.greeting,
    prompts: npc.interaction.dialogue?.prompts,
  })
}

describe('ensureGeneratedNpcPresence', () => {
  it('requested false returns the same room reference and npcInserted false', () => {
    const room = roomWith([])
    const result = ensureGeneratedNpcPresence(room, { requested: false })
    expect(result).toEqual({ room, npcInserted: false })
    expect(result.room).toBe(room)
  })

  it('requested true with no existing NPC inserts exactly one NPC', () => {
    const room = roomWith([{ type: 'altar', position: [0, 0, -4] }])
    const result = ensureGeneratedNpcPresence(room, { requested: true })

    expect(result.npcInserted).toBe(true)
    expect(result.room).not.toBe(room)
    expect(result.room.objects.filter((object) => object.type === 'npc')).toHaveLength(1)
  })

  it('preserves an existing NPC and inserts no second NPC', () => {
    const room = roomWith([
      {
        type: 'npc',
        id: 'existing-npc',
        name: 'Asha',
        position: [2, 0, 0],
        interaction: {
          key: 'F',
          prompt: 'Press F to talk to Asha',
          body: 'Asha watches the hall.',
          dialogue: { greeting: 'Welcome.' },
        },
      },
    ])

    const result = ensureGeneratedNpcPresence(room, { requested: true })

    expect(result.room).toBe(room)
    expect(result.npcInserted).toBe(false)
    expect(result.room.objects.filter((object) => object.type === 'npc')).toHaveLength(1)
  })

  it('inserts a valid authored-style NPC for TALK and dialogue routing', () => {
    const room = ensureInserted(roomWith([]))
    const npc = insertedNpc(room)
    const lookup = buildDialogueLookup(room)

    expect(npc).toMatchObject({
      type: 'npc',
      id: 'generated-npc',
      color: '#597a9b',
      interaction: {
        key: 'F',
        dialogue: {
          prompts: [
            { id: 'ask-room', label: expect.any(String) },
            { id: 'ask-help', label: expect.any(String) },
          ],
        },
      },
    })
    expect(DEFAULT_NAMES).toContain(npc.name)
    expect(npc.interaction.prompt).toBe(`Press F to talk to ${npc.name}`)
    expect(npc.interaction.body).toContain(npc.name)
    expect(DEFAULT_PERSONAS).toContain(npc.interaction.dialogue?.persona)
    expect(npc.interaction.dialogue?.greeting).toContain(npc.name)
    expect(GENERIC_ROOM_PROMPTS).toContain(npc.interaction.dialogue?.prompts?.[0]?.label)
    expect(HELP_PROMPTS).toContain(npc.interaction.dialogue?.prompts?.[1]?.label)
    expect(lookup.get('generated-npc')).toEqual({
      npcId: 'generated-npc',
      npcName: npc.name,
      persona: npc.interaction.dialogue?.persona,
      dialogue: npc.interaction.dialogue,
    })
  })

  it('uses a collision-checked stable id', () => {
    const room = ensureInserted(roomWith([{ type: 'crate', id: 'generated-npc', position: [0, 0, -2] }]))
    expect(insertedNpc(room).id).toBe('generated-npc-2')
  })

  it('inserted room passes existing load and validation path', () => {
    const room = ensureInserted(roomWith([{ type: 'book', position: [0, 0, -2] }]))
    const reloaded = loadRoomSpec(room)
    const validation = validateRoom(reloaded)

    expect(reloaded.skipped).toEqual([])
    expect(validation.ok).toBe(true)
  })

  it('placement avoids player spawn', () => {
    const room = ensureInserted(roomWith([], { spawn: { position: [EAST_FLANK[0], 1.7, 0], yaw: 90 } }))
    expect(insertedNpc(room).position).toEqual(WEST_FLANK)
  })

  it('placement avoids exits', () => {
    const room = ensureInserted(roomWith([
      {
        type: 'arch',
        id: 'side-exit',
        position: EAST_FLANK,
        interaction: { key: 'E', prompt: 'Leave', exit: { toRoomId: 'next-room' } },
      },
    ]))

    expect(insertedNpc(room).position).toEqual(WEST_FLANK)
  })

  it('placement avoids occupied blocking objects', () => {
    const room = ensureInserted(roomWith([{ type: 'pillar', position: EAST_FLANK }]))
    expect(insertedNpc(room).position).toEqual(WEST_FLANK)
  })

  it('no safe tile returns the same room reference and npcInserted false', () => {
    const blockers = [
      [4.050000000000001, 0],
      [-4.050000000000001, 0],
      [4.050000000000001, -2.835],
      [-4.050000000000001, -2.835],
      [4.050000000000001, 2.835],
      [-4.050000000000001, 2.835],
      [0, -3.6450000000000005],
      [0, 3.6450000000000005],
    ].map(([x, z], index) => ({ type: 'pillar', id: `blocker-${index}`, position: [x, 0, z] }))
    const room = roomWith(blockers)

    const result = ensureGeneratedNpcPresence(room, { requested: true })

    expect(result.room).toBe(room)
    expect(result.npcInserted).toBe(false)
  })

  it('is deterministic for the same input', () => {
    const room = roomWith([{ type: 'altar', position: [0, 0, -4] }])

    const first = ensureGeneratedNpcPresence(room, { requested: true })
    const second = ensureGeneratedNpcPresence(room, { requested: true })

    expect(second).toEqual(first)
  })

  it('same room and same options gives identical generated NPC', () => {
    const room = roomWith([{ type: 'machine', position: [0, 0, -4] }], { id: 'stable-room' })

    const first = insertedNpc(ensureInserted(room, { themePack: 'post-apoc' }))
    const second = insertedNpc(ensureInserted(room, { themePack: 'post-apoc' }))

    expect(second).toEqual(first)
  })

  it('different room ids can produce different names and prompts from the same default pool', () => {
    const npcs = Array.from({ length: 8 }, (_, index) =>
      insertedNpc(ensureInserted(roomWith([], { id: `default-room-${index}` }))))

    expect(new Set(npcs.map((npc) => npc.name)).size).toBeGreaterThan(1)
    expect(new Set(npcs.map((npc) => npc.interaction.dialogue?.prompts?.[1]?.label)).size)
      .toBeGreaterThan(1)
    for (const npc of npcs) {
      expect(DEFAULT_NAMES).toContain(npc.name)
      expect(GENERIC_ROOM_PROMPTS).toContain(npc.interaction.dialogue?.prompts?.[0]?.label)
      expect(HELP_PROMPTS).toContain(npc.interaction.dialogue?.prompts?.[1]?.label)
    }
  })

  it('undefined theme uses the default pool without always producing Mira', () => {
    const npc = insertedNpc(ensureInserted(roomWith([], { id: 'default-theme-room' })))

    expect(DEFAULT_NAMES).toContain(npc.name)
    expect(npc.name).not.toBe('Mira')
    expect(npc.interaction.dialogue?.greeting).not.toContain('Mira')
  })

  it('fantasy-keep theme produces fantasy-themed name, persona, and greeting', () => {
    const npc = insertedNpc(ensureInserted(
      roomWith([{ type: 'altar', position: [0, 0, -4] }], { id: 'fantasy-room' }),
      { themePack: 'fantasy-keep' },
    ))

    expect(FANTASY_NAMES).toContain(npc.name)
    expect(FANTASY_PERSONAS).toContain(npc.interaction.dialogue?.persona)
    expect(npc.interaction.dialogue?.greeting).toMatch(/sworn|Tread softly/)
    expect(ALTAR_PROMPTS).toContain(npc.interaction.dialogue?.prompts?.[0]?.label)
  })

  it('post-apoc theme produces post-apoc-themed name, persona, and greeting', () => {
    const npc = insertedNpc(ensureInserted(
      roomWith([{ type: 'machine', position: [0, 0, -4] }], { id: 'post-apoc-room' }),
      { themePack: 'post-apoc' },
    ))

    expect(POST_APOC_NAMES).toContain(npc.name)
    expect(POST_APOC_PERSONAS).toContain(npc.interaction.dialogue?.persona)
    expect(npc.interaction.dialogue?.greeting).toMatch(/Stay sharp|Keep low/)
    expect(MACHINE_PROMPTS).toContain(npc.interaction.dialogue?.prompts?.[0]?.label)
  })

  it('prompt ids remain ask-room and ask-help', () => {
    const npc = insertedNpc(ensureInserted(roomWith([{ type: 'altar', position: [0, 0, -4] }])))

    expect(npc.interaction.dialogue?.prompts?.map((prompt) => prompt.id))
      .toEqual(['ask-room', 'ask-help'])
  })

  it('story-anchor object type influences prompt-1 label when present', () => {
    const altarNpc = insertedNpc(ensureInserted(roomWith([
      { type: 'altar', position: [0, 0, -4] },
      { type: 'book', position: [2, 0, -2] },
    ], { id: 'altar-anchor-room' })))
    const machineNpc = insertedNpc(ensureInserted(
      roomWith([
        { type: 'machine', position: [0, 0, -4] },
        { type: 'paper', position: [2, 0, -2] },
      ], { id: 'machine-anchor-room' }),
      { themePack: 'post-apoc' },
    ))

    expect(ALTAR_PROMPTS).toContain(altarNpc.interaction.dialogue?.prompts?.[0]?.label)
    expect(MACHINE_PROMPTS).toContain(machineNpc.interaction.dialogue?.prompts?.[0]?.label)
  })

  it('no-anchor fallback still produces a safe generic prompt', () => {
    const npc = insertedNpc(ensureInserted(roomWith([{ type: 'pillar', position: [0, 0, -4] }])))

    expect(GENERIC_ROOM_PROMPTS).toContain(npc.interaction.dialogue?.prompts?.[0]?.label)
  })

  it('does not leak generated room or existing object text into inserted NPC strings', () => {
    const room = roomWith([
      {
        type: 'book',
        id: 'object-secret-id',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'PROMPT_SECRET_MARKER',
          title: 'TITLE_SECRET_MARKER',
          body: 'BODY_SECRET_MARKER {"raw":"json"}',
        },
      },
      { type: 'zombie', name: 'ZOMBIE_SECRET_NAME', position: [1, 0, -2] },
    ], {
      id: 'secret-room-id',
      name: 'Secret Room Name',
    })

    const npcJson = visibleNpcText(insertedNpc(ensureInserted(room)))

    for (const forbidden of [
      'secret-room-id',
      'Secret Room Name',
      'object-secret-id',
      'PROMPT_SECRET_MARKER',
      'TITLE_SECRET_MARKER',
      'BODY_SECRET_MARKER',
      'ZOMBIE_SECRET_NAME',
      '{"raw":"json"}',
      'generated-room-guide',
    ]) {
      expect(npcJson).not.toContain(forbidden)
    }
  })

  it('does not mutate input room', () => {
    const room = roomWith([{ type: 'altar', position: [0, 0, -4] }])
    const before = structuredClone(room)

    ensureGeneratedNpcPresence(room, { requested: true })

    expect(room).toEqual(before)
  })
})

describe('ensureGeneratedNpcDialogue', () => {
  it('generator-style NPC with no id and no dialogue gets id and dialogue', () => {
    const room = roomWith([
      {
        type: 'npc',
        name: 'Caretaker',
        position: [0, 0, 0],
        interaction: { key: 'F', prompt: 'Press F to talk', body: 'Caretaker waits.' },
      },
    ])

    const result = ensureGeneratedNpcDialogue(room)
    const npc = insertedNpc(result.room)

    expect(result.npcDialogueNormalizedCount).toBe(1)
    expect(npc.id).toBe('generated-npc')
    expect(npc.interaction.dialogue).toEqual({
      persona: expect.any(String),
      greeting: expect.any(String),
      prompts: [
        { id: 'ask-room', label: expect.any(String) },
        { id: 'ask-help', label: expect.any(String) },
      ],
    })
  })

  it('NPC with non-empty id but no dialogue gets dialogue and preserves id byte-identical', () => {
    const room = roomWith([
      {
        type: 'npc',
        id: 'npc-existing-id',
        name: 'Caretaker',
        position: [1, 0, 0],
        interaction: { key: 'F', prompt: 'Prompt text', body: 'Body text' },
      },
    ])

    const result = ensureGeneratedNpcDialogue(room)
    const npc = insertedNpc(result.room)

    expect(result.npcDialogueNormalizedCount).toBe(1)
    expect(npc.id).toBe('npc-existing-id')
    expect(npc.interaction.dialogue).toBeDefined()
  })

  it('NPC with existing dialogue but missing id gets id, preserves dialogue, and appears in lookup', () => {
    const room = roomWith([
      {
        type: 'npc',
        name: 'Caretaker',
        position: [0, 0, 0],
        interaction: {
          key: 'F',
          prompt: 'Talk',
          dialogue: {
            persona: 'existing-persona',
            greeting: 'Existing greeting.',
            prompts: [{ id: 'custom', label: 'Custom prompt' }],
          },
        },
      },
    ])
    const existingDialogue = insertedNpc(room).interaction.dialogue

    const result = ensureGeneratedNpcDialogue(room)
    const npc = insertedNpc(result.room)
    const lookup = buildDialogueLookup(result.room)

    expect(result.room).not.toBe(room)
    expect(result.npcDialogueNormalizedCount).toBe(0)
    expect(npc.id).toBe('generated-npc')
    expect(npc.interaction.dialogue).toBe(existingDialogue)
    expect(npc.interaction.dialogue).toEqual(existingDialogue)
    expect(lookup.size).toBeGreaterThanOrEqual(1)
    expect(lookup.get('generated-npc')?.dialogue).toBe(existingDialogue)
  })

  it('NPC with existing dialogue but blank id gets id, preserves dialogue, and appears in lookup', () => {
    const room = roomWith([
      {
        type: 'npc',
        id: '   ',
        name: 'Caretaker',
        position: [0, 0, 0],
        interaction: {
          key: 'F',
          prompt: 'Talk',
          dialogue: {
            persona: 'existing-persona',
            greeting: 'Existing greeting.',
            prompts: [{ id: 'custom', label: 'Custom prompt' }],
          },
        },
      },
    ])
    const existingDialogue = insertedNpc(room).interaction.dialogue

    const result = ensureGeneratedNpcDialogue(room)
    const npc = insertedNpc(result.room)
    const lookup = buildDialogueLookup(result.room)

    expect(result.npcDialogueNormalizedCount).toBe(0)
    expect(npc.id).toBe('generated-npc')
    expect(npc.interaction.dialogue).toBe(existingDialogue)
    expect(npc.interaction.dialogue).toEqual(existingDialogue)
    expect(lookup.get('generated-npc')?.dialogue).toBe(existingDialogue)
  })

  it('NPC already has dialogue is unchanged byte-identical and count is 0', () => {
    const room = roomWith([
      {
        type: 'npc',
        id: 'talking-npc',
        name: 'Asha',
        position: [0, 0, 0],
        interaction: {
          key: 'F',
          prompt: 'Talk',
          body: 'Asha waits.',
          dialogue: {
            persona: 'existing-persona',
            greeting: 'Existing greeting.',
            prompts: [{ id: 'custom', label: 'Custom prompt' }],
          },
        },
      },
    ])

    const beforeNpc = insertedNpc(room)
    const result = ensureGeneratedNpcDialogue(room)

    expect(result.room).toBe(room)
    expect(result.npcDialogueNormalizedCount).toBe(0)
    expect(insertedNpc(result.room)).toEqual(beforeNpc)
    expect(insertedNpc(result.room).interaction.dialogue).toBe(beforeNpc.interaction.dialogue)
  })

  it('multiple id-less NPCs get distinct ids and count equals normalized NPCs', () => {
    const room = roomWith([
      {
        type: 'npc',
        name: 'One',
        position: [-2, 0, 0],
        interaction: { key: 'F', prompt: 'Talk one' },
      },
      {
        type: 'npc',
        id: '   ',
        name: 'Two',
        position: [2, 0, 0],
        interaction: { key: 'F', prompt: 'Talk two' },
      },
      { type: 'crate', id: 'generated-npc', position: [0, 0, -2] },
    ])

    const result = ensureGeneratedNpcDialogue(room)
    const npcs = result.room.objects.filter((object): object is Extract<RoomObject, { type: 'npc' }> =>
      object.type === 'npc')

    expect(result.npcDialogueNormalizedCount).toBe(2)
    expect(npcs.map((npc) => npc.id)).toEqual(['generated-npc-2', 'generated-npc-3'])
    expect(new Set(npcs.map((npc) => npc.id)).size).toBe(2)
  })

  it('existing ids are preserved', () => {
    const room = roomWith([
      {
        type: 'npc',
        id: 'alpha',
        name: 'Alpha',
        position: [-2, 0, 0],
        interaction: { key: 'F', prompt: 'Talk alpha' },
      },
      {
        type: 'npc',
        id: 'beta',
        name: 'Beta',
        position: [2, 0, 0],
        interaction: { key: 'F', prompt: 'Talk beta' },
      },
    ])

    const result = ensureGeneratedNpcDialogue(room)
    const ids = result.room.objects
      .filter((object): object is Extract<RoomObject, { type: 'npc' }> => object.type === 'npc')
      .map((npc) => npc.id)

    expect(ids).toEqual(['alpha', 'beta'])
  })

  it('prompt IDs are exactly ask-room and ask-help', () => {
    const room = roomWith([
      {
        type: 'npc',
        id: 'quiet-npc',
        name: 'Quiet',
        position: [0, 0, 0],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ])

    const npc = insertedNpc(ensureGeneratedNpcDialogue(room).room)

    expect(npc.interaction.dialogue?.prompts?.map((prompt) => prompt.id))
      .toEqual(['ask-room', 'ask-help'])
  })

  it('anchor-present room influences ask-room label', () => {
    const room = roomWith([
      { type: 'altar', position: [0, 0, -4] },
      {
        type: 'npc',
        id: 'anchor-npc',
        name: 'Anchor',
        position: [2, 0, 0],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ])

    const npc = insertedNpc(ensureGeneratedNpcDialogue(room).room)

    expect(ALTAR_PROMPTS).toContain(npc.interaction.dialogue?.prompts?.[0]?.label)
  })

  it('no-anchor room uses generic safe prompt', () => {
    const room = roomWith([
      { type: 'pillar', position: [0, 0, -4] },
      {
        type: 'npc',
        id: 'generic-npc',
        name: 'Generic',
        position: [2, 0, 0],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ])

    const npc = insertedNpc(ensureGeneratedNpcDialogue(room).room)

    expect(GENERIC_ROOM_PROMPTS).toContain(npc.interaction.dialogue?.prompts?.[0]?.label)
  })

  it('is deterministic for repeated calls with the same input', () => {
    const room = roomWith([
      { type: 'machine', position: [0, 0, -4] },
      {
        type: 'npc',
        name: 'Repeatable',
        position: [2, 0, 0],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ], { id: 'repeatable-room' })

    const first = ensureGeneratedNpcDialogue(room, { themePack: 'post-apoc' })
    const second = ensureGeneratedNpcDialogue(room, { themePack: 'post-apoc' })

    expect(second).toEqual(first)
  })

  it('does not mutate input room', () => {
    const room = roomWith([
      {
        type: 'npc',
        name: 'Pure',
        position: [0, 0, 0],
        interaction: { key: 'F', prompt: 'Talk', body: 'Pure body.' },
      },
    ])
    const before = structuredClone(room)

    ensureGeneratedNpcDialogue(room)

    expect(room).toEqual(before)
  })

  it('does not leak room, object, provider, prompt, memory, gate, or flag text into added dialogue', () => {
    const room = roomWith([
      {
        type: 'book',
        id: 'object-secret-id',
        position: [0, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'OBJECT_PROMPT_SECRET',
          title: 'OBJECT_TITLE_SECRET',
          body: 'OBJECT_BODY_SECRET generated-description-secret',
          effect: { kind: 'inspect', flag: 'secret_flag_key' },
        },
      },
      {
        type: 'arch',
        id: 'gate-secret-id',
        position: [3, 0, -3],
        interaction: { key: 'E', prompt: 'Gate', exit: { toRoomId: 'secret-gate-target' } },
      },
      { type: 'zombie', name: 'OTHER_OBJECT_SECRET_NAME', position: [1, 0, -2] },
      {
        type: 'npc',
        name: 'NPC_SECRET_NAME',
        position: [2, 0, 0],
        interaction: {
          key: 'F',
          prompt: 'NPC_PROMPT_SECRET user-prompt-secret',
          body: 'NPC_BODY_SECRET provider-text-secret memory-text-secret',
        },
      },
    ], {
      id: 'room-secret-id',
      name: 'ROOM_SECRET_NAME',
    })

    const npc = insertedNpc(ensureGeneratedNpcDialogue(room).room)
    const dialogueJson = JSON.stringify(npc.interaction.dialogue)

    for (const forbidden of [
      'room-secret-id',
      'ROOM_SECRET_NAME',
      'object-secret-id',
      'OBJECT_PROMPT_SECRET',
      'OBJECT_TITLE_SECRET',
      'OBJECT_BODY_SECRET',
      'generated-description-secret',
      'gate-secret-id',
      'secret-gate-target',
      'secret_flag_key',
      'OTHER_OBJECT_SECRET_NAME',
      'NPC_SECRET_NAME',
      'NPC_PROMPT_SECRET',
      'NPC_BODY_SECRET',
      'user-prompt-secret',
      'provider-text-secret',
      'memory-text-secret',
    ]) {
      expect(dialogueJson).not.toContain(forbidden)
    }
  })

  it('preserves NPC name, prompt, body, position, and non-NPC objects', () => {
    const room = roomWith([
      { type: 'crate', id: 'crate-a', position: [0, 0, -2] },
      {
        type: 'npc',
        id: 'preserved-npc',
        name: 'Preserved Name',
        position: [2, 0, 0],
        interaction: {
          key: 'F',
          prompt: 'Preserved prompt',
          body: 'Preserved body',
        },
      },
    ])
    const beforeNpc = insertedNpc(room)
    const beforeCrate = room.objects[0]

    const result = ensureGeneratedNpcDialogue(room)
    const npc = insertedNpc(result.room)

    expect(npc.name).toBe(beforeNpc.name)
    expect(npc.interaction.prompt).toBe(beforeNpc.interaction.prompt)
    expect(npc.interaction.body).toBe(beforeNpc.interaction.body)
    expect(npc.position).toEqual(beforeNpc.position)
    expect(result.room.objects[0]).toBe(beforeCrate)
    expect(result.room.objects[0]).toEqual(beforeCrate)
  })

  it('makes at least one generated-room NPC visible to buildDialogueLookup', () => {
    const room = roomWith([
      {
        type: 'npc',
        name: 'Visible',
        position: [0, 0, 0],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ], { id: 'generated-lookup-room' })

    const result = ensureGeneratedNpcDialogue(room)
    const lookup = buildDialogueLookup(result.room)

    expect(result.room.objects.some((object) => object.type === 'npc')).toBe(true)
    expect(lookup.size).toBeGreaterThanOrEqual(1)
    expect(lookup.get('generated-npc')).toMatchObject({
      npcId: 'generated-npc',
      npcName: 'Visible',
      dialogue: expect.any(Object),
    })
  })
})
