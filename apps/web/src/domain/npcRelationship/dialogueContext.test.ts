import { describe, expect, it } from 'vitest'
import { neutralRelationship } from './neutral'
import type { NpcRelationshipState } from './contracts'
import {
  NPC_RELATIONSHIP_DIALOGUE_CONTEXT_SCHEMA_VERSION,
  familiarityBucket,
  projectRelationshipDialogueContext,
} from './dialogueContext'

const scope = { worldId: 'world-1', sessionId: 'session-1', npcId: 'aide' }

function withFamiliarity(familiarity: number): NpcRelationshipState {
  return { ...neutralRelationship(scope), axes: { ...neutralRelationship(scope).axes, familiarity } }
}

describe('familiarityBucket', () => {
  it('maps numeric familiarity to closed buckets', () => {
    expect(familiarityBucket(0)).toBe('none')
    expect(familiarityBucket(1)).toBe('low')
    expect(familiarityBucket(33)).toBe('low')
    expect(familiarityBucket(34)).toBe('medium')
    expect(familiarityBucket(66)).toBe('medium')
    expect(familiarityBucket(67)).toBe('high')
    expect(familiarityBucket(100)).toBe('high')
  })
})

describe('projectRelationshipDialogueContext', () => {
  it('returns the neutral/no-familiarity context when state is missing', () => {
    expect(projectRelationshipDialogueContext(undefined)).toEqual({
      schemaVersion: NPC_RELATIONSHIP_DIALOGUE_CONTEXT_SCHEMA_VERSION,
      subject: 'npc',
      object: 'player',
      familiarityBucket: 'none',
      trustBucket: 'neutral',
      respectBucket: 'neutral',
      fearBucket: 'none',
    })
  })

  it('buckets a neutral (freshly created) relationship state to no familiarity', () => {
    expect(projectRelationshipDialogueContext(neutralRelationship(scope))).toEqual({
      schemaVersion: NPC_RELATIONSHIP_DIALOGUE_CONTEXT_SCHEMA_VERSION,
      subject: 'npc',
      object: 'player',
      familiarityBucket: 'none',
      trustBucket: 'neutral',
      respectBucket: 'neutral',
      fearBucket: 'none',
    })
  })

  it('buckets familiarity deterministically at each threshold', () => {
    expect(projectRelationshipDialogueContext(withFamiliarity(10)).familiarityBucket).toBe('low')
    expect(projectRelationshipDialogueContext(withFamiliarity(50)).familiarityBucket).toBe('medium')
    expect(projectRelationshipDialogueContext(withFamiliarity(90)).familiarityBucket).toBe('high')
  })

  it('trust/respect/fear stay at their single v0 value regardless of familiarity', () => {
    const context = projectRelationshipDialogueContext(withFamiliarity(90))

    expect(context.trustBucket).toBe('neutral')
    expect(context.respectBucket).toBe('neutral')
    expect(context.fearBucket).toBe('none')
  })

  it('is pure: same input produces the same output and does not mutate the input', () => {
    const state = withFamiliarity(42)
    const before = structuredClone(state)

    const first = projectRelationshipDialogueContext(state)
    const second = projectRelationshipDialogueContext(state)

    expect(first).toEqual(second)
    expect(state).toEqual(before)
  })

  it('never includes raw axis numbers or npc/session identifiers in the projected shape', () => {
    const context = projectRelationshipDialogueContext(withFamiliarity(77))
    const serialized = JSON.stringify(context)

    expect(serialized).not.toContain('77')
    expect(serialized).not.toContain(scope.npcId)
    expect(serialized).not.toContain(scope.sessionId)
    expect(serialized).not.toContain(scope.worldId)
  })
})
