import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { buildDialogueLookup, dialogueResultMessage } from './dialogue'

describe('dialogue composition helpers', () => {
  it('indexes valid NPC dialogue by stable id, skips misses, and keeps the first duplicate', () => {
    const room = loadRoomSpec({
      schemaVersion: 1,
      id: 'dialogue-room',
      name: 'Dialogue Room',
      shell: { dimensions: { width: 10, depth: 10, height: 4 } },
      spawn: { position: [0, 1.7, 3] },
      objects: [
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
      ],
    })

    expect([...buildDialogueLookup(room)]).toEqual([
      ['aide', {
        npcId: 'aide',
        npcName: 'Asha',
        persona: 'friendly-aide',
        dialogue: { persona: 'friendly-aide', greeting: 'Welcome.' },
      }],
    ])
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
})
