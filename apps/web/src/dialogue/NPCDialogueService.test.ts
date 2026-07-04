import { describe, expect, it } from 'vitest'
import type { Clock } from '../domain/ports/Clock'
import type { IdGenerator } from '../domain/ports/IdGenerator'
import type { NPCDialogueProvider } from '../domain/ports/NPCDialogueProvider'
import type {
  NPCDialogueRequest,
  RoomDialogueContext,
  RoomMemoryDialogueContext,
} from '../domain/dialogue/contracts'
import { neutralRelationship } from '../domain/npcRelationship/neutral'
import type { NpcRelationshipState } from '../domain/npcRelationship/contracts'
import type { Logger, LogContext, LogLevel } from '../platform/logger/Logger'
import { InMemoryWorldStore } from '../world-session/InMemoryWorldStore'
import { WorldSession } from '../world-session/WorldSession'
import { NPCDialogueService } from './NPCDialogueService'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

const canon = {
  schemaVersion: 1,
  worldId: '00000000-0000-4000-8000-000000000001',
  name: 'SECRET WORLD NAME',
  startingRoomId: 'throne-room',
  initialPlayer: {
    health: { current: 8, max: 10 },
    status: ['SECRET STATUS'],
    inventory: [{ itemId: 'coin', name: 'SECRET ITEM NAME', quantity: 1 }],
  },
}
const dialogue = {
  persona: 'SECRET PERSONA',
  greeting: 'SECRET GREETING',
  prompts: [{ id: 'ask', label: 'SECRET PROMPT LABEL' }],
}
const roomContext: RoomDialogueContext = {
  focus: { type: 'altar', direction: 'north' },
  features: [
    { type: 'altar', direction: 'north' },
    { type: 'corpse', direction: 'south' },
  ],
  affordances: ['inspect', 'talk'],
  npcCount: 2,
}

function createHarness(provider?: NPCDialogueProvider) {
  const store = new InMemoryWorldStore()
  let id = 2
  const ids: IdGenerator = {
    newId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  }
  let tick = 0
  const clock: Clock = {
    now: () => `2026-06-22T10:00:${String(tick++).padStart(2, '0')}.000Z`,
  }
  const entries: LogEntry[] = []
  const logger = createSpyLogger(entries)
  const session = new WorldSession(store, clock, ids, logger)
  const dialogueProvider = provider ?? {
    reply: async () => ({ text: 'SECRET PROVIDER LINE' }),
  }
  return {
    store,
    entries,
    logger,
    session,
    service: new NPCDialogueService(session, dialogueProvider, logger),
  }
}

async function start(harness: ReturnType<typeof createHarness>) {
  const result = await harness.session.startSession(canon)
  if (!result.ok) throw new Error(result.error.code)
  return result.state
}

