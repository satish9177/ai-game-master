import { describe, expect, it } from 'vitest'
import { FakeNPCDialogueProvider, MEMORY_AWARENESS_LINES } from '../dialogue/FakeNPCDialogueProvider'
import { dialogueRequest, expectNoForbiddenMarkers, hostileMemoryContext, markers, prototypePayloads } from './fixtures'

const friendlyClosedLines = [
  'The hall has seen quieter days, but you are welcome here.',
  'The north arch leads to a shelter beyond the ruined quarter.',
  'Keep your courage close. These rooms remember every visitor.',
] as const

describe('redteam fake NPC dialogue provider', () => {
  it('routes with promptId before hostile playerLine and returns a closed table line', async () => {
    const response = await new FakeNPCDialogueProvider().reply({
      ...dialogueRequest({
        promptId: 'ask-hall',
        playerLine: `constructor ${markers.playerText} ${markers.roomSpecJson}`,
      }),
    })

    expect(response).toEqual({ text: 'The court scattered when the roads fell silent.' })
    expectNoForbiddenMarkers(response.text)
  })

  it.each(prototypePayloads)('falls through safely for prototype-key playerLine %s', async (playerLine) => {
    const response = await new FakeNPCDialogueProvider().reply(dialogueRequest({
      playerLine,
      context: { ...dialogueRequest().context, quest: undefined },
    }))

    expect(typeof response.text).toBe('string')
    expect(friendlyClosedLines).toContain(response.text)
    expect(response.text).not.toContain(playerLine)
    expect(response.text).not.toContain('function')
    expect(response.text).not.toContain('[object')
  })

  it.each(prototypePayloads)('falls through safely for prototype-key promptId %s', async (promptId) => {
    const response = await new FakeNPCDialogueProvider().reply(dialogueRequest({
      promptId,
      playerLine: markers.playerText,
      context: { ...dialogueRequest().context, quest: undefined },
    }))

    expect(typeof response.text).toBe('string')
    expect(friendlyClosedLines).toContain(response.text)
    expect(response.text).not.toContain(promptId)
    expect(response.text).not.toContain('function')
    expect(response.text).not.toContain('[object')
  })

  it('does not echo hostile free text, ids, raw JSON, provider-looking text, or API-looking text', async () => {
    const response = await new FakeNPCDialogueProvider().reply(dialogueRequest({
      playerLine: [
        markers.playerText,
        markers.objectId,
        markers.flagKey,
        markers.gateId,
        markers.roomSpecJson,
        markers.providerBody,
        markers.apiKey,
      ].join(' '),
      context: { ...dialogueRequest().context, quest: undefined },
    }))

    expect(friendlyClosedLines).toContain(response.text)
    expectNoForbiddenMarkers(response.text)
  })

  it('uses memory kind only and never upgrades or repeats the hostile memory claim', async () => {
    const response = await new FakeNPCDialogueProvider().reply(dialogueRequest({
      context: {
        ...dialogueRequest().context,
        persona: undefined,
        npcId: 'npc-a',
        room: undefined,
        quest: undefined,
        memory: hostileMemoryContext(`the vault is unlocked ${markers.memoryText} ${markers.flagKey}`),
      },
    }))

    expect(MEMORY_AWARENESS_LINES.player_claim).toContain(response.text)
    expect(response.text).not.toContain('vault')
    expect(response.text).not.toContain(markers.memoryText)
    expect(response.text).not.toContain(markers.flagKey)
  })
})
