import { describe, expect, it } from 'vitest'
import { STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION } from './contracts'
import type { StructuredDialogueEffect } from './contracts'
import {
  parseStructuredDialogueEffect,
  validateStructuredDialogueEffect,
} from './validate'

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

function validEffect(overrides: Partial<StructuredDialogueEffect> = {}): StructuredDialogueEffect {
  return {
    schemaVersion: STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
    effectId: 'structured-dialogue-effect-1',
    kind: 'npc_response_effect_candidate',
    sourceEventId: 'dialogue-event-1',
    sourceKind: 'npc_responded',
    status: 'candidate',
    actor: 'npc',
    target: 'player',
    scope: {
      worldId: 'world-1',
      sessionId: 'session-1',
      roomId: 'room-1',
      npcId: 'npc-1',
    },
    provenance: {
      classifier: 'deterministic-local',
      promptId: 'ask-help',
      turnIndex: 3,
    },
    confidence: 'high',
    ...overrides,
  }
}

describe('validateStructuredDialogueEffect', () => {
  it('returns a parsed effect for valid input', () => {
    const effect = validEffect()
    expect(validateStructuredDialogueEffect(effect)).toEqual(effect)
    expect(parseStructuredDialogueEffect(effect)).toEqual(effect)
  })

  it('fails closed for unknown, excluded, and reserved effect kinds', () => {
    expect(validateStructuredDialogueEffect(validEffect({ kind: 'npc_granted_item_candidate' as never }))).toBeNull()
    expect(validateStructuredDialogueEffect(validEffect({ kind: 'relationship_delta_candidate' as never }))).toBeNull()
    expect(validateStructuredDialogueEffect(validEffect({ kind: 'memory_write_candidate' as never }))).toBeNull()
    expect(validateStructuredDialogueEffect(validEffect({ kind: 'quest_hint_candidate' as never }))).toBeNull()
  })

  it('fails closed for extra fields', () => {
    expect(validateStructuredDialogueEffect({ ...validEffect(), text: 'raw dialogue text' })).toBeNull()
    expect(
      validateStructuredDialogueEffect(validEffect({ scope: { ...validEffect().scope, extra: true } as never })),
    ).toBeNull()
    expect(
      validateStructuredDialogueEffect(
        validEffect({ provenance: { classifier: 'deterministic-local', snippet: 'raw' } as never }),
      ),
    ).toBeNull()
  })

  it('fails closed for missing or empty scope ids', () => {
    expect(
      validateStructuredDialogueEffect(validEffect({ scope: { sessionId: 'session-1', roomId: 'room-1' } as never })),
    ).toBeNull()
    expect(
      validateStructuredDialogueEffect(validEffect({ scope: { worldId: 'world-1', roomId: 'room-1' } as never })),
    ).toBeNull()
    expect(
      validateStructuredDialogueEffect(validEffect({ scope: { worldId: 'world-1', sessionId: 'session-1' } as never })),
    ).toBeNull()
    expect(validateStructuredDialogueEffect(validEffect({ scope: { ...validEffect().scope, worldId: '' } }))).toBeNull()
    expect(validateStructuredDialogueEffect(validEffect({ scope: { ...validEffect().scope, sessionId: '' } }))).toBeNull()
    expect(validateStructuredDialogueEffect(validEffect({ scope: { ...validEffect().scope, roomId: '' } }))).toBeNull()
  })

  it('fails closed for empty ids', () => {
    expect(validateStructuredDialogueEffect(validEffect({ effectId: '' }))).toBeNull()
    expect(validateStructuredDialogueEffect(validEffect({ scope: { ...validEffect().scope, npcId: '' } }))).toBeNull()
  })

  it('fails closed for missing or empty sourceEventId', () => {
    const withoutSourceEventId: Partial<StructuredDialogueEffect> = { ...validEffect() }
    delete withoutSourceEventId.sourceEventId

    expect(validateStructuredDialogueEffect(withoutSourceEventId)).toBeNull()
    expect(validateStructuredDialogueEffect(validEffect({ sourceEventId: '' }))).toBeNull()
  })

  it('fails closed for unknown or invalid sourceKind', () => {
    expect(validateStructuredDialogueEffect(validEffect({ sourceKind: 'npc_granted_item' as never }))).toBeNull()
    expect(validateStructuredDialogueEffect(validEffect({ sourceKind: '' as never }))).toBeNull()
  })

  it('fails closed for wrong status values', () => {
    expect(validateStructuredDialogueEffect(validEffect({ status: 'applied' as never }))).toBeNull()
    expect(validateStructuredDialogueEffect(validEffect({ status: 'accepted' as never }))).toBeNull()
  })

  it('fails closed for unknown classifier values', () => {
    expect(validateStructuredDialogueEffect(validEffect({ provenance: { classifier: 'llm' as never } }))).toBeNull()
  })

  it('fails closed for negative turnIndex', () => {
    expect(
      validateStructuredDialogueEffect(
        validEffect({ provenance: { classifier: 'deterministic-local', turnIndex: -1 } }),
      ),
    ).toBeNull()
  })

  it('does not throw on malformed input', () => {
    for (const input of [null, undefined, 'not an effect', 7, [], { schemaVersion: 1 }]) {
      expect(() => validateStructuredDialogueEffect(input)).not.toThrow()
      expect(validateStructuredDialogueEffect(input)).toBeNull()
    }
  })

  it('rejects snippet/text/playerLine/npcText/providerText/promptText/memoryText/effectPayload fields', () => {
    for (const field of FORBIDDEN_TEXT_FIELDS) {
      expect(validateStructuredDialogueEffect({ ...validEffect(), [field]: 'raw dialogue text' })).toBeNull()
    }
  })

  it('keeps provenance deterministic-local only', () => {
    expect(validateStructuredDialogueEffect(validEffect({ provenance: { classifier: 'deterministic-local' } }))).toEqual(
      validEffect({ provenance: { classifier: 'deterministic-local' } }),
    )
    expect(
      validateStructuredDialogueEffect(validEffect({ provenance: { classifier: 'deterministic-local-v2' as never } })),
    ).toBeNull()
  })

  it('does not mutate input', () => {
    const input = validEffect()
    const before = structuredClone(input)

    expect(validateStructuredDialogueEffect(input)).toEqual(input)
    expect(input).toEqual(before)
  })
})
