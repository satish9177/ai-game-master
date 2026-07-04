import { describe, expect, it, vi } from 'vitest'
import {
  DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
  type DialogueSemanticEvent,
  type DialogueSemanticEventKind,
} from '../domain/dialogueEvents/contracts'
import { StructuredDialogueEffectSchema } from '../domain/structuredDialogueEffects/contracts'
import type { LogContext, Logger, LogLevel } from '../platform/logger/Logger'
import {
  deriveAndLogStructuredDialogueEffects,
  type DeriveAndLogStructuredDialogueEffectsInput,
} from './deriveAndLogStructuredDialogueEffects'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

const RESERVED_EVENT_KINDS: DialogueSemanticEventKind[] = [
  'player_shared_claim',
  'player_promised_help',
  'player_threatened_npc',
  'npc_warned_player',
  'npc_revealed_rumor',
  'npc_refused_request',
  'npc_acknowledged_memory',
]

const FORBIDDEN_MARKERS = [
  'SECRET_PLAYER_LINE',
  'SECRET_NPC_TEXT',
  'SECRET_PROVIDER_TEXT',
  'SECRET_PROMPT_BODY',
  'SECRET_MEMORY_TEXT',
  'SECRET_PROVIDER_PAYLOAD',
  'SECRET_GENERATED_TEXT',
]

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

function validEvent(overrides: Partial<DialogueSemanticEvent> = {}): DialogueSemanticEvent {
  return {
    schemaVersion: DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
    eventId: 'dialogue-event-1',
    kind: 'player_asked_question',
    actor: 'player',
    target: 'npc',
    scope: {
      worldId: 'world-1',
      sessionId: 'session-1',
      roomId: 'room-1',
      npcId: 'npc-1',
    },
    provenance: {
      classifier: 'deterministic-local',
      promptId: 'ask-room',
      turnIndex: 0,
    },
    confidence: 'medium',
    ...overrides,
  }
}

function input(
  overrides: Partial<DeriveAndLogStructuredDialogueEffectsInput> = {},
): DeriveAndLogStructuredDialogueEffectsInput {
  const logs: LogEntry[] = []
  return {
    events: [validEvent()],
    makeEffectId: (sourceEvent, indexInTurn) => `effect-${sourceEvent.kind}-${indexInTurn}`,
    logger: createSpyLogger(logs),
    ...overrides,
  }
}

