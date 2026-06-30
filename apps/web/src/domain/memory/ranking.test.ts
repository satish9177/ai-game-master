import { describe, expect, it } from 'vitest'

import { NPC_MEMORY_SCHEMA_VERSION } from './contracts'
import type { NpcMemoryRecord } from './contracts'
import { ROOM_MEMORY_SCHEMA_VERSION } from './roomContracts'
import type { RoomMemoryRecord } from './roomContracts'
import {
  DEFAULT_MEMORY_RANKING_WEIGHTS,
  rankMemories,
} from './ranking'
import type {
  MemoryRankingQuery,
  MemoryRankingWeights,
  RankConfidence,
  RankableMemory,
} from './ranking'

function mem(o: {
  memoryId: string
  kind?: string
  confidence?: RankConfidence
  seq?: number
  importance?: number
  provenance?: RankableMemory['provenance']
}): RankableMemory {
  return {
    memoryId: o.memoryId,
    kind: o.kind ?? 'npc_observation',
    confidence: o.confidence ?? 'medium',
    seq: o.seq ?? 1,
    ...(o.importance !== undefined ? { importance: o.importance } : {}),
    provenance: o.provenance ?? { source: 'game' },
  }
}

function order(
  records: readonly RankableMemory[],
  query?: MemoryRankingQuery,
  weights?: Partial<MemoryRankingWeights>,
): string[] {
  return rankMemories(records, query, weights).map((r) => r.record.memoryId)
}

describe('rankMemories', () => {
  it('returns [] for empty input', () => {
    expect(rankMemories([])).toEqual([])
  })

  it('1. explicit importance beats the kind proxy', () => {
    // A: high explicit importance but a low-proxy kind. B: no importance, high-proxy kind.
    const a = mem({ memoryId: 'a', kind: 'room_summary', importance: 5 }) // proxy would be 1
    const b = mem({ memoryId: 'b', kind: 'room_observation' }) // proxy 3, no explicit importance
    expect(order([b, a])).toEqual(['a', 'b'])

    // And an explicit LOW importance ranks below a proxy-driven record.
    const lowExplicit = mem({ memoryId: 'low', kind: 'room_observation', importance: 0 })
    const proxyDriven = mem({ memoryId: 'proxy', kind: 'room_observation' }) // proxy 3
    expect(order([lowExplicit, proxyDriven])).toEqual(['proxy', 'low'])
  })

  it('2. kind proxy applies when importance is missing', () => {
    const high = mem({ memoryId: 'high', kind: 'room_observation' }) // proxy 3
    const low = mem({ memoryId: 'low', kind: 'room_summary' }) // proxy 1
    expect(order([low, high])).toEqual(['high', 'low'])
  })

  it('3. allowedKinds is a hard filter applied before scoring', () => {
    const records = [
      mem({ memoryId: 'a', kind: 'npc_observation' }),
      mem({ memoryId: 'b', kind: 'dialogue_summary' }),
    ]
    expect(order(records, { allowedKinds: ['npc_observation'] })).toEqual(['a'])
    // An empty allow-list permits nothing.
    expect(rankMemories(records, { allowedKinds: [] })).toEqual([])
  })

  it('4. confidence contributes to the score (high > medium > low)', () => {
    const high = mem({ memoryId: 'high', confidence: 'high', importance: 1 })
    const medium = mem({ memoryId: 'med', confidence: 'medium', importance: 1 })
    const low = mem({ memoryId: 'low', confidence: 'low', importance: 1 })
    expect(order([low, high, medium])).toEqual(['high', 'med', 'low'])
  })

  it('5. same-room and same-NPC boosts rank the matching record higher', () => {
    const inRoom = mem({ memoryId: 'in', importance: 1, provenance: { source: 'game', roomId: 'lib' } })
    const elsewhere = mem({ memoryId: 'out', importance: 1, provenance: { source: 'game', roomId: 'other' } })
    expect(order([elsewhere, inRoom], { currentRoomId: 'lib' })).toEqual(['in', 'out'])

    const withNpc = mem({ memoryId: 'withNpc', importance: 1, provenance: { source: 'game', npcId: 'aria' } })
    const noNpc = mem({ memoryId: 'noNpc', importance: 1, provenance: { source: 'game', npcId: 'bjorn' } })
    expect(order([noNpc, withNpc], { activeNpcId: 'aria' })).toEqual(['withNpc', 'noNpc'])
  })

  it('6. recency uses turnIndex closeness to the current turn', () => {
    const recent = mem({ memoryId: 'recent', importance: 1, provenance: { source: 'game', turnIndex: 99 } })
    const old = mem({ memoryId: 'old', importance: 1, provenance: { source: 'game', turnIndex: 40 } })
    expect(order([old, recent], { currentTurnIndex: 100 })).toEqual(['recent', 'old'])

    // Without currentTurnIndex, recency contributes nothing (order falls to tie-break).
    const a = mem({ memoryId: 'a', importance: 1, seq: 1, provenance: { source: 'game', turnIndex: 99 } })
    const b = mem({ memoryId: 'b', importance: 1, seq: 2, provenance: { source: 'game', turnIndex: 1 } })
    expect(order([a, b])).toEqual(['b', 'a']) // equal score → higher seq first
  })

  it('7. tie-break is score desc → seq desc → memoryId asc', () => {
    // All identical score (same kind/confidence/importance, no query matches).
    const x = mem({ memoryId: 'm1', seq: 2, importance: 1 })
    const y = mem({ memoryId: 'm2', seq: 2, importance: 1 })
    const z = mem({ memoryId: 'm0', seq: 1, importance: 1 })
    expect(order([y, z, x])).toEqual(['m1', 'm2', 'm0'])
  })

  it('8. does not mutate inputs and is referentially safe', () => {
    const records = Object.freeze([
      Object.freeze(mem({ memoryId: 'a', seq: 1, importance: 1 })),
      Object.freeze(mem({ memoryId: 'b', seq: 2, importance: 5 })),
    ])
    expect(() => rankMemories(records, Object.freeze({ currentRoomId: 'x' }))).not.toThrow()
    // Original array order is untouched.
    expect(records[0]?.memoryId).toBe('a')
    expect(records[1]?.memoryId).toBe('b')
  })

  it('is deterministic: same input → identical output, independent of input order', () => {
    const a = mem({ memoryId: 'a', importance: 2 })
    const b = mem({ memoryId: 'b', importance: 4 })
    const c = mem({ memoryId: 'c', importance: 4, seq: 9 })
    const first = rankMemories([a, b, c])
    const second = rankMemories([c, a, b])
    expect(first).toEqual(second)
    expect(first.map((r) => r.record.memoryId)).toEqual(['c', 'b', 'a'])
  })

  it('custom weights override the defaults', () => {
    expect(DEFAULT_MEMORY_RANKING_WEIGHTS.sameNpc).toBe(20)
    const matched = mem({ memoryId: 'm', importance: 0, provenance: { source: 'game', npcId: 'aria' } })
    const strong = mem({ memoryId: 's', importance: 1, provenance: { source: 'game', npcId: 'other' } })
    // With sameNpc weight zeroed, the same-NPC match no longer wins.
    expect(order([matched, strong], { activeNpcId: 'aria' }, { sameNpc: 0 })).toEqual(['s', 'm'])
  })
})

