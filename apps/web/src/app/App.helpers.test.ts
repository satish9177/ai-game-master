import { describe, expect, it } from 'vitest'
import appHelpersSource from './App.helpers.ts?raw'
import type { FamiliarityBucket } from '../domain/npcRelationship/dialogueContext'
import { NPC_RELATIONSHIP_SCHEMA_VERSION, type NpcRelationshipState } from '../domain/npcRelationship/contracts'
import {
  applyGeneratedMeaningfulConsequenceCatalog,
  deriveMeaningfulObjectTrustedContext,
  INITIAL_RELATIONSHIP_FEEDBACK_STATE,
  relationshipFeedbackAfterReduction,
  relationshipFeedbackOnRoomEntry,
  restoreNpcRelationshipsFromSlot,
  selectTransientFeedbackMessage,
  type RelationshipFeedbackState,
} from './App.helpers'
import { MEMORY_CREATED_MESSAGE, MEMORY_RECALLED_MESSAGE } from './memoryFeedback'
import { RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE } from './relationshipFeedback'

const WORLD_ID = 'world-1'
const SESSION_ID = 'session-1'
const SCOPE = { worldId: WORLD_ID, sessionId: SESSION_ID }
const consequenceCatalog = { clues: [], consequences: [] }

describe('meaningful consequence trusted context', () => {
  it('uses the active room exact catalog and preserves immutable catalog updates', () => {
    const previous = new Map([['earlier-room', consequenceCatalog]])
    const nextCatalog = { clues: [], consequences: [] }
    const updated = applyGeneratedMeaningfulConsequenceCatalog({
      consequenceCatalogs: previous,
      destinationRoomId: 'active-room',
      activeRoom: { id: 'active-room' },
      catalog: nextCatalog,
    })

    expect(updated.consequenceCatalogs).not.toBe(previous)
    expect(previous.has('active-room')).toBe(false)
    expect(updated.consequenceCatalogs.get('active-room')).toBe(nextCatalog)
    expect(updated.activeTrustedContext).toEqual({
      roomId: 'active-room',
      consequenceCatalog: nextCatalog,
    })
  })

  it('caches a stale room catalog without replacing the active room context', () => {
    const updated = applyGeneratedMeaningfulConsequenceCatalog({
      destinationRoomId: 'previous-room',
      activeRoom: { id: 'current-room' },
      catalog: consequenceCatalog,
    })

    expect(updated.consequenceCatalogs.get('previous-room')).toBe(consequenceCatalog)
    expect(updated.activeTrustedContext).toBeUndefined()
    expect(deriveMeaningfulObjectTrustedContext({
      room: { id: 'previous-room' },
      consequenceCatalogs: updated.consequenceCatalogs,
    })).toEqual({ roomId: 'previous-room', consequenceCatalog })
  })
})

function makeRelationshipRecord(overrides: Partial<NpcRelationshipState> = {}): NpcRelationshipState {
  return {
    schemaVersion: NPC_RELATIONSHIP_SCHEMA_VERSION,
    scope: { worldId: WORLD_ID, sessionId: SESSION_ID, npcId: 'npc-1' },
    subject: 'npc',
    object: 'player',
    axes: { trust: 10, respect: 5, fear: 0, familiarity: 20 },
    interactionCount: 3,
    ...overrides,
  }
}

function relationshipJson(records: NpcRelationshipState[]): string {
  return JSON.stringify({ schemaVersion: 1, records })
}

describe('relationshipFeedbackAfterReduction', () => {
  it('sets the message on an upward familiarity bucket crossing', () => {
    const next = relationshipFeedbackAfterReduction(INITIAL_RELATIONSHIP_FEEDBACK_STATE, {
      prevBucket: 'none',
      nextBucket: 'low',
    })
    expect(next).toEqual({ message: RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE })
  })

  it('leaves the state unchanged on a same-bucket turn', () => {
    const state = INITIAL_RELATIONSHIP_FEEDBACK_STATE
    const next = relationshipFeedbackAfterReduction(state, { prevBucket: 'low', nextBucket: 'low' })
    expect(next).toBe(state)
  })

  it('leaves the state unchanged on a downward pair (structurally impossible)', () => {
    const state: RelationshipFeedbackState = { message: RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE }
    const next = relationshipFeedbackAfterReduction(state, { prevBucket: 'high', nextBucket: 'low' })
    expect(next).toBe(state)
  })

  it('overwrites an existing message on a later upward crossing', () => {
    const state: RelationshipFeedbackState = { message: RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE }
    const next = relationshipFeedbackAfterReduction(state, {
      prevBucket: 'low',
      nextBucket: 'medium',
    })
    expect(next).toEqual({ message: RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE })
    expect(next).not.toBe(state)
  })

  it.each(['none', 'low', 'medium', 'high'] satisfies FamiliarityBucket[])(
    'never produces a message other than the closed constant or null (bucket %s)',
    (bucket) => {
      const next = relationshipFeedbackAfterReduction(INITIAL_RELATIONSHIP_FEEDBACK_STATE, {
        prevBucket: bucket,
        nextBucket: bucket,
      })
      expect([null, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE]).toContain(next.message)
    },
  )
})

