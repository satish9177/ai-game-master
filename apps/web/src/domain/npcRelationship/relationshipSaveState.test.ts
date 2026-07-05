import relationshipSaveStateSource from './relationshipSaveState.ts?raw'
import { describe, expect, it } from 'vitest'
import { NPC_RELATIONSHIP_SCHEMA_VERSION } from './contracts'
import type { NpcRelationshipState } from './contracts'
import {
  NPC_RELATIONSHIP_SAVE_MAX_RECORDS,
  buildNpcRelationshipSaveJson,
  buildNpcRelationshipSaveState,
  filterRestorableRelationships,
  loadNpcRelationshipSaveState,
} from './relationshipSaveState'

function record(overrides: Partial<NpcRelationshipState> = {}): NpcRelationshipState {
  return {
    schemaVersion: NPC_RELATIONSHIP_SCHEMA_VERSION,
    scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-1' },
    subject: 'npc',
    object: 'player',
    axes: { trust: 0, respect: 0, fear: 0, familiarity: 10 },
    interactionCount: 1,
    ...overrides,
  }
}

describe('buildNpcRelationshipSaveState / buildNpcRelationshipSaveJson', () => {
  it('returns null for an empty snapshot', () => {
    expect(buildNpcRelationshipSaveState([])).toBeNull()
    expect(buildNpcRelationshipSaveJson([])).toBeNull()
  })

  it('builds a valid bounded state from valid records', () => {
    const state = buildNpcRelationshipSaveState([
      record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-a' } }),
      record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-b' } }),
    ])
    expect(state).not.toBeNull()
    expect(state!.schemaVersion).toBe(1)
    expect(state!.records.map((r) => r.scope.npcId)).toEqual(['npc-a', 'npc-b'])
  })

  it('buildNpcRelationshipSaveJson round-trips through loadNpcRelationshipSaveState', () => {
    const json = buildNpcRelationshipSaveJson([record()])
    expect(json).not.toBeNull()
    const loaded = loadNpcRelationshipSaveState(json!)
    expect(loaded).toEqual({ ok: true, state: buildNpcRelationshipSaveState([record()]) })
  })

  it('applies an optional scope filter', () => {
    const records = [
      record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'keep' } }),
      record({ scope: { worldId: 'world-2', sessionId: 'session-1', npcId: 'other-world' } }),
      record({ scope: { worldId: 'world-1', sessionId: 'session-2', npcId: 'other-session' } }),
    ]
    const state = buildNpcRelationshipSaveState(records, { worldId: 'world-1', sessionId: 'session-1' })
    expect(state!.records.map((r) => r.scope.npcId)).toEqual(['keep'])
  })

  it('is deterministic (npcId-sorted) and does not mutate its input', () => {
    const records = [
      record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-b' } }),
      record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-a' } }),
    ]
    const snapshot = structuredClone(records)
    const first = buildNpcRelationshipSaveState(records)
    const second = buildNpcRelationshipSaveState(records)
    expect(second).toEqual(first)
    expect(first!.records.map((r) => r.scope.npcId)).toEqual(['npc-a', 'npc-b'])
    expect(records).toEqual(snapshot)
  })

  it('caps at NPC_RELATIONSHIP_SAVE_MAX_RECORDS, keeping the npcId-ascending prefix', () => {
    const records = Array.from({ length: NPC_RELATIONSHIP_SAVE_MAX_RECORDS + 10 }, (_, i) =>
      record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: `npc-${String(i).padStart(3, '0')}` } }),
    )
    const state = buildNpcRelationshipSaveState(records)
    expect(state).not.toBeNull()
    expect(state!.records).toHaveLength(NPC_RELATIONSHIP_SAVE_MAX_RECORDS)
    expect(state!.records[0]!.scope.npcId).toBe('npc-000')
    expect(state!.records.at(-1)!.scope.npcId).toBe(`npc-${String(NPC_RELATIONSHIP_SAVE_MAX_RECORDS - 1).padStart(3, '0')}`)
  })
})