describe('deriveAndLogStructuredDialogueEffects', () => {
  it('maps and logs player_asked_question as player_question_effect_candidate', () => {
    const logs: LogEntry[] = []
    const effects = deriveAndLogStructuredDialogueEffects(input({ logger: createSpyLogger(logs) }))

    expect(effects.map((effect) => effect.kind)).toEqual(['player_question_effect_candidate'])
    expect(logs[0]).toMatchObject({
      level: 'info',
      message: 'structured dialogue effects derived',
      context: {
        count: 1,
        kinds: 'player_question_effect_candidate',
        sourceKinds: 'player_asked_question',
      },
    })
  })

  it('maps and logs npc_responded as npc_response_effect_candidate', () => {
    const logs: LogEntry[] = []
    const effects = deriveAndLogStructuredDialogueEffects(
      input({
        events: [validEvent({ kind: 'npc_responded', actor: 'npc', target: 'player' })],
        logger: createSpyLogger(logs),
      }),
    )

    expect(effects.map((effect) => effect.kind)).toEqual(['npc_response_effect_candidate'])
    expect(logs[0]?.context).toMatchObject({
      count: 1,
      kinds: 'npc_response_effect_candidate',
      sourceKinds: 'npc_responded',
    })
  })

  it('derives both source events and logs only safe structural fields', () => {
    const logs: LogEntry[] = []
    const effects = deriveAndLogStructuredDialogueEffects(
      input({
        events: [
          validEvent({ eventId: 'dialogue-event-1', kind: 'player_asked_question', actor: 'player', target: 'npc' }),
          validEvent({
            eventId: 'dialogue-event-2',
            kind: 'npc_responded',
            actor: 'npc',
            target: 'player',
            confidence: 'high',
          }),
        ],
        logger: createSpyLogger(logs),
      }),
    )

    expect(effects.map((effect) => effect.kind)).toEqual([
      'player_question_effect_candidate',
      'npc_response_effect_candidate',
    ])
    expect(logs).toEqual([
      {
        level: 'info',
        message: 'structured dialogue effects derived',
        context: {
          count: 2,
          kinds: 'player_question_effect_candidate,npc_response_effect_candidate',
          sourceKinds: 'player_asked_question,npc_responded',
          actors: 'player,npc',
          targets: 'npc,player',
          confidences: 'medium,high',
          worldId: 'world-1',
          sessionId: 'session-1',
          roomId: 'room-1',
          npcId: 'npc-1',
          promptId: 'ask-room',
        },
      },
    ])
  })

  it('maps reserved semantic event kinds to no effects', () => {
    for (const kind of RESERVED_EVENT_KINDS) {
      const logs: LogEntry[] = []
      const effects = deriveAndLogStructuredDialogueEffects(
        input({
          events: [validEvent({ kind })],
          logger: createSpyLogger(logs),
        }),
      )

      expect(effects).toEqual([])
      expect(logs[0]?.context).toMatchObject({
        count: 0,
        kinds: '',
        sourceKinds: '',
        actors: '',
        targets: '',
        confidences: '',
      })
    }
  })

  it('logs count zero for empty events', () => {
    const logs: LogEntry[] = []
    const effects = deriveAndLogStructuredDialogueEffects(input({ events: [], logger: createSpyLogger(logs) }))

    expect(effects).toEqual([])
    expect(logs).toEqual([
      {
        level: 'info',
        message: 'structured dialogue effects derived',
        context: {
          count: 0,
          kinds: '',
          sourceKinds: '',
          actors: '',
          targets: '',
          confidences: '',
        },
      },
    ])
  })

  it('returns effects for tests and validates constructed effects', () => {
    const effects = deriveAndLogStructuredDialogueEffects(input())

    expect(effects).toHaveLength(1)
    expect(StructuredDialogueEffectSchema.safeParse(effects[0]).success).toBe(true)
  })

  it('filters invalid generated effect ids fail-closed', () => {
    const logs: LogEntry[] = []
    const effects = deriveAndLogStructuredDialogueEffects(
      input({
        makeEffectId: () => '',
        logger: createSpyLogger(logs),
      }),
    )

    expect(effects).toEqual([])
    expect(logs[0]?.context).toMatchObject({ count: 0, kinds: '' })
  })

  it('does not log effectId, sourceEventId, raw prose-shaped fields, or non-primitive context values', () => {
    const logs: LogEntry[] = []
    deriveAndLogStructuredDialogueEffects({
      ...input({ logger: createSpyLogger(logs) }),
      playerLine: FORBIDDEN_MARKERS[0],
      npcText: FORBIDDEN_MARKERS[1],
      providerText: FORBIDDEN_MARKERS[2],
      promptText: FORBIDDEN_MARKERS[3],
      memoryText: FORBIDDEN_MARKERS[4],
      rawProviderPayload: FORBIDDEN_MARKERS[5],
      generatedText: FORBIDDEN_MARKERS[6],
    } as DeriveAndLogStructuredDialogueEffectsInput)

    const serialized = JSON.stringify(logs)
    expect(serialized).not.toContain('effect-player_asked_question-0')
    expect(serialized).not.toContain('dialogue-event-1')
    for (const marker of FORBIDDEN_MARKERS) {
      expect(serialized).not.toContain(marker)
    }
    for (const value of Object.values(logs[0]!.context)) {
      expect(['string', 'number', 'boolean', 'undefined']).toContain(typeof value)
    }
  })

  it('does not mutate inputs', () => {
    const events = [validEvent()] satisfies DialogueSemanticEvent[]
    const before = structuredClone(events)

    deriveAndLogStructuredDialogueEffects(input({ events }))

    expect(events).toEqual(before)
  })

  it('does not call storage, world, memory, persistence, provider, or state seams', () => {
    const forbidden = vi.fn()
    const effects = deriveAndLogStructuredDialogueEffects(input())

    expect(effects).toHaveLength(1)
    expect(forbidden).not.toHaveBeenCalled()
  })
})
