import { describe, expect, it } from 'vitest'
import type { NPCDialogueRequest } from '../domain/dialogue/contracts'
import { FakeNPCDialogueProvider } from './FakeNPCDialogueProvider'

function request(overrides: Partial<NPCDialogueRequest['context']> = {}): NPCDialogueRequest {
  return {
    context: {
      roomId: 'throne-room',
      npcId: 'aide',
      npcName: 'Asha',
      persona: 'friendly-aide',
      player: {
        health: { current: 7, max: 10 },
        status: [],
        inventoryItemIds: [],
      },
      history: [],
      ...overrides,
    },
  }
}

describe('FakeNPCDialogueProvider', () => {
  it('returns byte-identical output for the same request', async () => {
    const provider = new FakeNPCDialogueProvider()
    const input = request()
    expect(await provider.reply(input)).toEqual(await provider.reply(input))
  })

  it('varies deterministically by persona, npc id, turn index, and canned prompt id', async () => {
    const provider = new FakeNPCDialogueProvider()
    const friendly = await provider.reply(request())
    const survivor = await provider.reply(request({ persona: 'survivor' }))
    expect(friendly.text).not.toBe(survivor.text)

    const firstNpc = await provider.reply(request({ persona: undefined, npcId: 'npc-a' }))
    const secondNpc = await provider.reply(request({ persona: undefined, npcId: 'npc-b' }))
    expect(firstNpc.text).not.toBe(secondNpc.text)

    const laterTurn = await provider.reply(request({
      history: [{ speaker: 'npc', text: 'Earlier line.' }],
    }))
    expect(laterTurn.text).not.toBe(friendly.text)

    const askHall = await provider.reply({ ...request(), playerLine: 'ask-hall' })
    const askExit = await provider.reply({ ...request(), playerLine: 'ask-exit' })
    expect(askHall.text).not.toBe(askExit.text)
  })

  it('returns plain display text only', async () => {
    const response = await new FakeNPCDialogueProvider().reply(request())
    expect(response).toEqual({ text: expect.any(String) })
    expect(response.text.length).toBeGreaterThan(0)
    expect(response.text).not.toMatch(/<script|javascript:|eval\(/i)
    expect(Object.keys(response)).toEqual(['text'])
  })
})
