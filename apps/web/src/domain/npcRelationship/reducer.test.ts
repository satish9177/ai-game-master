import { describe, expect, it } from 'vitest'
import { STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION } from '../structuredDialogueEffects/contracts'
import type { StructuredDialogueEffect } from '../structuredDialogueEffects/contracts'
import { neutralRelationship } from './neutral'
import {
  MAX_PER_EFFECT_DELTA,
  MAX_PER_TURN_DELTA,
  RELATIONSHIP_EFFECT_DELTA_TABLE,
  applyRelationshipEffects,
  type RelationshipReductionContext,
} from './reducer'

const CTX: RelationshipReductionContext = {
  worldId: 'world-1',
  sessionId: 'session-1',
  npcId: 'npc-1',
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

function responseEffect(overrides: Partial<StructuredDialogueEffect> = {}): StructuredDialogueEffect {
  return questionEffect({
    effectId: 'structured-dialogue-effect-2',
    kind: 'npc_response_effect_candidate',
    sourceEventId: 'dialogue-event-2',
    sourceKind: 'npc_responded',
    actor: 'npc',
    target: 'player',
    ...overrides,
  })
}

describe('RELATIONSHIP_EFFECT_DELTA_TABLE', () => {
  it('never exceeds MAX_PER_EFFECT_DELTA on any axis for any row', () => {
    for (const row of Object.values(RELATIONSHIP_EFFECT_DELTA_TABLE)) {
      for (const value of Object.values(row)) {
        expect(Math.abs(value)).toBeLessThanOrEqual(MAX_PER_EFFECT_DELTA)
      }
    }
  })

  it('only moves familiarity for the two currently emitted candidate kinds', () => {
    expect(RELATIONSHIP_EFFECT_DELTA_TABLE.player_question_effect_candidate).toEqual({
      trust: 0,
      respect: 0,
      fear: 0,
      familiarity: 1,
    })
    expect(RELATIONSHIP_EFFECT_DELTA_TABLE.npc_response_effect_candidate).toEqual({
      trust: 0,
      respect: 0,
      fear: 0,
      familiarity: 1,
    })
  })
})

describe('applyRelationshipEffects', () => {
  it('increases only familiarity for a neutral player_question_effect_candidate', () => {
    const prior = neutralPrior()
    const result = applyRelationshipEffects(prior, [questionEffect()], CTX)

    expect(result.state.axes).toEqual({ trust: 0, respect: 0, fear: 0, familiarity: 1 })
    expect(result.appliedCount).toBe(1)
    expect(result.ignoredCount).toBe(0)
  })

  it('increases only familiarity for a neutral npc_response_effect_candidate', () => {
    const prior = neutralPrior()
    const result = applyRelationshipEffects(prior, [responseEffect()], CTX)

    expect(result.state.axes).toEqual({ trust: 0, respect: 0, fear: 0, familiarity: 1 })
    expect(result.appliedCount).toBe(1)
    expect(result.ignoredCount).toBe(0)
  })

  it('leaves trust, fear, and respect unchanged for both currently emitted neutral candidates', () => {
    const prior = neutralPrior()
    const result = applyRelationshipEffects(prior, [questionEffect(), responseEffect()], CTX)

    expect(result.state.axes.trust).toBe(0)
    expect(result.state.axes.respect).toBe(0)
    expect(result.state.axes.fear).toBe(0)
    expect(result.state.axes.familiarity).toBeGreaterThan(0)
  })

  it('rejects an unknown effect kind (fails schema validation, ignored, state unchanged)', () => {
    const prior = neutralPrior()
    const unknownKindEffect = questionEffect({ kind: 'relationship_delta_candidate' as never })
    const result = applyRelationshipEffects(prior, [unknownKindEffect], CTX)

    expect(result.state.axes).toEqual(prior.axes)
    expect(result.appliedCount).toBe(0)
    expect(result.ignoredCount).toBe(1)
  })

  it('cannot be pushed to a non-integer/NaN/Infinity axis value via any effect field', () => {
    const prior = neutralPrior()
    const pollutedEffect = { ...questionEffect(), magnitude: Infinity } as unknown as StructuredDialogueEffect
    const result = applyRelationshipEffects(prior, [pollutedEffect], CTX)

    // The extra field makes the object fail .strict() schema validation,
    // so it is ignored outright -- there is no field through which a
    // numeric magnitude could reach an axis at all.
    expect(result.ignoredCount).toBe(1)
    expect(result.appliedCount).toBe(0)
    expect(result.state.axes).toEqual(prior.axes)
    expect(Number.isInteger(result.state.axes.familiarity)).toBe(true)
  })

  it('clamps a flood of accepted effects to MAX_PER_TURN_DELTA for a single axis', () => {
    const prior = neutralPrior()
    const flood = Array.from({ length: 20 }, (_, index) => questionEffect({ effectId: `flood-effect-${index}` }))
    const result = applyRelationshipEffects(prior, flood, CTX)

    expect(result.appliedCount).toBe(20)
    expect(result.state.axes.familiarity).toBe(MAX_PER_TURN_DELTA)
    expect(result.clampedAxes).toBeGreaterThanOrEqual(1)
  })

  it('clamps familiarity at its axis ceiling of 100 even from a large prior value', () => {
    const prior = { ...neutralPrior(), axes: { trust: 0, respect: 0, fear: 0, familiarity: 99 } }
    const flood = Array.from({ length: 10 }, (_, index) => questionEffect({ effectId: `ceiling-effect-${index}` }))
    const result = applyRelationshipEffects(prior, flood, CTX)

    expect(result.state.axes.familiarity).toBe(100)
    expect(result.clampedAxes).toBeGreaterThanOrEqual(1)
  })

  it('dedupes a repeated effectId within a single call', () => {
    const prior = neutralPrior()
    const duplicate = questionEffect({ effectId: 'same-effect-id' })
    const result = applyRelationshipEffects(prior, [duplicate, { ...duplicate }], CTX)

    expect(result.state.axes.familiarity).toBe(1)
    expect(result.appliedCount).toBe(1)
    expect(result.ignoredCount).toBe(1)
  })

  it('rejects an effect scoped to the wrong worldId', () => {
    const prior = neutralPrior()
    const wrongWorld = questionEffect({ scope: { ...questionEffect().scope, worldId: 'world-2' } })
    const result = applyRelationshipEffects(prior, [wrongWorld], CTX)

    expect(result.state.axes).toEqual(prior.axes)
    expect(result.appliedCount).toBe(0)
    expect(result.ignoredCount).toBe(1)
  })

  it('rejects an effect scoped to the wrong sessionId', () => {
    const prior = neutralPrior()
    const wrongSession = questionEffect({ scope: { ...questionEffect().scope, sessionId: 'session-2' } })
    const result = applyRelationshipEffects(prior, [wrongSession], CTX)

    expect(result.state.axes).toEqual(prior.axes)
    expect(result.appliedCount).toBe(0)
    expect(result.ignoredCount).toBe(1)
  })

  it('rejects an effect scoped to the wrong npcId, and a missing npcId', () => {
    const prior = neutralPrior()
    const wrongNpc = questionEffect({ scope: { ...questionEffect().scope, npcId: 'npc-2' } })
    const missingNpc = { ...questionEffect(), scope: { worldId: CTX.worldId, sessionId: CTX.sessionId, roomId: 'room-1' } }

    const result = applyRelationshipEffects(prior, [wrongNpc, missingNpc], CTX)

    expect(result.state.axes).toEqual(prior.axes)
    expect(result.appliedCount).toBe(0)
    expect(result.ignoredCount).toBe(2)
  })

  it('rejects an effect whose provenance classifier is not deterministic-local (e.g. an "llm" source)', () => {
    const prior = neutralPrior()
    const llmSourced = { ...questionEffect(), provenance: { classifier: 'llm' } } as unknown as StructuredDialogueEffect
    const result = applyRelationshipEffects(prior, [llmSourced], CTX)

    expect(result.state.axes).toEqual(prior.axes)
    expect(result.appliedCount).toBe(0)
    expect(result.ignoredCount).toBe(1)
  })

  it('rejects an effect whose status is not "candidate"', () => {
    const prior = neutralPrior()
    const appliedStatus = { ...questionEffect(), status: 'applied' } as unknown as StructuredDialogueEffect
    const result = applyRelationshipEffects(prior, [appliedStatus], CTX)

    expect(result.state.axes).toEqual(prior.axes)
    expect(result.appliedCount).toBe(0)
    expect(result.ignoredCount).toBe(1)
  })

  it('contributes nothing for a known effect whose actor/target is not a direct player<->npc pair', () => {
    const prior = neutralPrior()
    const roomTargeted = questionEffect({ target: 'room' })
    const result = applyRelationshipEffects(prior, [roomTargeted], CTX)

    expect(result.state.axes).toEqual(prior.axes)
    // Still processed for idempotency purposes -- not silently dropped.
    expect(result.appliedCount).toBe(1)
    expect(result.ignoredCount).toBe(0)
  })

  it('never decreases familiarity (monotonic guard)', () => {
    const prior = { ...neutralPrior(), axes: { trust: 0, respect: 0, fear: 0, familiarity: 50 } }
    const result = applyRelationshipEffects(prior, [], CTX)

    expect(result.state.axes.familiarity).toBe(50)
  })

  it('produces byte-identical output for identical input (deterministic)', () => {
    const prior = neutralPrior()
    const effects = [questionEffect(), responseEffect()]

    const first = applyRelationshipEffects(prior, effects, CTX)
    const second = applyRelationshipEffects(prior, effects, CTX)

    expect(first).toEqual(second)
  })

  it('does not mutate the prior state object', () => {
    const prior = neutralPrior()
    const before = structuredClone(prior)

    applyRelationshipEffects(prior, [questionEffect(), responseEffect()], CTX)

    expect(prior).toEqual(before)
  })

  it('ignores malformed input (empty ids, non-object, extra fields) without throwing', () => {
    const prior = neutralPrior()
    const malformed = [
      questionEffect({ effectId: '' }),
      { not: 'an effect' } as unknown as StructuredDialogueEffect,
      null as unknown as StructuredDialogueEffect,
      { ...questionEffect(), extra: 'field' } as unknown as StructuredDialogueEffect,
    ]

    expect(() => applyRelationshipEffects(prior, malformed, CTX)).not.toThrow()
    const result = applyRelationshipEffects(prior, malformed, CTX)
    expect(result.state.axes).toEqual(prior.axes)
    expect(result.appliedCount).toBe(0)
  })

  it('returns an unchanged state and zero counts for empty input', () => {
    const prior = neutralPrior()
    const result = applyRelationshipEffects(prior, [], CTX)

    expect(result.state.axes).toEqual(prior.axes)
    expect(result.appliedCount).toBe(0)
    expect(result.ignoredCount).toBe(0)
    expect(result.clampedAxes).toBe(0)
  })
})
