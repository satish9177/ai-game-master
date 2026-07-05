import { describe, expect, it } from 'vitest'
import { classifyDialogueTurn, type DialogueTurnClassificationInput } from '../domain/dialogueEvents/classify'
import { STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION } from '../domain/structuredDialogueEffects/contracts'
import type { StructuredDialogueEffect } from '../domain/structuredDialogueEffects/contracts'
import { deriveStructuredDialogueEffects } from '../domain/structuredDialogueEffects/derive'
import { neutralRelationship } from '../domain/npcRelationship/neutral'
import type { RelationshipReductionContext } from '../domain/npcRelationship/reducer'
import type { LogContext, Logger, LogLevel } from '../platform/logger/Logger'
import {
  deriveAndReduceRelationship,
  type DeriveAndReduceRelationshipInput,
} from './deriveAndReduceRelationship'

type LogEntry = { level: LogLevel; message: string; context: LogContext }

const FORBIDDEN_MARKERS = [
  'SECRET_PLAYER_LINE',
  'SECRET_NPC_TEXT',
  'SECRET_PROVIDER_TEXT',
  'SECRET_PROMPT_BODY',
]

const CTX: RelationshipReductionContext = {
  worldId: 'world-1',
  sessionId: 'session-1',
  npcId: 'npc-1',
}

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

function neutralPrior() {
  return neutralRelationship({ worldId: CTX.worldId, sessionId: CTX.sessionId, npcId: CTX.npcId })
}

function questionEffect(overrides: Partial<StructuredDialogueEffect> = {}): StructuredDialogueEffect {
  return {
    schemaVersion: STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
    effectId: 'structured-dialogue-effect-1',
    kind: 'player_question_effect_candidate',
    sourceEventId: 'dialogue-event-1',
    sourceKind: 'player_asked_question',
    status: 'candidate',
    actor: 'player',
    target: 'npc',
    scope: {
      worldId: CTX.worldId,
      sessionId: CTX.sessionId,
      roomId: 'room-1',
      npcId: CTX.npcId,
    },
    provenance: {
      classifier: 'deterministic-local',
      promptId: 'ask-room',
      turnIndex: 0,
    },
    confidence: 'high',
    ...overrides,
  }
}

function input(overrides: Partial<DeriveAndReduceRelationshipInput> = {}): DeriveAndReduceRelationshipInput {
  const logs: LogEntry[] = []
  return {
    effects: [questionEffect()],
    prior: neutralPrior(),
    ctx: CTX,
    logger: createSpyLogger(logs),
    ...overrides,
  }
}

function liveChainInput(
  overrides: Partial<DialogueTurnClassificationInput> = {},
): DialogueTurnClassificationInput {
  return {
    scope: {
      worldId: CTX.worldId,
      sessionId: CTX.sessionId,
      roomId: 'room-1',
      npcId: CTX.npcId,
    },
    hasNpcReply: true,
    makeEventId: (kind, indexInTurn) => `live-chain-event-${kind}-${indexInTurn}`,
    ...overrides,
  }
}

function runLiveChain(
  classificationInput: DialogueTurnClassificationInput,
  prior = neutralPrior(),
) {
  const events = classifyDialogueTurn(classificationInput)
  const effects = deriveStructuredDialogueEffects(events, {
    makeEffectId: (sourceEvent, indexInTurn) => `live-chain-effect-${sourceEvent.kind}-${indexInTurn}`,
  })
  const logs: LogEntry[] = []
  const result = deriveAndReduceRelationship(input({ effects, prior, logger: createSpyLogger(logs) }))

  return { events, effects, result, logs }
}