describe('relationshipFeedbackOnRoomEntry', () => {
  it('clears a set message', () => {
    const state: RelationshipFeedbackState = { message: RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE }
    expect(relationshipFeedbackOnRoomEntry(state)).toEqual({ message: null })
  })

  it('returns the same reference when already null', () => {
    const state = INITIAL_RELATIONSHIP_FEEDBACK_STATE
    expect(relationshipFeedbackOnRoomEntry(state)).toBe(state)
  })
})

describe('selectTransientFeedbackMessage', () => {
  it('prefers memory-created over relationship feedback', () => {
    expect(
      selectTransientFeedbackMessage(MEMORY_CREATED_MESSAGE, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE),
    ).toBe(MEMORY_CREATED_MESSAGE)
  })

  it('prefers memory-recalled over relationship feedback', () => {
    expect(
      selectTransientFeedbackMessage(MEMORY_RECALLED_MESSAGE, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE),
    ).toBe(MEMORY_RECALLED_MESSAGE)
  })

  it('falls back to relationship feedback when both memory slots are null', () => {
    expect(selectTransientFeedbackMessage(null, RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE)).toBe(
      RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE,
    )
  })

  it('returns null when both are null', () => {
    expect(selectTransientFeedbackMessage(null, null)).toBeNull()
  })
})