describe('rankMemories — structural compatibility with shipped record types', () => {
  function npcRecord(o: { memoryId: string; roomId?: string; seq?: number }): NpcMemoryRecord {
    return {
      schemaVersion: NPC_MEMORY_SCHEMA_VERSION,
      memoryId: o.memoryId,
      worldId: 'w',
      sessionId: 's',
      npcId: 'n',
      kind: 'npc_observation',
      text: 'inert recall text',
      provenance: { source: 'game', ...(o.roomId !== undefined ? { roomId: o.roomId } : {}) },
      confidence: 'medium',
      seq: o.seq ?? 1,
      createdAt: '2026-07-01T00:00:00.000Z',
    }
  }

  function roomRecord(o: { memoryId: string; npcId?: string; seq?: number }): RoomMemoryRecord {
    return {
      schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
      memoryId: o.memoryId,
      worldId: 'w',
      sessionId: 's',
      roomId: 'r',
      kind: 'room_observation',
      text: 'inert recall text',
      provenance: { source: 'game', ...(o.npcId !== undefined ? { npcId: o.npcId } : {}) },
      confidence: 'medium',
      seq: o.seq ?? 1,
      createdAt: '2026-07-01T00:00:00.000Z',
    }
  }

  it('9a. ranks NpcMemoryRecord[] and honours same-room via provenance.roomId', () => {
    const inRoom = npcRecord({ memoryId: 'in', roomId: 'lib' })
    const elsewhere = npcRecord({ memoryId: 'out', roomId: 'other' })
    const ranked = rankMemories([elsewhere, inRoom], { currentRoomId: 'lib' })
    expect(ranked).toHaveLength(2)
    expect(ranked[0]?.record.memoryId).toBe('in')
  })

  it('9b. ranks RoomMemoryRecord[] and honours same-NPC via provenance.npcId', () => {
    const withNpc = roomRecord({ memoryId: 'withNpc', npcId: 'aria' })
    const noNpc = roomRecord({ memoryId: 'noNpc', npcId: 'bjorn' })
    const ranked = rankMemories([noNpc, withNpc], { activeNpcId: 'aria' })
    expect(ranked).toHaveLength(2)
    expect(ranked[0]?.record.memoryId).toBe('withNpc')
  })
})