describe('loadNpcRelationshipSaveState', () => {
  it('rejects malformed / absent JSON as a safe no-op code', () => {
    expect(loadNpcRelationshipSaveState('{bad')).toEqual({ ok: false, code: 'invalid-json' })
    expect(loadNpcRelationshipSaveState('')).toEqual({ ok: false, code: 'invalid-json' })
  })

  it('round-trips a built state', () => {
    const state = buildNpcRelationshipSaveState([record()])
    expect(state).not.toBeNull()
    expect(loadNpcRelationshipSaveState(JSON.stringify(state))).toEqual({ ok: true, state })
  })

  it('rejects a wrong schemaVersion as unsupported-version', () => {
    const state = buildNpcRelationshipSaveState([record()])!
    expect(loadNpcRelationshipSaveState(JSON.stringify({ ...state, schemaVersion: 2 }))).toEqual({
      ok: false,
      code: 'unsupported-version',
    })
  })

  it('rejects missing schemaVersion / empty records / extra top-level keys as invalid-schema', () => {
    const state = buildNpcRelationshipSaveState([record()])!
    const withoutVersion: Record<string, unknown> = { ...state }
    delete withoutVersion.schemaVersion
    expect(loadNpcRelationshipSaveState(JSON.stringify(withoutVersion))).toEqual({ ok: false, code: 'invalid-schema' })
    expect(loadNpcRelationshipSaveState(JSON.stringify({ schemaVersion: 1, records: [] }))).toEqual({
      ok: false,
      code: 'invalid-schema',
    })
    expect(loadNpcRelationshipSaveState(JSON.stringify({ ...state, extra: true }))).toEqual({
      ok: false,
      code: 'invalid-schema',
    })
  })

  it('drops a tampered record whole (out-of-bounds axis) while a valid sibling survives', () => {
    const good = record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'good' } })
    const bad = record({
      scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'bad' },
      axes: { trust: 999, respect: 0, fear: 0, familiarity: 0 },
    })
    const json = JSON.stringify({ schemaVersion: 1, records: [good, bad] })
    const result = loadNpcRelationshipSaveState(json)
    expect(result.ok).toBe(true)
    expect(result.ok && result.state.records.map((r) => r.scope.npcId)).toEqual(['good'])
  })

  it('drops a tampered record whole (wrong subject literal, unknown extra key) while siblings survive', () => {
    const good = record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'good' } })
    const wrongLiteral = { ...record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'wl' } }), subject: 'player' }
    const extraKey = { ...record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'ek' } }), hacked: true }
    const json = JSON.stringify({ schemaVersion: 1, records: [good, wrongLiteral, extraKey] })
    const result = loadNpcRelationshipSaveState(json)
    expect(result.ok).toBe(true)
    expect(result.ok && result.state.records.map((r) => r.scope.npcId)).toEqual(['good'])
  })

  it('does not field-repair a malformed record (no missing-axis defaulting)', () => {
    const missingAxis = { ...record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'missing' } }) }
    const withoutFamiliarity = {
      ...missingAxis,
      axes: { trust: 0, respect: 0, fear: 0 },
    }
    const result = loadNpcRelationshipSaveState(JSON.stringify({ schemaVersion: 1, records: [withoutFamiliarity] }))
    expect(result).toEqual({ ok: true, state: { schemaVersion: 1, records: [] } })
  })

  it('returns an empty (not error) state when every record is tampered', () => {
    const bad = { ...record(), axes: { trust: 999, respect: 0, fear: 0, familiarity: 0 } }
    const result = loadNpcRelationshipSaveState(JSON.stringify({ schemaVersion: 1, records: [bad] }))
    expect(result).toEqual({ ok: true, state: { schemaVersion: 1, records: [] } })
  })

  it('caps survivors deterministically when the blob carries more than the max', () => {
    const many = Array.from({ length: NPC_RELATIONSHIP_SAVE_MAX_RECORDS + 5 }, (_, i) =>
      record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: `npc-${String(i).padStart(3, '0')}` } }),
    )
    const result = loadNpcRelationshipSaveState(JSON.stringify({ schemaVersion: 1, records: many }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.state.records).toHaveLength(NPC_RELATIONSHIP_SAVE_MAX_RECORDS)
  })

  it('uses fixed codes without echoing unsafe input', () => {
    const result = loadNpcRelationshipSaveState(JSON.stringify({ schemaVersion: 1, records: [{ hacked: 'secret leak' }] }))
    expect(result).toEqual({ ok: true, state: { schemaVersion: 1, records: [] } })
    expect(JSON.stringify(result)).not.toContain('secret leak')
  })
})

