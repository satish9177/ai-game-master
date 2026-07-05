import { describe, expect, it, vi } from 'vitest'
import {
  DIALOGUE_SEMANTIC_EVENT_SCHEMA_VERSION,
  DialogueSemanticEventKindSchema,
  type DialogueSemanticEvent,
  type DialogueSemanticEventActor,
  type DialogueSemanticEventKind,
  type DialogueSemanticEventTarget,
} from '../dialogueEvents/contracts'
import { StructuredDialogueEffectKindSchema, StructuredDialogueEffectSchema, type StructuredDialogueEffectKind } from './contracts'
import { deriveStructuredDialogueEffects, EFFECT_KIND_BY_SOURCE_KIND } from './derive'
import { validateStructuredDialogueEffect } from './validate'

// The 3 semantic-event kinds with no candidate mapping in v0 (map to no effect).
const RESERVED_EVENT_KINDS: DialogueSemanticEventKind[] = [
  'player_shared_claim',
  'npc_revealed_rumor',
  'npc_acknowledged_memory',
]

// The 9 valenced sourceKind -> candidateKind pairs wired in this slice. The map is
// dry: reachable only by directly injecting one of these semantic-event kinds,
// since classifyDialogueTurn never emits them.
const VALENCED_SOURCE_KINDS: ReadonlyArray<{
  sourceKind: DialogueSemanticEventKind
  candidateKind: StructuredDialogueEffectKind
  actor: DialogueSemanticEventActor
  target: DialogueSemanticEventTarget
}> = [
  { sourceKind: 'player_threatened_npc', candidateKind: 'player_threat_candidate', actor: 'player', target: 'npc' },
  { sourceKind: 'player_apologized', candidateKind: 'player_apology_candidate', actor: 'player', target: 'npc' },
  { sourceKind: 'player_thanked_npc', candidateKind: 'player_gratitude_candidate', actor: 'player', target: 'npc' },
  { sourceKind: 'player_insulted_npc', candidateKind: 'player_insult_candidate', actor: 'player', target: 'npc' },
  { sourceKind: 'player_refused_request', candidateKind: 'player_refusal_candidate', actor: 'player', target: 'npc' },
  { sourceKind: 'player_promised_help', candidateKind: 'player_promise_candidate', actor: 'player', target: 'npc' },
  { sourceKind: 'npc_warned_player', candidateKind: 'npc_warning_candidate', actor: 'npc', target: 'player' },
  { sourceKind: 'npc_offered_help', candidateKind: 'npc_offer_candidate', actor: 'npc', target: 'player' },
  { sourceKind: 'npc_refused_request', candidateKind: 'npc_refusal_candidate', actor: 'npc', target: 'player' },
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

describe('EFFECT_KIND_BY_SOURCE_KIND (dry map consistency)', () => {
  it('has exactly 11 entries: the 2 existing plus the 9 valenced additions', () => {
    expect(Object.keys(EFFECT_KIND_BY_SOURCE_KIND)).toHaveLength(11)
  })

  it('has every key as a valid DialogueSemanticEventKind', () => {
    for (const key of Object.keys(EFFECT_KIND_BY_SOURCE_KIND)) {
      expect(DialogueSemanticEventKindSchema.safeParse(key).success).toBe(true)
    }
  })

  it('has every value as a valid StructuredDialogueEffectKind', () => {
    for (const value of Object.values(EFFECT_KIND_BY_SOURCE_KIND)) {
      expect(StructuredDialogueEffectKindSchema.safeParse(value).success).toBe(true)
    }
  })

  it('reaches every valenced candidate kind from exactly one source kind', () => {
    const mappedCandidateKinds = Object.values(EFFECT_KIND_BY_SOURCE_KIND)

    for (const { candidateKind } of VALENCED_SOURCE_KINDS) {
      const occurrences = mappedCandidateKinds.filter((kind) => kind === candidateKind)
      expect(occurrences).toHaveLength(1)
    }
  })

  it('leaves the 3 reserved event kinds unmapped', () => {
    for (const reservedKind of RESERVED_EVENT_KINDS) {
      expect(EFFECT_KIND_BY_SOURCE_KIND[reservedKind]).toBeUndefined()
    }
  })
})

describe('valenced candidate direct injection (map is wired, source stays dry)', () => {
  it.each(VALENCED_SOURCE_KINDS)(
    'maps directly injected $sourceKind to $candidateKind with the expected actor/target',
    ({ sourceKind, candidateKind, actor, target }) => {
      const event = validEvent({
        eventId: `dialogue-event-${sourceKind}`,
        kind: sourceKind,
        actor,
        target,
      })

      const [effect] = deriveStructuredDialogueEffects([event], {
        makeEffectId: () => `effect-${sourceKind}`,
      })

      expect(effect).toMatchObject({
        kind: candidateKind,
        sourceEventId: event.eventId,
        sourceKind: event.kind,
        actor,
        target,
      })
      expect(StructuredDialogueEffectSchema.safeParse(effect).success).toBe(true)
      expect(validateStructuredDialogueEffect(effect)).toEqual(effect)
    },
  )

  it('derives all 9 valenced candidates in one pass from directly injected events', () => {
    const events = VALENCED_SOURCE_KINDS.map(({ sourceKind, actor, target }, index) =>
      validEvent({ eventId: `dialogue-event-${index}`, kind: sourceKind, actor, target }),
    )

    const effects = deriveStructuredDialogueEffects(events, {
      makeEffectId: (sourceEvent) => `effect-for-${sourceEvent.eventId}`,
    })

    expect(effects).toHaveLength(VALENCED_SOURCE_KINDS.length)
    expect(effects.map((effect) => effect.kind)).toEqual(VALENCED_SOURCE_KINDS.map((entry) => entry.candidateKind))
  })
})