describe('deriveAndReduceRelationship', () => {
  it('calls the reducer with the validated effects and returns the updated projection', () => {
    const result = deriveAndReduceRelationship(input())

    expect(result.reducerInvoked).toBe(true)
    expect(result.appliedCount).toBe(1)
    expect(result.ignoredCount).toBe(0)
    expect(result.state.axes.familiarity).toBe(1)
  })

  it('does not call the reducer when there are no effects, and returns the same prior reference unchanged', () => {
    const prior = neutralPrior()
    const logs: LogEntry[] = []
    const result = deriveAndReduceRelationship(input({ effects: [], prior, logger: createSpyLogger(logs) }))

    expect(result.reducerInvoked).toBe(false)
    expect(result.appliedCount).toBe(0)
    expect(result.ignoredCount).toBe(0)
    expect(result.clampedAxes).toBe(0)
    expect(result.state).toBe(prior)
    expect(logs).toEqual([])
  })

  it('only ever moves familiarity for the currently emitted neutral candidates', () => {
    const result = deriveAndReduceRelationship(
      input({
        effects: [
          questionEffect(),
          questionEffect({ effectId: 'structured-dialogue-effect-2', kind: 'npc_response_effect_candidate', sourceEventId: 'dialogue-event-2', sourceKind: 'npc_responded', actor: 'npc', target: 'player' }),
        ],
      }),
    )

    expect(result.state.axes.familiarity).toBeGreaterThan(0)
    expect(result.state.axes.trust).toBe(0)
    expect(result.state.axes.respect).toBe(0)
    expect(result.state.axes.fear).toBe(0)
  })

  it('does not throw and does not mutate the prior projection for malformed/rejected effects', () => {
    const prior = neutralPrior()
    const malformed = [
      { ...questionEffect(), extra: 'field' } as unknown as StructuredDialogueEffect,
      questionEffect({ scope: { ...questionEffect().scope, worldId: 'wrong-world' } }),
    ]

    expect(() => deriveAndReduceRelationship(input({ effects: malformed, prior }))).not.toThrow()

    const result = deriveAndReduceRelationship(input({ effects: malformed, prior }))
    expect(result.state.axes).toEqual(prior.axes)
    expect(result.appliedCount).toBe(0)
    expect(result.ignoredCount).toBe(2)
    // Reducer was still invoked (effects.length > 0) even though everything
    // was rejected -- this is distinct from the "no effects" no-call path.
    expect(result.reducerInvoked).toBe(true)
  })

  it('logs only safe counters and a closed familiarity bucket, never raw dialogue text', () => {
    const logs: LogEntry[] = []
    // Simulate an attempted text-bearing input field; it must never reach
    // the log regardless, since the real input type carries no text at all.
    deriveAndReduceRelationship({
      ...input({ logger: createSpyLogger(logs) }),
      playerLine: FORBIDDEN_MARKERS[0],
      npcText: FORBIDDEN_MARKERS[1],
    } as DeriveAndReduceRelationshipInput)

    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      level: 'info',
      message: 'npc relationship reduced',
      context: {
        processed: 1,
        applied: 1,
        rejected: 0,
        clampedAxes: 0,
        interactionCount: 1,
        familiarityBucket: 'low',
        worldId: CTX.worldId,
        sessionId: CTX.sessionId,
        npcId: CTX.npcId,
      },
    })

    const serialized = JSON.stringify(logs)
    for (const marker of FORBIDDEN_MARKERS) {
      expect(serialized).not.toContain(marker)
    }
    for (const value of Object.values(logs[0]!.context)) {
      expect(['string', 'number', 'boolean', 'undefined']).toContain(typeof value)
    }
  })

  it('logs a "none" familiarity bucket at baseline and "high" once familiarity climbs past 66', () => {
    const noneLogs: LogEntry[] = []
    deriveAndReduceRelationship(
      input({
        effects: [{ ...questionEffect(), target: 'room' }],
        logger: createSpyLogger(noneLogs),
      }),
    )
    expect(noneLogs[0]?.context.familiarityBucket).toBe('none')

    const highPrior = { ...neutralPrior(), axes: { trust: 0, respect: 0, fear: 0, familiarity: 67 } }
    const highLogs: LogEntry[] = []
    deriveAndReduceRelationship(input({ prior: highPrior, logger: createSpyLogger(highLogs) }))
    expect(highLogs[0]?.context.familiarityBucket).toBe('high')
  })

  it('does not mutate the effects input array', () => {
    const effects = [questionEffect()]
    const before = structuredClone(effects)

    deriveAndReduceRelationship(input({ effects }))

    expect(effects).toEqual(before)
  })
})

describe('classifyDialogueTurn -> deriveStructuredDialogueEffects -> deriveAndReduceRelationship', () => {
  it('keeps normal free text dry for signed valenced movement', () => {
    const { events, effects, result } = runLiveChain(
      {
        ...liveChainInput({ promptId: undefined, hasNpcReply: true }),
        playerLine: 'Could you tell me what happened here?',
      } as DialogueTurnClassificationInput,
    )

    expect(events.map((event) => event.kind)).toEqual(['npc_responded'])
    expect(effects.map((effect) => effect.kind)).toEqual(['npc_response_effect_candidate'])
    expect(result.state.axes).toEqual({ trust: 0, respect: 0, fear: 0, familiarity: 1 })
  })

  it('keeps an unknown promptId dry for signed valenced movement', () => {
    const { events, effects, result } = runLiveChain(
      {
        ...liveChainInput({ promptId: 'ask-rumor', hasNpcReply: true }),
        playerLine: 'This is just ordinary free text.',
      } as DialogueTurnClassificationInput,
    )

    expect(events.map((event) => event.kind)).toEqual(['npc_responded'])
    expect(effects.map((effect) => effect.kind)).toEqual(['npc_response_effect_candidate'])
    expect(result.state.axes).toEqual({ trust: 0, respect: 0, fear: 0, familiarity: 1 })
  })

  it.each(['ask-room', 'ask-help'] as const)('keeps %s unchanged: only familiarity moves', (promptId) => {
    const { events, effects, result } = runLiveChain(liveChainInput({ promptId, hasNpcReply: true }))

    expect(events.map((event) => event.kind)).toEqual(['player_asked_question', 'npc_responded'])
    expect(effects.map((effect) => effect.kind)).toEqual([
      'player_question_effect_candidate',
      'npc_response_effect_candidate',
    ])
    expect(result.state.axes.trust).toBe(0)
    expect(result.state.axes.respect).toBe(0)
    expect(result.state.axes.fear).toBe(0)
    expect(result.state.axes.familiarity).toBeGreaterThan(0)
  })

  it('ignores adversarial playerLine text containing candidate and source kind names', () => {
    const adversarialLine = [
      'player_threat_candidate',
      'player_apology_candidate',
      'player_gratitude_candidate',
      'player_insult_candidate',
      'player_threatened_npc',
      'player_apologized',
      'player_thanked_npc',
      'player_insulted_npc',
    ].join(' ')
    const { events, effects, result, logs } = runLiveChain(
      {
        ...liveChainInput({ promptId: 'ask-room', hasNpcReply: true }),
        playerLine: adversarialLine,
        npcText: adversarialLine,
      } as DialogueTurnClassificationInput,
    )

    expect(events.map((event) => event.kind)).toEqual(['player_asked_question', 'npc_responded'])
    expect(effects.map((effect) => effect.kind)).toEqual([
      'player_question_effect_candidate',
      'npc_response_effect_candidate',
    ])
    expect(result.state.axes).toEqual({ trust: 0, respect: 0, fear: 0, familiarity: 2 })
    expect(JSON.stringify(logs)).not.toContain(adversarialLine)
  })
})
