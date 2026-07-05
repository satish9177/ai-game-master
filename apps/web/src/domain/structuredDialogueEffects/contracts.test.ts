import { describe, expect, it } from 'vitest'
import { DialogueSemanticEventKindSchema } from '../dialogueEvents/contracts'
import {
  STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
  StructuredDialogueEffectKindSchema,
  StructuredDialogueEffectSchema,
} from './contracts'
import type { StructuredDialogueEffect, StructuredDialogueEffectKind } from './contracts'

const EFFECT_KINDS: StructuredDialogueEffectKind[] = [
  'player_question_effect_candidate',
  'npc_response_effect_candidate',
  'player_threat_candidate',
  'player_apology_candidate',
  'player_gratitude_candidate',
  'player_insult_candidate',
  'player_refusal_candidate',
  'player_promise_candidate',
  'npc_warning_candidate',
  'npc_offer_candidate',
  'npc_refusal_candidate',
]

const VALENCED_CANDIDATE_SOURCE_KIND: Partial<Record<StructuredDialogueEffectKind, StructuredDialogueEffect['sourceKind']>> = {
  player_threat_candidate: 'player_threatened_npc',
  player_apology_candidate: 'player_apologized',
  player_gratitude_candidate: 'player_thanked_npc',
  player_insult_candidate: 'player_insulted_npc',
  player_refusal_candidate: 'player_refused_request',
  player_promise_candidate: 'player_promised_help',
  npc_warning_candidate: 'npc_warned_player',
  npc_offer_candidate: 'npc_offered_help',
  npc_refusal_candidate: 'npc_refused_request',
}

