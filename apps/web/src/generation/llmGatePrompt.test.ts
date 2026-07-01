import { describe, expect, it } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import {
  GATE_SYSTEM_PROMPT,
  buildGatePromptDigest,
  buildGatePromptMessages,
} from './llmGatePrompt'

function makeRoom(objects: unknown[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'secret-room-id',
    name: 'Secret Room Name',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 5] },
    objects,
  })
}

function exitObject(toRoomId = 'north-room'): unknown {
  return {
    type: 'arch',
    id: 'secret-exit-object-id',
    position: [0, 0, -8],
    interaction: {
      key: 'E',
      prompt: 'Secret exit interaction prompt',
      title: 'Secret exit title',
      body: 'Secret exit generated text',
      exit: { toRoomId },
    },
  }
}

describe('buildGatePromptDigest', () => {
  it('includes only eligible flag-writer candidates as objectId/type and exit targets', () => {
    const room = makeRoom([
      {
        type: 'book',
        id: 'book-1',
        name: 'Secret Object Name',
        position: [0, 0.3, -2],
        interaction: {
          key: 'E',
          prompt: 'Secret read prompt',
          body: 'Secret generated body.',
          effect: { kind: 'inspect' },
        },
      },
      {
        type: 'crate',
        id: 'crate-1',
        position: [2, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Secret take prompt',
          effect: {
            kind: 'take-item',
            item: { itemId: 'battery', name: 'Battery', quantity: 1 },
          },
        },
      },
      {
        type: 'machine',
        id: 'use-item-1',
        position: [-2, 0, -2],
        interaction: {
          key: 'E',
          prompt: 'Use',
          effect: { kind: 'use-item', itemId: 'battery', quantity: 1 },
        },
      },
      { type: 'pillar', id: 'pillar-1', position: [4, 0, -2] },
      exitObject('north-room'),
    ])

    expect(buildGatePromptDigest(room)).toEqual({
      candidates: [
        { objectId: 'book-1', type: 'book' },
        { objectId: 'crate-1', type: 'crate' },
      ],
      exits: [{ exitToRoomId: 'north-room' }],
    })
  })

  it('excludes room names, object names, interaction text, raw JSON fields, narrative text, and flags', () => {
    const room = makeRoom([
      {
        type: 'scroll',
        id: 'scroll-1',
        name: 'Secret Object Name',
        position: [0, 0.5, -2],
        interaction: {
          key: 'E',
          prompt: 'Secret interaction prompt',
          title: 'Secret interaction title',
          body: 'Secret generated narrative text',
          effect: { kind: 'inspect', flag: 'secret-custom-flag' },
        },
      },
      exitObject('secret-exit-room-id'),
    ])

    const serialized = JSON.stringify(buildGatePromptDigest(room))

    expect(serialized).toBe(
      '{"candidates":[{"objectId":"scroll-1","type":"scroll"}],"exits":[{"exitToRoomId":"secret-exit-room-id"}]}',
    )
    for (const forbidden of [
      'Secret Room Name',
      'Secret Object Name',
      'Secret interaction prompt',
      'Secret interaction title',
      'Secret generated narrative text',
      'Secret exit interaction prompt',
      'Secret exit title',
      'Secret exit generated text',
      'secret-custom-flag',
      'schemaVersion',
      'objects',
      'interaction',
      'prompt',
      'body',
      'name',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('returns bounded empty arrays when there are no eligible candidates or exits', () => {
    const room = makeRoom([{ type: 'pillar', id: 'pillar-1', position: [0, 0, -2] }])

    expect(buildGatePromptDigest(room)).toEqual({ candidates: [], exits: [] })
    expect(buildGatePromptMessages(room)[1]?.content).toBe('{"candidates":[],"exits":[]}')
  })
})

describe('buildGatePromptMessages', () => {
  it('returns static system instructions plus the structural digest', () => {
    const room = makeRoom([
      {
        type: 'artifact',
        id: 'artifact-1',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      exitObject('east-room'),
    ])

    expect(buildGatePromptMessages(room)).toEqual([
      { role: 'system', content: GATE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: '{"candidates":[{"objectId":"artifact-1","type":"artifact"}],"exits":[{"exitToRoomId":"east-room"}]}',
      },
    ])
  })

  it('system prompt excludes raw room, narrative, flag, and full gate instructions', () => {
    const lower = GATE_SYSTEM_PROMPT.toLowerCase()

    expect(lower).toContain('unlockobjectid')
    expect(lower).toContain('exittoroomid')
    expect(lower).not.toContain('room json')
    expect(lower).not.toContain('room name')
    expect(lower).not.toContain('user prompt')
    expect(lower).not.toContain('narrative')
    expect(lower).not.toContain('flag')
    expect(lower).not.toContain('gate json')
  })

  it('is deterministic and does not mutate the room', () => {
    const room = makeRoom([
      {
        type: 'machine',
        id: 'machine-1',
        position: [0, 0, -2],
        interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
      },
      exitObject(),
    ])
    const before = JSON.stringify(room)

    expect(buildGatePromptMessages(room)).toEqual(buildGatePromptMessages(room))
    expect(JSON.stringify(room)).toBe(before)
  })
})
