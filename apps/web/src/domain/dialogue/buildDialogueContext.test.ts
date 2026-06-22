import { describe, expect, it } from 'vitest'
import type { WorldState } from '../world/worldState'
import type { NPCDialogueTurn } from './contracts'
import { buildDialogueContext } from './buildDialogueContext'

const state: WorldState = {
  schemaVersion: 1,
  worldId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  currentRoomId: 'throne-room',
  player: {
    health: { current: 7, max: 10 },
    status: ['wounded'],
  },
  inventory: [
    { itemId: 'coin', name: 'Gold Coin', quantity: 2 },
    { itemId: 'writ', name: 'Royal Writ', quantity: 1 },
  ],
  roomStates: { 'throne-room': { visited: true } },
  revision: 3,
  updatedAt: '2026-06-22T10:00:02.000Z',
}
const history: NPCDialogueTurn[] = [
  { speaker: 'player', text: 'Hello.' },
  { speaker: 'npc', text: 'Welcome.' },
]

describe('buildDialogueContext', () => {
  it('maps authoritative facts to the provider context without item names', () => {
    const context = buildDialogueContext(
      state,
      { npcId: 'aide', npcName: 'Asha', persona: 'friendly-aide' },
      history,
    )

    expect(context).toEqual({
      roomId: 'throne-room',
      npcId: 'aide',
      npcName: 'Asha',
      persona: 'friendly-aide',
      player: {
        health: { current: 7, max: 10 },
        status: ['wounded'],
        inventoryItemIds: ['coin', 'writ'],
      },
      history,
      relationship: undefined,
    })
    expect(JSON.stringify(context)).not.toContain('Gold Coin')
    expect(JSON.stringify(context)).not.toContain('Royal Writ')
  })

  it('is deterministic and does not mutate or alias mutable inputs', () => {
    const stateBefore = structuredClone(state)
    const historyBefore = structuredClone(history)
    const npc = { npcId: 'aide', npcName: 'Asha' }

    const first = buildDialogueContext(state, npc, history)
    const second = buildDialogueContext(state, npc, history)

    expect(first).toEqual(second)
    expect(state).toEqual(stateBefore)
    expect(history).toEqual(historyBefore)
    expect(first.player.health).not.toBe(state.player.health)
    expect(first.player.status).not.toBe(state.player.status)
    expect(first.history).not.toBe(history)
    expect(first.history[0]).not.toBe(history[0])
  })
})