const EXCLUDED_EFFECT_KINDS = [
  'relationship_delta_candidate',
  'memory_write_candidate',
  'quest_hint_candidate',
  'npc_offered_hint',
  'npc_refused_help',
  'npc_warned_player',
  'player_promised_help',
  'player_threatened_npc',
  'player_shared_claim',
  'npc_shared_rumor',
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

function validEffect(overrides: Partial<StructuredDialogueEffect> = {}): StructuredDialogueEffect {
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

describe('StructuredDialogueEffectSchema', () => {
  it('parses a valid effect and round-trips it unchanged', () => {
    const effect = validEffect()
    expect(StructuredDialogueEffectSchema.parse(effect)).toEqual(effect)
  })

  it('pins schemaVersion to 1', () => {
    expect(StructuredDialogueEffectSchema.safeParse(validEffect()).success).toBe(true)
    expect(StructuredDialogueEffectSchema.safeParse(validEffect({ schemaVersion: 2 as never })).success).toBe(false)
  })

  it('accepts every allowed effect kind, including the valenced candidate kinds', () => {
    for (const kind of EFFECT_KINDS) {
      expect(StructuredDialogueEffectKindSchema.safeParse(kind).success).toBe(true)
      const sourceKind = VALENCED_CANDIDATE_SOURCE_KIND[kind]
      expect(
        StructuredDialogueEffectSchema.safeParse(
          validEffect(sourceKind !== undefined ? { kind, sourceKind } : { kind }),
        ).success,
      ).toBe(true)
    }
  })

  it('has no valence field: the candidate kind is the sole valence signal', () => {
    const effect = validEffect({ kind: 'player_threat_candidate', sourceKind: 'player_threatened_npc' })
    expect(Object.keys(effect)).not.toContain('valence')
    expect(StructuredDialogueEffectSchema.safeParse({ ...effect, valence: 'negative' }).success).toBe(false)
  })

  it('rejects unknown, excluded, and reserved effect kinds', () => {
    expect(
      StructuredDialogueEffectSchema.safeParse(validEffect({ kind: 'player_cast_spell_candidate' as never })).success,
    ).toBe(false)

    for (const kind of EXCLUDED_EFFECT_KINDS) {
      expect(StructuredDialogueEffectKindSchema.safeParse(kind).success).toBe(false)
      expect(StructuredDialogueEffectSchema.safeParse(validEffect({ kind: kind as never })).success).toBe(false)
    }
  })

  it('requires non-empty effect, source event, and scope ids while npcId stays optional', () => {
    expect(StructuredDialogueEffectSchema.safeParse(validEffect({ effectId: '' })).success).toBe(false)
    expect(StructuredDialogueEffectSchema.safeParse(validEffect({ sourceEventId: '' })).success).toBe(false)
    expect(
      StructuredDialogueEffectSchema.safeParse(validEffect({ scope: { ...validEffect().scope, worldId: '' } })).success,
    ).toBe(false)
    expect(
      StructuredDialogueEffectSchema.safeParse(validEffect({ scope: { ...validEffect().scope, sessionId: '' } }))
        .success,
    ).toBe(false)
    expect(
      StructuredDialogueEffectSchema.safeParse(validEffect({ scope: { ...validEffect().scope, roomId: '' } })).success,
    ).toBe(false)
    expect(
      StructuredDialogueEffectSchema.safeParse(validEffect({ scope: { ...validEffect().scope, npcId: '' } })).success,
    ).toBe(false)

    const scopeWithoutNpc: StructuredDialogueEffect['scope'] = {
      worldId: validEffect().scope.worldId,
      sessionId: validEffect().scope.sessionId,
      roomId: validEffect().scope.roomId,
    }
    expect(StructuredDialogueEffectSchema.safeParse(validEffect({ scope: scopeWithoutNpc })).success).toBe(true)
  })

  it('requires worldId, sessionId, and roomId in scope', () => {
    expect(
      StructuredDialogueEffectSchema.safeParse(validEffect({ scope: { sessionId: 's', roomId: 'r' } as never }))
        .success,
    ).toBe(false)
    expect(
      StructuredDialogueEffectSchema.safeParse(validEffect({ scope: { worldId: 'w', roomId: 'r' } as never }))
        .success,
    ).toBe(false)
    expect(
      StructuredDialogueEffectSchema.safeParse(validEffect({ scope: { worldId: 'w', sessionId: 's' } as never }))
        .success,
    ).toBe(false)
  })

  it('requires sourceEventId and sourceKind', () => {
    const withoutSourceEventId: Partial<StructuredDialogueEffect> = { ...validEffect() }
    const withoutSourceKind: Partial<StructuredDialogueEffect> = { ...validEffect() }
    delete withoutSourceEventId.sourceEventId
    delete withoutSourceKind.sourceKind

    expect(StructuredDialogueEffectSchema.safeParse(withoutSourceEventId).success).toBe(false)
    expect(StructuredDialogueEffectSchema.safeParse(withoutSourceKind).success).toBe(false)
  })

  it('reuses DialogueSemanticEventKindSchema for sourceKind', () => {
    for (const sourceKind of DialogueSemanticEventKindSchema.options) {
      expect(StructuredDialogueEffectSchema.safeParse(validEffect({ sourceKind })).success).toBe(true)
    }

    expect(
      StructuredDialogueEffectSchema.safeParse(validEffect({ sourceKind: 'npc_granted_item' as never })).success,
    ).toBe(false)
  })

  it('accepts candidate status only', () => {
    expect(StructuredDialogueEffectSchema.safeParse(validEffect({ status: 'candidate' })).success).toBe(true)
    expect(StructuredDialogueEffectSchema.safeParse(validEffect({ status: 'applied' as never })).success).toBe(false)
    expect(StructuredDialogueEffectSchema.safeParse(validEffect({ status: 'accepted' as never })).success).toBe(false)
  })

  it('accepts deterministic-local provenance only', () => {
    expect(
      StructuredDialogueEffectSchema.safeParse(validEffect({ provenance: { classifier: 'deterministic-local' } }))
        .success,
    ).toBe(true)
    expect(StructuredDialogueEffectSchema.safeParse(validEffect({ provenance: { classifier: 'llm' as never } })).success).toBe(
      false,
    )
  })

  it('rejects negative or non-integer turnIndex', () => {
    expect(
      StructuredDialogueEffectSchema.safeParse(
        validEffect({ provenance: { classifier: 'deterministic-local', turnIndex: -1 } }),
      ).success,
    ).toBe(false)
    expect(
      StructuredDialogueEffectSchema.safeParse(
        validEffect({ provenance: { classifier: 'deterministic-local', turnIndex: 1.5 } }),
      ).success,
    ).toBe(false)
  })

  it('rejects unknown extra keys at every structured boundary', () => {
    expect(StructuredDialogueEffectSchema.safeParse({ ...validEffect(), extra: true }).success).toBe(false)
    expect(
      StructuredDialogueEffectSchema.safeParse(validEffect({ scope: { ...validEffect().scope, extra: true } as never }))
        .success,
    ).toBe(false)
    expect(
      StructuredDialogueEffectSchema.safeParse(
        validEffect({ provenance: { classifier: 'deterministic-local', raw: 'secret text' } as never }),
      ).success,
    ).toBe(false)
  })

  it('does not accept free-text, prompt, memory, or payload fields', () => {
    for (const field of FORBIDDEN_TEXT_FIELDS) {
      expect(StructuredDialogueEffectSchema.safeParse({ ...validEffect(), [field]: 'raw dialogue text' }).success).toBe(
        false,
      )
    }
  })
})
