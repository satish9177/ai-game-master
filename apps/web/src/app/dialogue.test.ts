import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import { buildDialogueLookup, dialogueResultMessage, DIALOGUE_AT_CAP_MESSAGE } from './dialogue'

function loadDialogueRoom(objects: unknown[]): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'dialogue-room',
    name: 'Dialogue Room',
    shell: { dimensions: { width: 10, depth: 10, height: 4 } },
    spawn: { position: [0, 1.7, 3] },
    objects,
  })
}

describe('dialogue composition helpers', () => {
  it('indexes valid NPC dialogue by stable id, skips misses, and keeps the first duplicate', () => {
    const room = loadDialogueRoom([
      {
        type: 'npc',
        name: 'Idless',
        position: [-3, 0, 0],
        interaction: { key: 'F', prompt: 'Talk', dialogue: { persona: 'ignored' } },
      },
      {
        type: 'npc',
        id: 'aide',
        name: 'Asha',
        position: [-1, 0, 0],
        interaction: {
          key: 'F',
          prompt: 'Talk',
          dialogue: { persona: 'friendly-aide', greeting: 'Welcome.' },
        },
      },
      {
        type: 'npc',
        id: 'aide',
        name: 'Duplicate',
        position: [1, 0, 0],
        interaction: {
          key: 'F',
          prompt: 'Talk',
          dialogue: { persona: 'duplicate' },
        },
      },
      {
        type: 'npc',
        id: 'silent',
        name: 'Silent',
        position: [3, 0, 0],
        interaction: { key: 'F', prompt: 'Talk' },
      },
    ])

    expect([...buildDialogueLookup(room)]).toEqual([
      ['aide', {
        npcId: 'aide',
        npcName: 'Asha',
        persona: 'friendly-aide',
        dialogue: { persona: 'friendly-aide', greeting: 'Welcome.' },
      }],
    ])
  })

  it('keeps a named NPC display name', () => {
    const room = loadDialogueRoom([
      {
        type: 'npc',
        id: 'guide',
        name: 'Mira',
        position: [0, 0, 0],
        interaction: { key: 'F', prompt: 'Talk', dialogue: { persona: 'guide' } },
      },
    ])

    expect(buildDialogueLookup(room).get('guide')?.npcName).toBe('Mira')
  })

  it('uses a neutral display name for an id-bearing NPC without a name', () => {
    const room = {
      ...loadDialogueRoom([]),
      objects: [
        {
          type: 'npc',
          id: 'generated-npc-7f4d',
          position: [0, 0, 0],
          interaction: { key: 'F', prompt: 'Talk', dialogue: { persona: 'guide' } },
        },
      ],
    } as unknown as LoadedRoom

    const target = buildDialogueLookup(room).get('generated-npc-7f4d')

    expect(target).toMatchObject({
      npcId: 'generated-npc-7f4d',
      npcName: 'Stranger',
      dialogue: { persona: 'guide' },
    })
    expect(target?.npcName).not.toBe('generated-npc-7f4d')
  })

  it('uses a neutral display name for a blank NPC name', () => {
    const room = loadDialogueRoom([
      {
        type: 'npc',
        id: 'blank-name-npc',
        name: '   ',
        position: [0, 0, 0],
        interaction: { key: 'F', prompt: 'Talk', dialogue: { persona: 'guide' } },
      },
    ])

    expect(buildDialogueLookup(room).get('blank-name-npc')?.npcName).toBe('Stranger')
  })

  it('maps typed failures to calm display messages', () => {
    expect(dialogueResultMessage({ status: 'replied', turn: { speaker: 'npc', text: 'Hi' } }))
      .toBeUndefined()
    expect(dialogueResultMessage({ status: 'rejected', reason: 'missing-dialogue' }))
      .toBeUndefined()
    expect(dialogueResultMessage({ status: 'failed', reason: 'provider-unavailable' }))
      .toBe('They have nothing to say right now.')
    expect(dialogueResultMessage({ status: 'failed', reason: 'not-found' }))
      .toBe('This conversation is unavailable.')
  })

  it('exports a stable, non-empty at-cap message for the blocked dialogue-attempt gate', () => {
    expect(DIALOGUE_AT_CAP_MESSAGE).toBe('They have nothing more to say right now.')
    expect(DIALOGUE_AT_CAP_MESSAGE.length).toBeGreaterThan(0)
  })
})
