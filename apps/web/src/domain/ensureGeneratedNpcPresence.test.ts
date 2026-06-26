import { describe, expect, it } from 'vitest'
import { buildDialogueLookup } from '../app/dialogue'
import { ensureGeneratedNpcPresence } from './ensureGeneratedNpcPresence'
import { loadRoomSpec } from './loadRoomSpec'
import type { LoadedRoom } from './loadRoomSpec'
import type { RoomObject } from './roomSpec'
import { validateRoom } from './validateRoom'

const EAST_FLANK: [number, number, number] = [4.050000000000001, 0, 0]
const WEST_FLANK: [number, number, number] = [-4.050000000000001, 0, 0]

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

function ensureInserted(room: LoadedRoom): LoadedRoom {
  const result = ensureGeneratedNpcPresence(room, { requested: true })
  expect(result.npcInserted).toBe(true)
  return result.room
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
      name: 'Mira',
      color: '#597a9b',
      interaction: {
        key: 'F',
        prompt: 'Press F to talk to Mira',
        body: 'Mira keeps watch, ready to answer quietly.',
        dialogue: {
          persona: 'generated-room-guide',
          greeting: 'Stay close. I am Mira.',
          prompts: [
            { id: 'ask-room', label: 'What do you notice here?' },
            { id: 'ask-help', label: 'Can you help me?' },
          ],
        },
      },
    })
    expect(lookup.get('generated-npc')).toEqual({
      npcId: 'generated-npc',
      npcName: 'Mira',
      persona: 'generated-room-guide',
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
    ])

    const npcJson = JSON.stringify(insertedNpc(ensureInserted(room)))

    for (const forbidden of [
      'Secret Room Name',
      'object-secret-id',
      'PROMPT_SECRET_MARKER',
      'TITLE_SECRET_MARKER',
      'BODY_SECRET_MARKER',
      'ZOMBIE_SECRET_NAME',
      '{"raw":"json"}',
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
