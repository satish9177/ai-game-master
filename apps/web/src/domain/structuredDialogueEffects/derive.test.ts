import { describe, expect, it, vi } from 'vitest'
import {
  DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
  type DialogueSemanticEvent,
  type DialogueSemanticEventKind,
} from '../dialogueEvents/contracts'
import { StructuredDialogueEffectSchema } from './contracts'
import { deriveStructuredDialogueEffects } from './derive'
import { validateStructuredDialogueEffect } from './validate'

const RESERVED_EVENT_KINDS: DialogueSemanticEventKind[] = [
  'player_shared_claim',
  'player_promised_help',
  'player_threatened_npc',
  'npc_warned_player',
  'npc_revealed_rumor',
  'npc_refused_request',
  'npc_acknowledged_memory',
]

const FORBIDDEN_TEXT_FIELDS = [
  'snippet',
  'text',
  'playerLine',
  'npcText',
  'providerText',
  'promptText',
  'memoryText',
  'effectPayload',
]

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

describe('deriveStructuredDialogueEffects', () => {
  it('maps player_asked_question to player_question_effect_candidate', () => {
    const [effect] = deriveStructuredDialogueEffects([validEvent()], {
      makeEffectId: () => 'effect-1',
    })

    expect(effect).toMatchObject({
      effectId: 'effect-1',
      kind: 'player_question_effect_candidate',
      sourceEventId: 'dialogue-event-1',
      sourceKind: 'player_asked_question',
    })
  })

  it('maps npc_responded to npc_response_effect_candidate', () => {
    const event = validEvent({
      eventId: 'dialogue-event-2',
      kind: 'npc_responded',
      actor: 'npc',
      target: 'player',
    })
    const [effect] = deriveStructuredDialogueEffects([event], {
      makeEffectId: () => 'effect-1',
    })

    expect(effect).toMatchObject({
      effectId: 'effect-1',
      kind: 'npc_response_effect_candidate',
      sourceEventId: 'dialogue-event-2',
      sourceKind: 'npc_responded',
    })
  })

  it('derives two effects and calls makeEffectId with increasing indexInTurn', () => {
    const questionEvent = validEvent({ eventId: 'dialogue-event-1', kind: 'player_asked_question' })
    const responseEvent = validEvent({
      eventId: 'dialogue-event-2',
      kind: 'npc_responded',
      actor: 'npc',
      target: 'player',
    })
    const makeEffectId = vi.fn((sourceEvent: DialogueSemanticEvent, indexInTurn: number) => {
      return `${sourceEvent.eventId}-effect-${indexInTurn}`
    })

    const effects = deriveStructuredDialogueEffects([questionEvent, responseEvent], { makeEffectId })

    expect(effects).toHaveLength(2)
    expect(effects.map((effect) => effect.effectId)).toEqual([
      'dialogue-event-1-effect-0',
      'dialogue-event-2-effect-1',
    ])
    expect(makeEffectId).toHaveBeenNthCalledWith(1, questionEvent, 0)
    expect(makeEffectId).toHaveBeenNthCalledWith(2, responseEvent, 1)
  })

  it('maps reserved semantic event kinds to no effects', () => {
    for (const kind of RESERVED_EVENT_KINDS) {
      expect(
        deriveStructuredDialogueEffects([validEvent({ kind })], {
          makeEffectId: () => `effect-for-${kind}`,
        }),
      ).toEqual([])
    }
  })

  it('returns an empty list for empty input', () => {
    expect(
      deriveStructuredDialogueEffects([], {
        makeEffectId: () => 'unused-effect',
      }),
    ).toEqual([])
  })

  it('uses deterministic effect ids from the callback', () => {
    const effects = deriveStructuredDialogueEffects([validEvent({ eventId: 'dialogue-event-9' })], {
      makeEffectId: (sourceEvent, indexInTurn) => `${sourceEvent.eventId}:${indexInTurn}`,
    })

    expect(effects.map((effect) => effect.effectId)).toEqual(['dialogue-event-9:0'])
  })

  it('copies sourceEventId and sourceKind correctly', () => {
    const event = validEvent({
      eventId: 'dialogue-event-source',
      kind: 'npc_responded',
      actor: 'npc',
      target: 'player',
    })
    const [effect] = deriveStructuredDialogueEffects([event], {
      makeEffectId: () => 'effect-1',
    })

    expect(effect?.sourceEventId).toBe(event.eventId)
    expect(effect?.sourceKind).toBe(event.kind)
  })

  it('copies scope, provenance, actor, target, and confidence from the source event', () => {
    const event = validEvent({
      actor: 'npc',
      target: 'room',
      scope: {
        worldId: 'world-copy',
        sessionId: 'session-copy',
        roomId: 'room-copy',
      },
      provenance: {
        classifier: 'deterministic-local',
        promptId: 'ask-help',
        turnIndex: 8,
      },
      confidence: 'high',
    })
    const [effect] = deriveStructuredDialogueEffects([event], {
      makeEffectId: () => 'effect-1',
    })

    expect(effect?.actor).toBe(event.actor)
    expect(effect?.target).toBe(event.target)
    expect(effect?.scope).toEqual(event.scope)
    expect(effect?.provenance).toEqual(event.provenance)
    expect(effect?.confidence).toBe(event.confidence)
  })

  it('returns constructed effects that validate through the schema and validator', () => {
    const [effect] = deriveStructuredDialogueEffects([validEvent()], {
      makeEffectId: () => 'effect-1',
    })

    expect(StructuredDialogueEffectSchema.safeParse(effect).success).toBe(true)
    expect(validateStructuredDialogueEffect(effect)).toEqual(effect)
  })

  it('filters an invalid generated effectId fail-closed', () => {
    expect(
      deriveStructuredDialogueEffects([validEvent()], {
        makeEffectId: () => '',
      }),
    ).toEqual([])
  })

  it('skips mis-cast invalid input events fail-closed', () => {
    const invalidEvent = {
      ...validEvent(),
      kind: 'npc_granted_item',
    } as unknown as DialogueSemanticEvent
    const missingIdEvent = {
      ...validEvent(),
      eventId: '',
    } as DialogueSemanticEvent

    expect(
      deriveStructuredDialogueEffects([invalidEvent, missingIdEvent], {
        makeEffectId: () => 'effect-1',
      }),
    ).toEqual([])
  })

  it('does not mutate input', () => {
    const input = [
      validEvent(),
      validEvent({ eventId: 'dialogue-event-2', kind: 'npc_responded', actor: 'npc', target: 'player' }),
    ] satisfies DialogueSemanticEvent[]
    const before = structuredClone(input)

    deriveStructuredDialogueEffects(input, {
      makeEffectId: (sourceEvent, indexInTurn) => `${sourceEvent.eventId}-${indexInTurn}`,
    })

    expect(input).toEqual(before)
  })

  it('does not accept or propagate raw text or payload fields from mis-cast input', () => {
    for (const field of FORBIDDEN_TEXT_FIELDS) {
      const eventWithText = {
        ...validEvent(),
        [field]: 'raw dialogue text',
      } as unknown as DialogueSemanticEvent

      expect(
        deriveStructuredDialogueEffects([eventWithText], {
          makeEffectId: () => 'effect-1',
        }),
      ).toEqual([])
    }
  })
})
