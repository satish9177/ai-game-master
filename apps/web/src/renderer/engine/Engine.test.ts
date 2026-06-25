import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../../domain/loadRoomSpec'
import { buildInteractables } from '../../domain/ports/interaction'

const encounter = {
  id: 'threat',
  title: 'Threat',
  description: 'A threat blocks the way.',
  choices: [{
    id: 'run',
    action: 'run',
    label: 'Run',
    outcome: { effects: [] },
  }],
}

const room = loadRoomSpec({
  schemaVersion: 1,
  id: 'affordance-room',
  name: 'Affordance Room',
  shell: {
    dimensions: { width: 12, depth: 12, height: 4 },
  },
  spawn: { position: [0, 1.6, 0], yaw: 0 },
  objects: [
    {
      id: 'exit',
      type: 'arch',
      position: [0, 0, -4],
      interaction: { key: 'E', prompt: 'Enter the archway', exit: { toRoomId: 'next' } },
    },
    {
      id: 'dialogue',
      type: 'statue',
      position: [1, 0, -4],
      interaction: { key: 'F', prompt: 'Ask the statue', dialogue: { greeting: 'Hello.' } },
    },
    {
      id: 'npc',
      type: 'npc',
      name: 'Survivor',
      position: [2, 0, -4],
      interaction: { key: 'F', prompt: 'Speak with survivor' },
    },
    {
      id: 'encounter',
      type: 'zombie',
      position: [3, 0, -4],
      interaction: { key: 'F', prompt: 'Face the threat', encounter },
    },
    {
      id: 'inspect',
      type: 'scroll',
      position: [4, 0, -4],
      interaction: { key: 'E', prompt: 'Read the note', effect: { kind: 'inspect' } },
    },
    {
      id: 'take',
      type: 'chest',
      position: [5, 0, -4],
      interaction: {
        key: 'E',
        prompt: 'Gather supplies',
        effect: {
          kind: 'take-item',
          item: { itemId: 'bandage', name: 'Bandage', quantity: 1 },
        },
      },
    },
    {
      id: 'use',
      type: 'machine',
      position: [6, 0, -4],
      interaction: {
        key: 'E',
        prompt: 'Use medkit',
        effect: { kind: 'use-item', itemId: 'medkit', quantity: 1 },
      },
    },
    {
      id: 'body-only',
      type: 'chest',
      position: [7, 0, -4],
      interaction: { key: 'E', prompt: 'Open chest', body: 'A locked chest.' },
    },
    {
      id: 'visual-only',
      type: 'crate',
      position: [8, 0, -4],
    },
  ],
})

describe('buildInteractables', () => {
  it('adds deterministic affordances to Engine interactable view models', () => {
    const byId = new Map(buildInteractables(room).map((interactable) => [
      interactable.id,
      interactable,
    ]))

    expect(byId.get('exit')?.affordance).toBe('exit')
    expect(byId.get('dialogue')?.affordance).toBe('talk')
    expect(byId.get('npc')?.affordance).toBe('talk')
    expect(byId.get('encounter')?.affordance).toBe('approach')
    expect(byId.get('inspect')?.affordance).toBe('inspect')
    expect(byId.get('take')?.affordance).toBe('take')
    expect(byId.get('use')?.affordance).toBe('use')
    expect(byId.get('body-only')?.affordance).toBe('inspect')
    expect(byId.has('visual-only')).toBe(false)
  })

  it('preserves existing interaction view-model fields and precedence data', () => {
    const exit = buildInteractables(room).find((interactable) => interactable.id === 'exit')

    expect(exit).toMatchObject({
      id: 'exit',
      type: 'arch',
      label: 'arch',
      affordance: 'exit',
      key: 'E',
      prompt: 'Enter the archway',
      position: { x: 0, y: 0, z: -4 },
    })
  })
})
