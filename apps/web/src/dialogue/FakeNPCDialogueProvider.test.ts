import { describe, expect, it } from 'vitest'
import type {
  NPCDialogueRequest,
  NPCObjectiveContext,
  QuestDialogueContext,
  RoomDialogueContext,
} from '../domain/dialogue/contracts'
import { FakeNPCDialogueProvider, OBJECTIVE_LINES } from './FakeNPCDialogueProvider'

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

const altarRoomContext: RoomDialogueContext = {
  focus: { type: 'altar', direction: 'north' },
  features: [{ type: 'altar', direction: 'north' }],
  affordances: ['inspect'],
  npcCount: 0,
}

function objectiveQuest(objective: NPCObjectiveContext): QuestDialogueContext {
  return {
    activeObjectiveId: 'unknown-generated-objective',
    status: objective.status,
    objective,
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

  it('uses a deterministic room-grounded fallback line when no prompt or persona matches', async () => {
    const provider = new FakeNPCDialogueProvider()
    const input = request({
      persona: undefined,
      npcId: 'unknown-npc',
      room: altarRoomContext,
    })

    expect(await provider.reply(input)).toEqual(await provider.reply(input))
    expect(await provider.reply(input)).toEqual({
      text: 'That altar makes this place feel important.',
    })
  })

  it('keeps prompt-specific responses ahead of room-grounded fallback', async () => {
    const provider = new FakeNPCDialogueProvider()
    const response = await provider.reply({
      ...request({ room: altarRoomContext }),
      playerLine: 'ask-hall',
    })

    expect(response).toEqual({ text: 'The court scattered when the roads fell silent.' })
  })

  it('keeps persona responses ahead of room-grounded fallback', async () => {
    const provider = new FakeNPCDialogueProvider()
    const withoutRoom = await provider.reply(request({ persona: 'survivor' }))
    const withRoom = await provider.reply(request({
      persona: 'survivor',
      room: altarRoomContext,
    }))

    expect(withRoom).toEqual(withoutRoom)
    expect(withRoom.text).toBe('You made it inside. That is more than most manage.')
  })

  it('uses the existing generic fallback when room context is missing', async () => {
    const response = await new FakeNPCDialogueProvider().reply(request({
      persona: undefined,
      npcId: 'npc-a',
    }))

    expect(response).toEqual({ text: 'For now, there is little more to tell.' })
  })

  it('uses the existing generic fallback when room context has no focus', async () => {
    const provider = new FakeNPCDialogueProvider()
    const withoutRoom = await provider.reply(request({
      persona: undefined,
      npcId: 'npc-a',
    }))
    const withNoFocus = await provider.reply(request({
      persona: undefined,
      npcId: 'npc-a',
      room: {
        features: [{ type: 'altar', direction: 'north' }],
        affordances: ['inspect'],
        npcCount: 0,
      },
    }))

    expect(withNoFocus).toEqual(withoutRoom)
  })

  it('uses the existing generic fallback when focus type has no room-grounded line', async () => {
    const provider = new FakeNPCDialogueProvider()
    const withoutRoom = await provider.reply(request({
      persona: undefined,
      npcId: 'npc-a',
    }))
    const withUnsupportedFocus = await provider.reply(request({
      persona: undefined,
      npcId: 'npc-a',
      room: {
        focus: { type: 'pillar', direction: 'center' },
        features: [{ type: 'pillar', direction: 'center' }],
        affordances: [],
        npcCount: 0,
      },
    }))

    expect(withUnsupportedFocus).toEqual(withoutRoom)
  })

  it('returns a distinct authored clue for each activeObjectiveId', async () => {
    const provider = new FakeNPCDialogueProvider()
    const makeRequest = (quest: QuestDialogueContext): NPCDialogueRequest =>
      request({ quest })

    const claimCoin = await provider.reply(makeRequest({ activeObjectiveId: 'claim-tribute-coin', status: 'active' }))
    const getPassMalik = await provider.reply(makeRequest({ activeObjectiveId: 'get-past-steward-malik', status: 'active' }))
    const enterSafehouse = await provider.reply(makeRequest({ activeObjectiveId: 'enter-the-safehouse', status: 'active' }))

    expect(claimCoin.text).toContain('tribute coffer')
    expect(getPassMalik.text).toContain('Malik')
    expect(enterSafehouse.text).toContain('north arch')

    expect(claimCoin.text).not.toBe(getPassMalik.text)
    expect(getPassMalik.text).not.toBe(enterSafehouse.text)
    expect(claimCoin.text).not.toBe(enterSafehouse.text)
  })

  it('returns a completion clue when activeObjectiveId is null and status is complete', async () => {
    const provider = new FakeNPCDialogueProvider()
    const response = await provider.reply(request({ quest: { activeObjectiveId: null, status: 'complete' } }))

    expect(response.text).toContain("steward's toll")
  })

  it('prefers generated quest hint over authored QUEST_CLUE when present', async () => {
    const provider = new FakeNPCDialogueProvider()
    const response = await provider.reply(request({
      quest: {
        activeObjectiveId: 'claim-tribute-coin',
        status: 'active',
        hint: 'Sanitized generated hint.',
      },
    }))

    expect(response.text).toBe('Sanitized generated hint.')
    expect(response.text).not.toContain('tribute coffer')
  })

  it('prefers generated completionHint over authored completion line when present', async () => {
    const provider = new FakeNPCDialogueProvider()
    const response = await provider.reply(request({
      quest: {
        activeObjectiveId: null,
        status: 'complete',
        completionHint: 'Sanitized generated completion.',
      },
    }))

    expect(response.text).toBe('Sanitized generated completion.')
    expect(response.text).not.toContain("steward's toll")
  })

  it.each([
    [{ kind: 'inspect', status: 'active' }, OBJECTIVE_LINES.inspect.active],
    [{ kind: 'resolve', status: 'complete' }, OBJECTIVE_LINES.resolve.complete],
    [{ kind: 'reach', status: 'active' }, OBJECTIVE_LINES.reach.active],
    [{ kind: 'general', status: 'active' }, OBJECTIVE_LINES.general.active],
  ] satisfies Array<[NPCObjectiveContext, readonly string[]]>)(
    'returns a fixed objective-awareness line for %s objectives',
    async (objective, expectedLines) => {
      const response = await new FakeNPCDialogueProvider().reply(request({
        quest: objectiveQuest(objective),
      }))

      expect(expectedLines).toContain(response.text)
    },
  )

  it('selects objective-awareness lines deterministically by kind, status, and history length', async () => {
    const provider = new FakeNPCDialogueProvider()
    const objective: NPCObjectiveContext = { kind: 'inspect', status: 'active' }
    const lines = OBJECTIVE_LINES.inspect.active
    const oneTurn = [{ speaker: 'npc' as const, text: 'Earlier line.' }]
    const anotherOneTurn = [{ speaker: 'player' as const, text: 'Different earlier line.' }]
    const twoTurns = [
      { speaker: 'npc' as const, text: 'Earlier line.' },
      { speaker: 'player' as const, text: 'Another line.' },
    ]

    const first = await provider.reply(request({
      quest: objectiveQuest(objective),
      history: oneTurn,
    }))
    const sameLength = await provider.reply(request({
      quest: objectiveQuest(objective),
      history: anotherOneTurn,
    }))
    const rotated = await provider.reply(request({
      quest: objectiveQuest(objective),
      history: twoTurns,
    }))

    expect(sameLength).toEqual(first)
    expect(lines).toContain(rotated.text)
    if (new Set(lines).size > 1) expect(rotated.text).not.toBe(first.text)
  })

  it('uses quest.objective.status instead of quest.status for objective-awareness lines', async () => {
    const response = await new FakeNPCDialogueProvider().reply(request({
      quest: {
        activeObjectiveId: 'unknown-generated-objective',
        status: 'active',
        objective: { kind: 'resolve', status: 'complete' },
      },
    }))

    expect(OBJECTIVE_LINES.resolve.complete).toContain(response.text)
    expect(OBJECTIVE_LINES.resolve.active).not.toContain(response.text)
  })

  it('keeps explicit prompt responses ahead of objective-awareness lines', async () => {
    const response = await new FakeNPCDialogueProvider().reply({
      ...request({
        quest: objectiveQuest({ kind: 'inspect', status: 'active' }),
      }),
      playerLine: 'ask-hall',
    })

    expect(response.text).toBe('The court scattered when the roads fell silent.')
    expect(OBJECTIVE_LINES.inspect.active).not.toContain(response.text)
  })

  it('keeps generated and authored quest clues ahead of objective-awareness lines', async () => {
    const provider = new FakeNPCDialogueProvider()

    const generatedHint = await provider.reply(request({
      quest: {
        ...objectiveQuest({ kind: 'inspect', status: 'active' }),
        hint: 'Sanitized generated hint.',
      },
    }))
    const generatedCompletion = await provider.reply(request({
      quest: {
        activeObjectiveId: null,
        status: 'complete',
        completionHint: 'Sanitized generated completion.',
        objective: { kind: 'resolve', status: 'complete' },
      },
    }))
    const authoredClue = await provider.reply(request({
      quest: {
        activeObjectiveId: 'claim-tribute-coin',
        status: 'active',
        objective: { kind: 'inspect', status: 'active' },
      },
    }))

    expect(generatedHint.text).toBe('Sanitized generated hint.')
    expect(generatedCompletion.text).toBe('Sanitized generated completion.')
    expect(authoredClue.text).toContain('tribute coffer')
    expect(OBJECTIVE_LINES.inspect.active).not.toContain(generatedHint.text)
    expect(OBJECTIVE_LINES.resolve.complete).not.toContain(generatedCompletion.text)
    expect(OBJECTIVE_LINES.inspect.active).not.toContain(authoredClue.text)
  })

  it('uses objective-awareness lines before persona and room-grounded fallback lines', async () => {
    const provider = new FakeNPCDialogueProvider()
    const objective = { kind: 'general', status: 'active' } satisfies NPCObjectiveContext

    const withPersona = await provider.reply(request({
      quest: objectiveQuest(objective),
    }))
    const withRoomFallback = await provider.reply(request({
      persona: undefined,
      npcId: 'unknown-npc',
      room: altarRoomContext,
      quest: objectiveQuest(objective),
    }))

    expect(OBJECTIVE_LINES.general.active).toContain(withPersona.text)
    expect(OBJECTIVE_LINES.general.active).toContain(withRoomFallback.text)
    expect(withPersona.text).not.toBe('The hall has seen quieter days, but you are welcome here.')
    expect(withRoomFallback.text).not.toBe('That altar makes this place feel important.')
  })

  it('preserves previous behavior when quest.objective is absent', async () => {
    const provider = new FakeNPCDialogueProvider()
    const withUnknownObjectiveId = await provider.reply(request({
      quest: { activeObjectiveId: 'unknown-generated-objective', status: 'active' },
    }))
    const noQuest = await provider.reply(request())

    expect(withUnknownObjectiveId).toEqual(noQuest)
  })

  it('falls back to persona lines when quest is absent', async () => {
    const provider = new FakeNPCDialogueProvider()
    const withQuest = await provider.reply(request({ quest: { activeObjectiveId: 'claim-tribute-coin', status: 'active' } }))
    const noQuest = await provider.reply(request())

    expect(withQuest.text).not.toBe(noQuest.text)
    expect(noQuest.text).toBe('The hall has seen quieter days, but you are welcome here.')
  })

  it('falls back to authored QUEST_CLUE when generated hint is absent', async () => {
    const provider = new FakeNPCDialogueProvider()
    const response = await provider.reply(request({
      quest: { activeObjectiveId: 'claim-tribute-coin', status: 'active' },
    }))

    expect(response.text).toBe(
      'The tribute coffer sits somewhere in this hall. Find it and take the coin inside.',
    )
  })

  it('keeps explicit prompt responses ahead of quest clues', async () => {
    const provider = new FakeNPCDialogueProvider()
    const response = await provider.reply({
      ...request({ quest: { activeObjectiveId: 'claim-tribute-coin', status: 'active' } }),
      playerLine: 'ask-hall',
    })

    expect(response.text).toBe('The court scattered when the roads fell silent.')
    expect(response.text).not.toContain('tribute coffer')
  })

  it('keeps quest clues ahead of persona cycle for unknown objective ids', async () => {
    const provider = new FakeNPCDialogueProvider()
    const unknownObjective = await provider.reply(request({ quest: { activeObjectiveId: 'unknown-future-objective', status: 'active' } }))
    const noQuest = await provider.reply(request())

    expect(unknownObjective.text).toBe(noQuest.text)
  })

  it('does not leak room names, object names, raw JSON, prompts, interaction text, or generated descriptions', async () => {
    const response = await new FakeNPCDialogueProvider().reply({
      ...request({
        roomId: 'secret-room-name',
        npcId: 'unknown-npc',
        npcName: 'Named Object That Must Not Leak',
        persona: undefined,
        room: {
          focus: { type: 'corpse', direction: 'south' },
          features: [{ type: 'corpse', direction: 'south' }],
          affordances: ['inspect'],
          npcCount: 0,
        },
        history: [
          { speaker: 'player', text: 'raw JSON provider prompt interaction Secret Title Secret Body generated description' },
        ],
      }),
      playerLine: 'interaction prompt raw JSON provider text Secret Title Secret Body generated description',
    })

    expect(response.text).toBe('A body lies here. Watch your step.')
    expect(response.text).not.toContain('secret-room-name')
    expect(response.text).not.toContain('Named Object')
    expect(response.text).not.toContain('raw JSON')
    expect(response.text).not.toContain('provider')
    expect(response.text).not.toContain('prompt')
    expect(response.text).not.toContain('interaction')
    expect(response.text).not.toContain('Secret Title')
    expect(response.text).not.toContain('Secret Body')
    expect(response.text).not.toContain('generated description')
  })

  it('does not leak objective target details or prompt fragments from objective-awareness lines', async () => {
    const response = await new FakeNPCDialogueProvider().reply({
      ...request({
        roomId: 'secret-room-id',
        npcId: 'unknown-npc',
        npcName: 'Named Object That Must Not Leak',
        persona: undefined,
        room: {
          focus: { type: 'chest', direction: 'east' },
          features: [{ type: 'chest', direction: 'east' }],
          affordances: ['inspect'],
          npcCount: 1,
        },
        quest: {
          activeObjectiveId: 'objective-secret-target',
          status: 'active',
          hint: undefined,
          objective: { kind: 'inspect', status: 'active' },
        },
        history: [
          { speaker: 'player', text: 'raw provider output generated hint object-secret-target' },
        ],
      }),
      playerLine: 'user prompt fragment interaction:object-secret-target secret-room-id generated hint',
    })

    expect(OBJECTIVE_LINES.inspect.active).toContain(response.text)
    expect(response.text).not.toContain('objective-secret-target')
    expect(response.text).not.toContain('object-secret-target')
    expect(response.text).not.toContain('interaction:')
    expect(response.text).not.toContain('secret-room-id')
    expect(response.text).not.toContain('generated hint')
    expect(response.text).not.toContain('Named Object')
    expect(response.text).not.toContain('chest')
    expect(response.text).not.toContain('provider output')
    expect(response.text).not.toContain('user prompt fragment')
  })
})
