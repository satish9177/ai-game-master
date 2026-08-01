import { describe, expect, it } from 'vitest'
import {
  npcActionBindingFor,
  npcActionFlagKey,
  parseNpcActionFlagKey,
} from './contracts'

describe('NPC belief contracts', () => {
  it('C1 builds the authored action flag key', () => {
    expect(npcActionFlagKey('herald-asha', 'bar-exit', 'north-door')).toBe(
      'npc-action:herald-asha:bar-exit:north-door',
    )
  })

  it('C2 round-trips encoded identifiers', () => {
    const npcId = 'herald:asha/% sentinel'
    const targetObjectId = 'north:door/% sentinel'
    expect(parseNpcActionFlagKey(npcActionFlagKey(npcId, 'bar-exit', targetObjectId))).toEqual({
      npcId,
      action: 'bar-exit',
      targetObjectId,
    })
  })

  it.each([
    'interaction:x',
    'encounter:x',
    'meaningful-object:x:read',
    'npc-action:x:bar-exit',
    'npc-action:x:bar-exit:y:extra',
    'npc-action:x:open-exit:y',
    'npc-action:%E0%A4%A:bar-exit:y',
  ])('C3 rejects unrelated or malformed key %s', (key) => {
    expect(parseNpcActionFlagKey(key)).toBeNull()
  })

  it('C4 resolves only the authored four-field binding', () => {
    expect(npcActionBindingFor('throne-room')).toEqual({
      roomId: 'throne-room',
      npcId: 'herald-asha',
      targetObjectId: 'north-door',
      triggerItemId: 'gold-coin',
    })
    expect(npcActionBindingFor('ruined-safehouse')).toBeUndefined()
    expect(npcActionBindingFor('generated-room-1')).toBeUndefined()
  })
})