describe('filterRestorableRelationships', () => {
  const scope = { worldId: 'world-1', sessionId: 'session-1' }

  it('drops worldId and sessionId mismatches (counted, not restored)', () => {
    const records = [
      record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'keep' } }),
      record({ scope: { worldId: 'world-2', sessionId: 'session-1', npcId: 'w' } }),
      record({ scope: { worldId: 'world-1', sessionId: 'session-2', npcId: 's' } }),
    ]
    const result = filterRestorableRelationships(records, scope)
    expect(result.records.map((r) => r.scope.npcId)).toEqual(['keep'])
    expect(result.keptCount).toBe(1)
    expect(result.droppedByScope).toBe(2)
    expect(result.droppedCount).toBe(2)
  })

  it('restores records for npcIds not present in any loaded room (no npcId cross-check)', () => {
    const records = [record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'npc-not-in-any-loaded-room' } })]
    const result = filterRestorableRelationships(records, scope)
    expect(result.records.map((r) => r.scope.npcId)).toEqual(['npc-not-in-any-loaded-room'])
  })

  it('applies the deterministic cap on restore (over-cap excess dropped deterministically)', () => {
    const records = Array.from({ length: NPC_RELATIONSHIP_SAVE_MAX_RECORDS + 3 }, (_, i) =>
      record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: `npc-${String(i).padStart(3, '0')}` } }),
    )
    const result = filterRestorableRelationships(records, scope)
    expect(result.records).toHaveLength(NPC_RELATIONSHIP_SAVE_MAX_RECORDS)
    expect(result.droppedByCap).toBe(3)
  })

  it('returns only records plus safe integer counts — never raw axis values', () => {
    const result = filterRestorableRelationships(
      [
        record({ scope: { worldId: 'world-1', sessionId: 'session-1', npcId: 'keep' }, axes: { trust: 42, respect: -7, fear: 3, familiarity: 55 } }),
        record({ scope: { worldId: 'world-2', sessionId: 'session-1', npcId: 'drop' }, axes: { trust: 99, respect: 0, fear: 0, familiarity: 0 } }),
      ],
      scope,
    )
    const counts = {
      keptCount: result.keptCount,
      droppedCount: result.droppedCount,
      droppedByScope: result.droppedByScope,
      droppedByCap: result.droppedByCap,
    }
    expect(Object.values(counts).every((value) => typeof value === 'number')).toBe(true)
  })
})

describe('relationshipSaveState safety properties', () => {
  it('serialized JSON has no free-text values — only ids, literals, schemaVersion, and integers', () => {
    const json = buildNpcRelationshipSaveJson([record()])!
    const parsed = JSON.parse(json) as unknown
    const values = collectLeafValues(parsed)
    for (const value of values) {
      if (typeof value === 'string') {
        expect(['npc', 'player', 'world-1', 'session-1', 'npc-1']).toContain(value)
      } else {
        expect(typeof value === 'number' || typeof value === 'boolean').toBe(true)
      }
    }
  })

  it('does not import app, renderer, providers, persistence, backend, world-session, memory, facts, world state/events, or dialogue', () => {
    const forbiddenFragments = [
      '/App',
      '../app',
      '../renderer',
      '../generation',
      '../persistence',
      '../server',
      '../world-session',
      '../memory',
      '../dialogue',
      '../providers',
      '../facts',
      '../world/',
    ]

    for (const fragment of forbiddenFragments) {
      expect(relationshipSaveStateSource).not.toContain(fragment)
    }
  })
})

function collectLeafValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(collectLeafValues)
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectLeafValues)
  }
  return [value]
}
