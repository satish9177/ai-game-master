import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { Logger } from '../platform/logger/Logger'
import type { LogContext } from '../platform/logger/Logger'
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

function harness(logger: Logger = noopLogger) {
  const store = new InMemoryWorldStore()
  let id = 2
  const ids: IdGenerator = {
    newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  let tick = 0
  const clock: Clock = {
    now: () => `2026-06-22T10:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  const session = new WorldSession(store, clock, ids, logger)
  const service = new NPCDialogueService(session, new FakeNPCDialogueProvider(), logger)
  return { session, service }
}

async function startSession(logger: Logger = noopLogger) {
  const h = harness(logger)
  const started = await h.session.startSession(canon)
  if (!started.ok) throw new Error(started.error.code)
  return { ...h, sessionId: started.state.sessionId }
}

function captureLogger() {
  const entries: { message: string; context: LogContext }[] = []
  const logger: Logger = {
    debug: (message, context = {}) => entries.push({ message, context }),
    info: (message, context = {}) => entries.push({ message, context }),
    warn: (message, context = {}) => entries.push({ message, context }),
    error: (message, context = {}) => entries.push({ message, context }),
    child: () => logger,
  }
  return { entries, logger }
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

  it('includes generated quest hints when provided', () => {
    const input = buildNPCDialogueReplyInput({
      sessionId: 's',
      target: ashaTarget,
      history: [],
      questStage: {
        activeObjectiveId: 'generated-0',
        status: 'active',
        hint: 'Sanitized generated hint.',
        completionHint: 'Sanitized generated completion.',
      },
    })

    expect(input.quest).toEqual({
      activeObjectiveId: 'generated-0',
      status: 'active',
      hint: 'Sanitized generated hint.',
      completionHint: 'Sanitized generated completion.',
    })
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

  it('includes the memory context when provided', () => {
    const memoryContext = { entries: [{ text: 'The east door is locked.', kind: 'player_claim' }] }
    const input = buildNPCDialogueReplyInput({
      sessionId: 's',
      target: ashaTarget,
      history: [],
      memoryContext,
    })
    expect(input.memoryContext).toEqual(memoryContext)
  })

  it('passes promptId and playerLine independently', () => {
    const input = buildNPCDialogueReplyInput({
      sessionId: 's',
      target: ashaTarget,
      history: [],
      promptId: 'ask-hall',
      playerLine: 'What happened to the court?',
    })

    expect(input.promptId).toBe('ask-hall')
    expect(input.playerLine).toBe('What happened to the court?')
  })

  it('omits the memory context when not provided', () => {
    const input = buildNPCDialogueReplyInput({
      sessionId: 's',
      target: ashaTarget,
      history: [],
    })
    expect(input.memoryContext).toBeUndefined()
    expect(input).not.toHaveProperty('memoryContext')
  })

  it('includes prompt time context only when provided', () => {
    const withTime = buildNPCDialogueReplyInput({
      sessionId: 's',
      target: ashaTarget,
      history: [],
      timeContext: { timeOfDay: 'night' },
    })
    const withoutTime = buildNPCDialogueReplyInput({
      sessionId: 's',
      target: ashaTarget,
      history: [],
    })

    expect(withTime.timeContext).toEqual({ timeOfDay: 'night' })
    expect(withTime.timeContext).not.toHaveProperty('day')
    expect(withTime.timeContext).not.toHaveProperty('hour')
    expect(withoutTime).not.toHaveProperty('timeContext')
  })

  it('includes routine context only when provided', () => {
    const withRoutine = buildNPCDialogueReplyInput({
      sessionId: 's',
      target: ashaTarget,
      history: [],
      routineContext: { mode: 'patrol', activity: 'patrolling', timeOfDay: 'dusk' },
    })
    const withoutRoutine = buildNPCDialogueReplyInput({
      sessionId: 's',
      target: ashaTarget,
      history: [],
    })

    expect(withRoutine.routineContext).toEqual({ mode: 'patrol', activity: 'patrolling', timeOfDay: 'dusk' })
    expect(withoutRoutine.routineContext).toBeUndefined()
    expect(withoutRoutine).not.toHaveProperty('routineContext')
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

  it('first visible NPC reply can surface a sanitized generated quest hint', async () => {
    const { service, sessionId } = await startSession()
    const result = await service.reply(
      buildNPCDialogueReplyInput({
        sessionId,
        target: ashaTarget,
        history: [],
        playerLine: undefined,
        questStage: {
          activeObjectiveId: 'generated-0',
          status: 'active',
          hint: 'Sanitized generated hint.',
        },
      }),
    )
    expect(result.status).toBe('replied')
    if (result.status === 'replied') {
      expect(result.turn.text).toBe('Sanitized generated hint.')
      expect(result.turn.text).not.toContain('Steward')
      expect(result.turn.text).not.toContain('Malik')
    }
  })

  it('does not log generated quest hint text', async () => {
    const { entries, logger } = captureLogger()
    const { service, sessionId } = await startSession(logger)
    const result = await service.reply(
      buildNPCDialogueReplyInput({
        sessionId,
        target: ashaTarget,
        history: [],
        questStage: {
          activeObjectiveId: 'generated-0',
          status: 'active',
          hint: 'Sanitized generated hint.',
        },
      }),
    )

    expect(result.status).toBe('replied')
    expect(JSON.stringify(entries)).not.toContain('Sanitized generated hint')
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