describe('restoreNpcRelationshipsFromSlot', () => {
  it('restores records matching the restored worldId/sessionId', () => {
    const record = makeRelationshipRecord()
    const result = restoreNpcRelationshipsFromSlot({
      npcRelationshipJson: relationshipJson([record]),
      scope: SCOPE,
    })

    expect(result.records).toEqual([record])
    expect(result.diagnostics).toEqual({
      status: 'restored',
      restoredCount: 1,
      droppedCount: 0,
      droppedByScope: 0,
      droppedByCap: 0,
    })
  })

  it('drops records with a mismatched worldId or sessionId', () => {
    const keep = makeRelationshipRecord({ scope: { worldId: WORLD_ID, sessionId: SESSION_ID, npcId: 'keep' } })
    const wrongWorld = makeRelationshipRecord({
      scope: { worldId: 'other-world', sessionId: SESSION_ID, npcId: 'wrong-world' },
    })
    const wrongSession = makeRelationshipRecord({
      scope: { worldId: WORLD_ID, sessionId: 'other-session', npcId: 'wrong-session' },
    })

    const result = restoreNpcRelationshipsFromSlot({
      npcRelationshipJson: relationshipJson([keep, wrongWorld, wrongSession]),
      scope: SCOPE,
    })

    expect(result.records.map((record) => record.scope.npcId)).toEqual(['keep'])
    expect(result.diagnostics.restoredCount).toBe(1)
    expect(result.diagnostics.droppedByScope).toBe(2)
  })

  it('returns an empty result safely for corrupt JSON', () => {
    const result = restoreNpcRelationshipsFromSlot({
      npcRelationshipJson: 'NOT VALID JSON{{{',
      scope: SCOPE,
    })

    expect(result.records).toEqual([])
    expect(result.diagnostics).toEqual({
      status: 'invalid',
      reason: 'invalid-json',
      restoredCount: 0,
      droppedCount: 0,
      droppedByScope: 0,
      droppedByCap: 0,
    })
  })

  it('returns an empty result safely for an unsupported schema version', () => {
    const result = restoreNpcRelationshipsFromSlot({
      npcRelationshipJson: JSON.stringify({ schemaVersion: 999, records: [makeRelationshipRecord()] }),
      scope: SCOPE,
    })

    expect(result.records).toEqual([])
    expect(result.diagnostics.status).toBe('invalid')
    expect(result.diagnostics.reason).toBe('unsupported-version')
  })

  it('returns an empty result safely for an invalid record shape', () => {
    const result = restoreNpcRelationshipsFromSlot({
      npcRelationshipJson: JSON.stringify({ schemaVersion: 1, records: 'not-an-array' }),
      scope: SCOPE,
    })

    expect(result.records).toEqual([])
    expect(result.diagnostics.status).toBe('invalid')
  })

  it('returns an empty, missing result when npcRelationshipJson is absent', () => {
    const result = restoreNpcRelationshipsFromSlot({ scope: SCOPE })

    expect(result.records).toEqual([])
    expect(result.diagnostics).toEqual({
      status: 'missing',
      reason: 'missing',
      restoredCount: 0,
      droppedCount: 0,
      droppedByScope: 0,
      droppedByCap: 0,
    })
  })

  it('restores only the valid, scoped records from a mixed valid/malformed sidecar', () => {
    const valid = makeRelationshipRecord({ scope: { worldId: WORLD_ID, sessionId: SESSION_ID, npcId: 'valid' } })
    const outOfBounds = {
      ...makeRelationshipRecord({ scope: { worldId: WORLD_ID, sessionId: SESSION_ID, npcId: 'out-of-bounds' } }),
      axes: { trust: 999, respect: 5, fear: 0, familiarity: 20 },
    }
    const wrongScope = makeRelationshipRecord({
      scope: { worldId: 'other-world', sessionId: SESSION_ID, npcId: 'wrong-scope' },
    })

    const result = restoreNpcRelationshipsFromSlot({
      npcRelationshipJson: relationshipJson([valid, outOfBounds as unknown as NpcRelationshipState, wrongScope]),
      scope: SCOPE,
    })

    expect(result.records.map((record) => record.scope.npcId)).toEqual(['valid'])
    expect(result.diagnostics.restoredCount).toBe(1)
  })

  it('returned diagnostics carry only counts/status/reason, never raw axis values', () => {
    const record = makeRelationshipRecord({ axes: { trust: 77, respect: -42, fear: 13, familiarity: 88 } })
    const result = restoreNpcRelationshipsFromSlot({
      npcRelationshipJson: relationshipJson([record]),
      scope: SCOPE,
    })

    expect(Object.keys(result.diagnostics).sort()).toEqual(
      ['status', 'restoredCount', 'droppedCount', 'droppedByScope', 'droppedByCap'].sort(),
    )
    const serializedDiagnostics = JSON.stringify(result.diagnostics)
    expect(serializedDiagnostics).not.toContain('77')
    expect(serializedDiagnostics).not.toContain('-42')
    expect(serializedDiagnostics).not.toContain('88')
  })

  it('requires both worldId and sessionId on the scope parameter (type-level contract)', () => {
    // @ts-expect-error scope.sessionId is required
    const missingSessionId: Parameters<typeof restoreNpcRelationshipsFromSlot>[0] = { scope: { worldId: WORLD_ID } }
    // @ts-expect-error scope.worldId is required
    const missingWorldId: Parameters<typeof restoreNpcRelationshipsFromSlot>[0] = { scope: { sessionId: SESSION_ID } }

    expect(missingSessionId).toBeDefined()
    expect(missingWorldId).toBeDefined()
  })

  it('touches no reducer, feedback, memory, fact, event, or world-command path', () => {
    const restoreFnSource = appHelpersSource.slice(
      appHelpersSource.indexOf('export function restoreNpcRelationshipsFromSlot'),
      appHelpersSource.indexOf('export function resolvedObjectIdsForRoom'),
    )

    expect(restoreFnSource).not.toContain('applyRelationshipEffects')
    expect(restoreFnSource).not.toContain('deriveAndReduceRelationship')
    expect(restoreFnSource).not.toContain('relationshipFeedbackAfterReduction')
    expect(restoreFnSource).not.toContain('decideRelationshipFeedback')
    expect(restoreFnSource).not.toContain('WorldEvent')
    expect(restoreFnSource).not.toContain('WorldCommand')
    expect(restoreFnSource).not.toContain('memory')
    expect(restoreFnSource).not.toContain('fact')
  })
})
