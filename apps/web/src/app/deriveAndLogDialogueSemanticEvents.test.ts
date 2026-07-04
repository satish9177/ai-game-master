import { describe, expect, it, vi } from 'vitest'
import type { LogContext, Logger, LogLevel } from '../platform/logger/Logger'
import {
  deriveAndLogDialogueSemanticEvents,
  type DeriveAndLogDialogueSemanticEventsInput,
} from './deriveAndLogDialogueSemanticEvents'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

function createSpyLogger(entries: LogEntry[]): Logger {
  const record = (level: LogLevel) => (message: string, context: LogContext = {}) => {
    entries.push({ level, message, context })
  }
  return {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => createSpyLogger(entries),
  }
}

function input(overrides: Partial<DeriveAndLogDialogueSemanticEventsInput> = {}): DeriveAndLogDialogueSemanticEventsInput {
  const logs: LogEntry[] = []
  return {
    scope: {
      worldId: 'world-1',
      sessionId: 'session-1',
      roomId: 'room-1',
      npcId: 'npc-1',
    },
    promptId: 'ask-room',
    turnIndex: 2,
    hasNpcReply: true,
    makeEventId: (kind, indexInTurn) => `event-${kind}-${indexInTurn}`,
    logger: createSpyLogger(logs),
    ...overrides,
  }
}

describe('deriveAndLogDialogueSemanticEvents', () => {
  it('classifies with the supplied real scope and logs safe structural fields only', () => {
    const logs: LogEntry[] = []
    const events = deriveAndLogDialogueSemanticEvents(input({ logger: createSpyLogger(logs) }))

    expect(events.map((event) => event.kind)).toEqual(['player_asked_question', 'npc_responded'])
    for (const event of events) {
      expect(event.scope).toEqual({
        worldId: 'world-1',
        sessionId: 'session-1',
        roomId: 'room-1',
        npcId: 'npc-1',
      })
    }
    expect(logs).toEqual([
      {
        level: 'info',
        message: 'dialogue semantic events derived',
        context: {
          count: 2,
          kinds: 'player_asked_question,npc_responded',
          actors: 'player,npc',
          targets: 'npc,player',
          confidences: 'high',
          worldId: 'world-1',
          sessionId: 'session-1',
          roomId: 'room-1',
          npcId: 'npc-1',
          promptId: 'ask-room',
        },
      },
    ])
    for (const value of Object.values(logs[0]!.context)) {
      expect(['string', 'number', 'boolean', 'undefined']).toContain(typeof value)
    }
  })

  it('emits player_asked_question for ask-room and ask-help', () => {
    expect(deriveAndLogDialogueSemanticEvents(input({ promptId: 'ask-room', hasNpcReply: false })).map((event) => event.kind))
      .toEqual(['player_asked_question'])
    expect(deriveAndLogDialogueSemanticEvents(input({ promptId: 'ask-help', hasNpcReply: false })).map((event) => event.kind))
      .toEqual(['player_asked_question'])
  })

  it('emits npc_responded only when hasNpcReply is true', () => {
    expect(deriveAndLogDialogueSemanticEvents(input({ promptId: undefined, hasNpcReply: true })).map((event) => event.kind))
      .toEqual(['npc_responded'])
    expect(deriveAndLogDialogueSemanticEvents(input({ promptId: undefined, hasNpcReply: false }))).toEqual([])
  })

  it('ignores unknown promptId for player_asked_question', () => {
    const events = deriveAndLogDialogueSemanticEvents(input({ promptId: 'ask-lore', hasNpcReply: true }))

    expect(events.map((event) => event.kind)).toEqual(['npc_responded'])
  })

  it('does not call storage, world, memory, persistence, provider, or state seams', () => {
    const forbidden = vi.fn()
    const events = deriveAndLogDialogueSemanticEvents(input())

    expect(events).toHaveLength(2)
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('does not log raw prose-shaped fields even if extra input carries them', () => {
    const logs: LogEntry[] = []
    const events = deriveAndLogDialogueSemanticEvents({
      ...input({ logger: createSpyLogger(logs) }),
      playerLine: 'SECRET PLAYER LINE',
      npcText: 'SECRET NPC TEXT',
      providerText: 'SECRET PROVIDER TEXT',
      memoryText: 'SECRET MEMORY TEXT',
    } as DeriveAndLogDialogueSemanticEventsInput)

    expect(events).toHaveLength(2)
    expect(JSON.stringify(logs)).not.toContain('SECRET PLAYER LINE')
    expect(JSON.stringify(logs)).not.toContain('SECRET NPC TEXT')
    expect(JSON.stringify(logs)).not.toContain('SECRET PROVIDER TEXT')
    expect(JSON.stringify(logs)).not.toContain('SECRET MEMORY TEXT')
  })
})
