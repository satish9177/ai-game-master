import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { Logger } from '../platform/logger/Logger'
import { InMemoryWorldStore } from '../world-session/InMemoryWorldStore'
import { WorldSession } from '../world-session/WorldSession'
import { NPCDialogueService } from '../dialogue/NPCDialogueService'
import { FakeNPCDialogueProvider } from '../dialogue/FakeNPCDialogueProvider'
import { buildNPCDialogueReplyInput } from './npcDialogueReplyInput'
import type { NPCDialogueTarget } from './dialogue'

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger
  },
}

const ashaTarget: NPCDialogueTarget = {
  npcId: 'herald-asha',
  npcName: 'Asha',
  persona: 'friendly-aide',
  dialogue: {
    persona: 'friendly-aide',
    greeting: 'Welcome, traveler. I am Asha, aide to the scattered court.',
    prompts: [
      { id: 'ask-hall', label: 'What happened to the court?' },
      { id: 'ask-exit', label: 'Where does the north arch lead?' },
    ],
  },
}

const canon = {
  schemaVersion: 1 as const,
  worldId: '00000000-0000-4000-8000-000000000001',
  name: 'Throne Room',
  startingRoomId: 'throne-room',
  initialPlayer: {
    health: { current: 75, max: 100 },
    status: [] as string[],
    inventory: [] as { itemId: string; name: string; quantity: number }[],
  },
}

function harness() {
  const store = new InMemoryWorldStore()
  let id = 2
  const ids: IdGenerator = {
    newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  let tick = 0
  const clock: Clock = {
    now: () => `2026-06-22T10:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  const session = new WorldSession(store, clock, ids, noopLogger)
  const service = new NPCDialogueService(session, new FakeNPCDialogueProvider(), noopLogger)
  return { session, service }
}

async function startSession() {
  const h = harness()
  const started = await h.session.startSession(canon)
  if (!started.ok) throw new Error(started.error.code)
  return { ...h, sessionId: started.state.sessionId }
}

describe('buildNPCDialogueReplyInput', () => {
  it('includes the quest stage when provided', () => {
    const input = buildNPCDialogueReplyInput({
      sessionId: 's',
      target: ashaTarget,
      history: [],
      questStage: { activeObjectiveId: 'get-past-steward-malik', status: 'active' },
    })
    expect(input.quest).toEqual({ activeObjectiveId: 'get-past-steward-malik', status: 'active' })
  })

  it('omits the quest stage when not provided', () => {
    const input = buildNPCDialogueReplyInput({
      sessionId: 's',
      target: ashaTarget,
      history: [],
    })
    expect(input.quest).toBeUndefined()
    expect(input).not.toHaveProperty('quest')
  })
})

describe('quest-aware dialogue open path (RoomViewer wiring seam)', () => {
  it('first visible NPC reply reflects the coffer stage before the coin is claimed', async () => {
    const { service, sessionId } = await startSession()
    // The exact input RoomViewer builds when opening Asha: empty history, no player line.
    const result = await service.reply(
      buildNPCDialogueReplyInput({
        sessionId,
        target: ashaTarget,
        history: [],
        playerLine: undefined,
        questStage: { activeObjectiveId: 'claim-tribute-coin', status: 'active' },
      }),
    )
    expect(result.status).toBe('replied')
    if (result.status === 'replied') {
      expect(result.turn.text).toBe(
        'The tribute coffer sits somewhere in this hall. Find it and take the coin inside.',
      )
    }
  })

  it('first visible NPC reply hints about Malik after the coin is claimed', async () => {
    const { service, sessionId } = await startSession()
    const result = await service.reply(
      buildNPCDialogueReplyInput({
        sessionId,
        target: ashaTarget,
        history: [],
        playerLine: undefined,
        questStage: { activeObjectiveId: 'get-past-steward-malik', status: 'active' },
      }),
    )
    expect(result.status).toBe('replied')
    if (result.status === 'replied') {
      expect(result.turn.text).toContain('Malik')
    }
  })

  it('acknowledges completion when the quest is complete', async () => {
    const { service, sessionId } = await startSession()
    const result = await service.reply(
      buildNPCDialogueReplyInput({
        sessionId,
        target: ashaTarget,
        history: [],
        questStage: { activeObjectiveId: null, status: 'complete' },
      }),
    )
    expect(result.status).toBe('replied')
    if (result.status === 'replied') {
      expect(result.turn.text).toContain("steward's toll")
    }
  })

  it('keeps the explicit prompt-button reply ahead of the quest clue', async () => {
    const { service, sessionId } = await startSession()
    const result = await service.reply(
      buildNPCDialogueReplyInput({
        sessionId,
        target: ashaTarget,
        history: [{ speaker: 'player', text: 'What happened to the court?' }],
        playerLine: 'ask-hall',
        questStage: { activeObjectiveId: 'get-past-steward-malik', status: 'active' },
      }),
    )
    expect(result.status).toBe('replied')
    if (result.status === 'replied') {
      expect(result.turn.text).toBe('The court scattered when the roads fell silent.')
    }
  })

  it('keeps existing behavior when no quest stage is supplied', async () => {
    const { service, sessionId } = await startSession()
    const result = await service.reply(
      buildNPCDialogueReplyInput({
        sessionId,
        target: ashaTarget,
        history: [],
      }),
    )
    expect(result.status).toBe('replied')
    if (result.status === 'replied') {
      expect(result.turn.text).toBe('The hall has seen quieter days, but you are welcome here.')
    }
  })
})