describe('NPCDialogueService', () => {
  it('builds current world context and returns the provider line as an npc turn', async () => {
    const requests: NPCDialogueRequest[] = []
    const harness = createHarness({
      reply: async (request) => {
        requests.push(request)
        return { text: 'A calm answer.' }
      },
    })
    const state = await start(harness)
    const history = [{ speaker: 'player', text: 'Hello.' }] as const

    const result = await harness.service.reply({
      sessionId: state.sessionId,
      npcId: 'friendly-aide',
      npcName: 'Asha',
      dialogue: { persona: 'friendly-aide' },
      history: [...history],
      promptId: 'ask-hall',
      playerLine: 'ask-hall',
    })

    expect(result).toEqual({
      status: 'replied',
      turn: { speaker: 'npc', text: 'A calm answer.' },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      promptId: 'ask-hall',
      playerLine: 'ask-hall',
      context: {
        roomId: 'throne-room',
        npcId: 'friendly-aide',
        npcName: 'Asha',
        persona: 'friendly-aide',
        player: {
          health: { current: 8, max: 10 },
          status: ['SECRET STATUS'],
          inventoryItemIds: ['coin'],
        },
        history,
      },
    })
    expect(requests[0]?.context.room).toBeUndefined()
  })

  it('passes optional roomContext through to provider context', async () => {
    const requests: NPCDialogueRequest[] = []
    const harness = createHarness({
      reply: async (request) => {
        requests.push(request)
        return { text: 'A room-aware answer.' }
      },
    })
    const state = await start(harness)
    const roomContextBefore = structuredClone(roomContext)

    const result = await harness.service.reply({
      sessionId: state.sessionId,
      npcId: 'friendly-aide',
      npcName: 'Asha',
      dialogue: { persona: 'friendly-aide' },
      history: [],
      roomContext,
    })

    expect(result).toEqual({
      status: 'replied',
      turn: { speaker: 'npc', text: 'A room-aware answer.' },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.context.room).toEqual(roomContext)
    expect(requests[0]?.context.room).not.toBe(roomContext)
    expect(requests[0]?.context.room?.focus).not.toBe(roomContext.focus)
    expect(requests[0]?.context.room?.features).not.toBe(roomContext.features)
    expect(requests[0]?.context.room?.affordances).not.toBe(roomContext.affordances)
    expect(roomContext).toEqual(roomContextBefore)
  })

  it('passes optional memoryContext through to provider context', async () => {
    const requests: NPCDialogueRequest[] = []
    const harness = createHarness({
      reply: async (request) => {
        requests.push(request)
        return { text: 'A memory-aware answer.' }
      },
    })
    const state = await start(harness)
    const memoryContext: RoomMemoryDialogueContext = {
      entries: [{ text: 'The east door is locked.', kind: 'player_claim' }],
    }
    const memoryContextBefore = structuredClone(memoryContext)

    const result = await harness.service.reply({
      sessionId: state.sessionId,
      npcId: 'friendly-aide',
      npcName: 'Asha',
      dialogue: { persona: 'friendly-aide' },
      history: [],
      memoryContext,
    })

    expect(result).toEqual({
      status: 'replied',
      turn: { speaker: 'npc', text: 'A memory-aware answer.' },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.context.memory).toEqual(memoryContext)
    expect(requests[0]?.context.memory).not.toBe(memoryContext)
    expect(memoryContext).toEqual(memoryContextBefore)
  })

  it('omits memoryContext from provider context when absent', async () => {
    const requests: NPCDialogueRequest[] = []
    const harness = createHarness({
      reply: async (request) => {
        requests.push(request)
        return { text: 'A plain answer.' }
      },
    })
    const state = await start(harness)

    await harness.service.reply({
      sessionId: state.sessionId,
      npcId: 'friendly-aide',
      npcName: 'Asha',
      dialogue: { persona: 'friendly-aide' },
      history: [],
    })

    expect(requests[0]?.context.memory).toBeUndefined()
    expect(requests[0]?.context).not.toHaveProperty('memory')
  })

  it('projects a bucketed relationship hint from the provided relationshipState', async () => {
    const requests: NPCDialogueRequest[] = []
    const harness = createHarness({
      reply: async (request) => {
        requests.push(request)
        return { text: 'A familiar answer.' }
      },
    })
    const state = await start(harness)
    const scope = { worldId: state.worldId, sessionId: state.sessionId, npcId: 'friendly-aide' }
    const relationshipState: NpcRelationshipState = {
      ...neutralRelationship(scope),
      axes: { ...neutralRelationship(scope).axes, familiarity: 50 },
    }

    await harness.service.reply({
      sessionId: state.sessionId,
      npcId: 'friendly-aide',
      npcName: 'Asha',
      dialogue: { persona: 'friendly-aide' },
      history: [],
      relationshipState,
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.context.relationship).toEqual({
      schemaVersion: 1,
      subject: 'npc',
      object: 'player',
      familiarityBucket: 'medium',
      trustBucket: 'neutral',
      respectBucket: 'neutral',
      fearBucket: 'none',
    })
  })

  it('degrades to the neutral/no-familiarity relationship context when relationshipState is absent', async () => {
    const requests: NPCDialogueRequest[] = []
    const harness = createHarness({
      reply: async (request) => {
        requests.push(request)
        return { text: 'A plain answer.' }
      },
    })
    const state = await start(harness)

    await harness.service.reply({
      sessionId: state.sessionId,
      npcId: 'friendly-aide',
      npcName: 'Asha',
      dialogue: { persona: 'friendly-aide' },
      history: [],
    })

    expect(requests[0]?.context.relationship).toEqual({
      schemaVersion: 1,
      subject: 'npc',
      object: 'player',
      familiarityBucket: 'none',
      trustBucket: 'neutral',
      respectBucket: 'neutral',
      fearBucket: 'none',
    })
  })

  it('does not leak one npc relationship state into another npc dialogue context', async () => {
    const requests: NPCDialogueRequest[] = []
    const harness = createHarness({
      reply: async (request) => {
        requests.push(request)
        return { text: 'ok' }
      },
    })
    const state = await start(harness)
    const scopeA = { worldId: state.worldId, sessionId: state.sessionId, npcId: 'aide-a' }
    const relationshipA: NpcRelationshipState = {
      ...neutralRelationship(scopeA),
      axes: { ...neutralRelationship(scopeA).axes, familiarity: 90 },
    }

    await harness.service.reply({
      sessionId: state.sessionId,
      npcId: 'aide-a',
      npcName: 'Asha',
      dialogue: { persona: 'friendly-aide' },
      history: [],
      relationshipState: relationshipA,
    })
    await harness.service.reply({
      sessionId: state.sessionId,
      npcId: 'aide-b',
      npcName: 'Bram',
      dialogue: { persona: 'stern-guard' },
      history: [],
    })

    expect(requests).toHaveLength(2)
    expect(requests[0]?.context.relationship?.familiarityBucket).toBe('high')
    expect(requests[1]?.context.relationship).toEqual({
      schemaVersion: 1,
      subject: 'npc',
      object: 'player',
      familiarityBucket: 'none',
      trustBucket: 'neutral',
      respectBucket: 'neutral',
      fearBucket: 'none',
    })
  })

  it('rejects missing dialogue before reading the session or provider', async () => {
    let reads = 0
    let replies = 0
    const logger = createSpyLogger([])
    const service = new NPCDialogueService(
      { getWorldState: async () => { reads += 1; return { ok: false, error: { code: 'not-found', message: 'missing' } } } },
      { reply: async () => { replies += 1; return { text: 'unused' } } },
      logger,
    )
    expect(await service.reply({
      sessionId: '00000000-0000-4000-8000-000000000099',
      npcId: 'npc',
      npcName: 'Nobody',
      history: [],
    })).toEqual({ status: 'rejected', reason: 'missing-dialogue' })
    expect(reads).toBe(0)
    expect(replies).toBe(0)
  })

  it('returns not-found for a missing session', async () => {
    const harness = createHarness()
    expect(await harness.service.reply({
      sessionId: '00000000-0000-4000-8000-000000000099',
      npcId: 'friendly-aide',
      npcName: 'Asha',
      dialogue,
      history: [],
    })).toEqual({ status: 'failed', reason: 'not-found' })
  })

  it('maps provider throws to provider-unavailable', async () => {
    const harness = createHarness({
      reply: async () => { throw new Error('SECRET PROVIDER FAILURE') },
    })
    const state = await start(harness)
    expect(await harness.service.reply({
      sessionId: state.sessionId,
      npcId: 'friendly-aide',
      npcName: 'Asha',
      dialogue,
      history: [],
    })).toEqual({ status: 'failed', reason: 'provider-unavailable' })
  })

  it('is read-only across repeated replies and leaves the event log unchanged', async () => {
    const harness = createHarness()
    const state = await start(harness)
    const before = await harness.store.listEvents(state.sessionId)
    let history = [] as { speaker: 'player' | 'npc'; text: string }[]

    for (let index = 0; index < 3; index += 1) {
      const result = await harness.service.reply({
        sessionId: state.sessionId,
        npcId: 'friendly-aide',
        npcName: 'Asha',
        dialogue,
        history,
      })
      if (result.status !== 'replied') throw new Error(result.reason)
      history = [...history, result.turn]
    }

    expect(await harness.store.listEvents(state.sessionId)).toEqual(before)
    expect(before).toHaveLength(1)
  })

  it('logs ids, counts, statuses, and codes without dialogue or world content', async () => {
    const harness = createHarness()
    const state = await start(harness)
    await harness.service.reply({
      sessionId: state.sessionId,
      npcId: 'friendly-aide',
      npcName: 'SECRET NPC NAME',
      dialogue,
      persona: 'SECRET INPUT PERSONA',
      roomContext: {
        focus: { type: 'altar', direction: 'north' },
        features: [
          { type: 'altar', direction: 'north' },
          { type: 'corpse', direction: 'south' },
        ],
        affordances: ['inspect', 'talk'],
        npcCount: 2,
      },
      history: [{ speaker: 'player', text: 'SECRET HISTORY TEXT' }],
      promptId: 'SECRET PROMPT ID',
      playerLine: 'SECRET PLAYER LINE',
    })

    const serialized = JSON.stringify(harness.entries)
    expect(serialized).not.toContain('SECRET')
    expect(serialized).toContain(state.sessionId)
    expect(serialized).toContain('friendly-aide')
    expect(serialized).toContain('throne-room')
    expect(serialized).toContain('replied')
    expect(serialized).toContain('turnCount')
    expect(serialized).not.toContain('roomContext')
    expect(serialized).not.toContain('focus')
    expect(serialized).not.toContain('features')
    expect(serialized).not.toContain('affordances')
    expect(serialized).not.toContain('npcCount')
    expect(serialized).not.toContain('altar')
    expect(serialized).not.toContain('corpse')
    expect(serialized).not.toContain('inspect')
    expect(serialized).not.toContain('talk')
  })
})

function createSpyLogger(entries: LogEntry[], bindings: LogContext = {}): Logger {
  const record = (level: LogLevel) => (message: string, context: LogContext = {}) => {
    entries.push({ level, message, context: { ...bindings, ...context } })
  }
  return {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: (childBindings) => createSpyLogger(entries, { ...bindings, ...childBindings }),
  }
}
