import { describe, expect, it } from 'vitest'
import {
  NPC_RELATIONSHIP_SCHEMA_VERSION,
  NpcRelationshipStateSchema,
  RelationshipAxesSchema,
  RelationshipBipolarSchema,
  RelationshipUnipolarSchema,
} from './contracts'
import type { NpcRelationshipState } from './contracts'

function validState(overrides: Partial<NpcRelationshipState> = {}): NpcRelationshipState {
  return {
    schemaVersion: NPC_RELATIONSHIP_SCHEMA_VERSION,
    scope: {
      worldId: 'world-1',
      sessionId: 'session-1',
      npcId: 'npc-1',
    },
    subject: 'npc',
    object: 'player',
    axes: {
      trust: 0,
      respect: 0,
      fear: 0,
      familiarity: 0,
    },
    interactionCount: 0,
    ...overrides,
  }
}

describe('RelationshipBipolarSchema', () => {
  it('accepts the full bipolar range', () => {
    for (const value of [-100, 0, 100]) {
      expect(RelationshipBipolarSchema.safeParse(value).success).toBe(true)
    }
  })

  it('rejects out-of-range, non-integer, NaN, and Infinity values', () => {
    for (const value of [-101, 101, 1.5, -1.5, NaN, Infinity, -Infinity]) {
      expect(RelationshipBipolarSchema.safeParse(value).success).toBe(false)
    }
  })
})

describe('RelationshipUnipolarSchema', () => {
  it('accepts the full unipolar range', () => {
    for (const value of [0, 50, 100]) {
      expect(RelationshipUnipolarSchema.safeParse(value).success).toBe(true)
    }
  })

  it('rejects negative, out-of-range, non-integer, NaN, and Infinity values', () => {
    for (const value of [-1, 101, 1.5, NaN, Infinity, -Infinity]) {
      expect(RelationshipUnipolarSchema.safeParse(value).success).toBe(false)
    }
  })
})

describe('RelationshipAxesSchema', () => {
  it('parses a valid axes object', () => {
    const axes = { trust: 10, respect: -10, fear: 5, familiarity: 20 }
    expect(RelationshipAxesSchema.parse(axes)).toEqual(axes)
  })

  it('rejects extra keys (strict)', () => {
    expect(
      RelationshipAxesSchema.safeParse({ trust: 0, respect: 0, fear: 0, familiarity: 0, anger: 0 }).success,
    ).toBe(false)
  })

  it('rejects missing axes', () => {
    expect(RelationshipAxesSchema.safeParse({ trust: 0, respect: 0, fear: 0 }).success).toBe(false)
  })

  it('rejects a negative fear value (unipolar)', () => {
    expect(
      RelationshipAxesSchema.safeParse({ trust: 0, respect: 0, fear: -1, familiarity: 0 }).success,
    ).toBe(false)
  })
})

describe('NpcRelationshipStateSchema', () => {
  it('parses a valid state and round-trips it unchanged', () => {
    const state = validState()
    expect(NpcRelationshipStateSchema.parse(state)).toEqual(state)
  })

  it('pins schemaVersion to 1', () => {
    expect(NpcRelationshipStateSchema.safeParse(validState()).success).toBe(true)
    expect(NpcRelationshipStateSchema.safeParse(validState({ schemaVersion: 2 as never })).success).toBe(false)
  })

  it('accepts only subject "npc" and object "player"', () => {
    expect(NpcRelationshipStateSchema.safeParse(validState({ subject: 'player' as never })).success).toBe(false)
    expect(NpcRelationshipStateSchema.safeParse(validState({ object: 'npc' as never })).success).toBe(false)
  })

  it('requires non-empty worldId, sessionId, and npcId in scope', () => {
    expect(
      NpcRelationshipStateSchema.safeParse(validState({ scope: { ...validState().scope, worldId: '' } })).success,
    ).toBe(false)
    expect(
      NpcRelationshipStateSchema.safeParse(validState({ scope: { ...validState().scope, sessionId: '' } })).success,
    ).toBe(false)
    expect(
      NpcRelationshipStateSchema.safeParse(validState({ scope: { ...validState().scope, npcId: '' } })).success,
    ).toBe(false)
  })

  it('rejects a missing npcId in scope (unlike structured effects, npcId is required here)', () => {
    const scopeWithoutNpc = { worldId: 'world-1', sessionId: 'session-1' }
    expect(NpcRelationshipStateSchema.safeParse(validState({ scope: scopeWithoutNpc as never })).success).toBe(false)
  })

  it('requires a non-negative integer interactionCount', () => {
    expect(NpcRelationshipStateSchema.safeParse(validState({ interactionCount: -1 })).success).toBe(false)
    expect(NpcRelationshipStateSchema.safeParse(validState({ interactionCount: 1.5 })).success).toBe(false)
    expect(NpcRelationshipStateSchema.safeParse(validState({ interactionCount: 0 })).success).toBe(true)
  })

  it('rejects unknown extra keys at every level (strict)', () => {
    expect(NpcRelationshipStateSchema.safeParse({ ...validState(), extra: true }).success).toBe(false)
    expect(
      NpcRelationshipStateSchema.safeParse(validState({ scope: { ...validState().scope, extra: true } as never }))
        .success,
    ).toBe(false)
    expect(
      NpcRelationshipStateSchema.safeParse(
        validState({ axes: { ...validState().axes, anger: 0 } as never }),
      ).success,
    ).toBe(false)
  })

  it('does not accept a fifth relationship axis (e.g. anger or debt)', () => {
    expect(
      NpcRelationshipStateSchema.safeParse(
        validState({ axes: { trust: 0, respect: 0, fear: 0, familiarity: 0, debt: 0 } as never }),
      ).success,
    ).toBe(false)
  })
})
