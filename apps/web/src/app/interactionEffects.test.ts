import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { buildInteractionEffectLookup } from './interactionEffects'

describe('buildInteractionEffectLookup', () => {
  it('maps interactable ids to validated effects and refs without including display-only interactions', () => {
    const room = loadRoomSpec({
      schemaVersion: 1,
      id: 'lookup-room',
      name: 'Lookup Room',
      shell: { dimensions: { width: 10, depth: 10, height: 4 } },
      spawn: { position: [0, 1.7, 3] },
      objects: [
        {
          type: 'scroll',
          id: 'note',
          position: [0, 0, 0],
          interaction: {
            key: 'E',
            prompt: 'Read',
            effect: { kind: 'inspect' },
          },
        },
        {
          type: 'crate',
          id: 'medical-crate',
          position: [1, 0, 0],
          interaction: {
            key: 'E',
            prompt: 'Open',
            effect: {
              kind: 'take-item',
              item: { itemId: 'medkit', name: 'Medkit', quantity: 1 },
            },
          },
        },
        {
          type: 'npc',
          id: 'malik',
          name: 'Malik',
          position: [-1, 0, 0],
          interaction: { key: 'F', prompt: 'Speak' },
        },
      ],
    })

    const lookup = buildInteractionEffectLookup(room)
    expect([...lookup.entries()]).toEqual([
      ['note', { effect: { kind: 'inspect' }, ref: 'note' }],
      ['medical-crate', {
        effect: {
          kind: 'take-item',
          item: { itemId: 'medkit', name: 'Medkit', quantity: 1 },
        },
        ref: 'medical-crate',
      }],
    ])
    expect(lookup.has('malik')).toBe(false)
  })

  it('skips effect-bearing objects without a stable id instead of using an undefined key', () => {
    const room = loadRoomSpec({
      schemaVersion: 1,
      id: 'missing-ref-room',
      name: 'Missing Ref Room',
      shell: { dimensions: { width: 10, depth: 10, height: 4 } },
      spawn: { position: [0, 1.7, 3] },
      objects: [{
        type: 'scroll',
        position: [0, 0, 0],
        interaction: {
          key: 'E',
          prompt: 'Read',
          effect: { kind: 'inspect' },
        },
      }],
    })
    const lookup = buildInteractionEffectLookup(room)
    expect(lookup.has(undefined)).toBe(false)
    expect(lookup.size).toBe(0)
  })
})
