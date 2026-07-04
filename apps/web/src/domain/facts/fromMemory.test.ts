import { describe, expect, it } from 'vitest'
import { FactSchema, MAX_FACT_TEXT_CHARS } from './contracts'
import {
  deriveFactFromNpcMemory,
  deriveFactFromRoomMemory,
  deriveFactsFromNpcMemories,
  deriveFactsFromRoomMemories,
} from './fromMemory'
import {
  NPC_MEMORY_SCHEMA_VERSION,
} from '../memory/contracts'
import type { MemoryConfidence, MemoryKind, MemorySource, NpcMemoryRecord } from '../memory/contracts'
import {
  ROOM_MEMORY_SCHEMA_VERSION,
} from '../memory/roomContracts'
import type { RoomMemoryKind, RoomMemoryRecord } from '../memory/roomContracts'

function npcMemory(overrides: Partial<NpcMemoryRecord> = {}): NpcMemoryRecord {
  return {
    schemaVersion: NPC_MEMORY_SCHEMA_VERSION,
    memoryId: 'mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    npcId: 'npc-1',
    kind: 'npc_observation',
    text: 'remembered text',
    provenance: { source: 'game', roomId: 'room-1', turnIndex: 2 },
    confidence: 'medium',
    seq: 1,
    createdAt: '2026-07-04T00:00:00.000Z',
    ...overrides,
  }
}

function roomMemory(overrides: Partial<RoomMemoryRecord> = {}): RoomMemoryRecord {
  return {
    schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
    memoryId: 'mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    roomId: 'room-1',
    kind: 'room_observation',
    text: 'remembered room text',
    provenance: { source: 'game', npcId: 'npc-1', turnIndex: 2 },
    confidence: 'medium',
    seq: 1,
    createdAt: '2026-07-04T00:00:00.000Z',
    ...overrides,
  }
}

describe('deriveFactFromNpcMemory', () => {
  it.each([
    ['player_claim', 'player-claim', { scope: 'player-known' }],
    ['npc_belief', 'npc-belief', { scope: 'npc-known', npcIds: ['npc-1'] }],
    ['npc_observation', 'observed', { scope: 'npc-known', npcIds: ['npc-1'] }],
    ['dialogue_summary', 'summary', { scope: 'npc-known', npcIds: ['npc-1'] }],
  ] as const)('maps NPC memory kind %s', (memoryKind, factKind, visibility) => {
    const fact = deriveFactFromNpcMemory(npcMemory({ kind: memoryKind }))

    expect(fact).toMatchObject({
      schemaVersion: 1,
      factId: 'npc-memory:mem-1',
      worldId: 'world-1',
      sessionId: 'session-1',
      kind: factKind,
      source: 'game',
      authority: 'unverified',
      confidence: 'medium',
      visibility,
      text: 'remembered text',
      provenance: { roomId: 'room-1', npcId: 'npc-1', turnIndex: 2 },
    })
    expect(fact.subjectRef).toBeUndefined()
    expect(fact.objectRef).toBeUndefined()
  })
})

describe('deriveFactFromRoomMemory', () => {
  it.each([
    ['player_claim', 'player-claim', { scope: 'player-known' }],
    ['room_observation', 'observed', { scope: 'room-known', roomId: 'room-1' }],
    ['room_note', 'observed', { scope: 'room-known', roomId: 'room-1' }],
    ['room_summary', 'summary', { scope: 'room-known', roomId: 'room-1' }],
  ] as const)('maps room memory kind %s', (memoryKind, factKind, visibility) => {
    const fact = deriveFactFromRoomMemory(roomMemory({ kind: memoryKind }))

    expect(fact).toMatchObject({
      schemaVersion: 1,
      factId: 'room-memory:mem-1',
      worldId: 'world-1',
      sessionId: 'session-1',
      kind: factKind,
      source: 'game',
      authority: 'unverified',
      confidence: 'medium',
      visibility,
      text: 'remembered room text',
      provenance: { roomId: 'room-1', npcId: 'npc-1', turnIndex: 2 },
    })
    expect(fact.subjectRef).toBeUndefined()
    expect(fact.objectRef).toBeUndefined()
  })
})

describe('fromMemory invariants', () => {
  it('keeps NPC-scoped and room-scoped player claims player-known only', () => {
    const npcFact = deriveFactFromNpcMemory(npcMemory({
      kind: 'player_claim',
      npcId: 'npc-private',
    }))
    const roomFact = deriveFactFromRoomMemory(roomMemory({
      kind: 'player_claim',
      roomId: 'room-private',
    }))

    expect(npcFact.visibility).toEqual({ scope: 'player-known' })
    expect(roomFact.visibility).toEqual({ scope: 'player-known' })
    expect(npcFact.visibility.scope).not.toBe('npc-known')
    expect(roomFact.visibility.scope).not.toBe('room-known')
  })

  it('keeps llm-sourced facts unverified for every memory kind', () => {
    const npcKinds: MemoryKind[] = ['player_claim', 'npc_belief', 'npc_observation', 'dialogue_summary']
    const roomKinds: RoomMemoryKind[] = ['player_claim', 'room_observation', 'room_note', 'room_summary']

    for (const kind of npcKinds) {
      expect(deriveFactFromNpcMemory(npcMemory({ kind, provenance: { source: 'llm' } })).authority).toBe('unverified')
    }
    for (const kind of roomKinds) {
      expect(deriveFactFromRoomMemory(roomMemory({ kind, provenance: { source: 'llm' } })).authority).toBe('unverified')
    }
  })

  it('fails closed for unknown NPC and room memory kinds without throwing', () => {
    const unsafeNpcMemory = npcMemory({ kind: 'future_npc_kind' as MemoryKind })
    const unsafeRoomMemory = roomMemory({ kind: 'future_room_kind' as RoomMemoryKind })

    expect(() => deriveFactFromNpcMemory(unsafeNpcMemory)).not.toThrow()
    expect(() => deriveFactFromRoomMemory(unsafeRoomMemory)).not.toThrow()
    expect(deriveFactFromNpcMemory(unsafeNpcMemory)).toMatchObject({
      kind: 'hidden',
      authority: 'unverified',
      confidence: 'low',
      visibility: { scope: 'hidden' },
    })
    expect(deriveFactFromRoomMemory(unsafeRoomMemory)).toMatchObject({
      kind: 'hidden',
      authority: 'unverified',
      confidence: 'low',
      visibility: { scope: 'hidden' },
    })
  })

  it('fails closed when mapper output validation fails', () => {
    const invalidNpcFact = deriveFactFromNpcMemory(npcMemory({ npcId: '' }))
    const invalidRoomFact = deriveFactFromRoomMemory(roomMemory({ roomId: '' }))

    expect(invalidNpcFact).toMatchObject({
      kind: 'hidden',
      authority: 'unverified',
      confidence: 'low',
      visibility: { scope: 'hidden' },
    })
    expect(invalidRoomFact).toMatchObject({
      kind: 'hidden',
      authority: 'unverified',
      confidence: 'low',
      visibility: { scope: 'hidden' },
    })
    expect(FactSchema.safeParse(invalidNpcFact).success).toBe(true)
    expect(FactSchema.safeParse(invalidRoomFact).success).toBe(true)
  })

  it('derives deterministic disambiguated factIds', () => {
    const npcRecord = npcMemory({ memoryId: 'same-id' })
    const roomRecord = roomMemory({ memoryId: 'same-id' })

    expect(deriveFactFromNpcMemory(npcRecord).factId).toBe('npc-memory:same-id')
    expect(deriveFactFromNpcMemory(npcRecord).factId).toBe(deriveFactFromNpcMemory(npcRecord).factId)
    expect(deriveFactFromRoomMemory(roomRecord).factId).toBe('room-memory:same-id')
    expect(deriveFactFromNpcMemory(npcRecord).factId).not.toBe(deriveFactFromRoomMemory(roomRecord).factId)
    expect(deriveFactFromNpcMemory(npcMemory({ memoryId: 'other-id' })).factId).not.toBe(
      deriveFactFromNpcMemory(npcRecord).factId,
    )
  })

  it('does not mutate input records', () => {
    const npcRecord = npcMemory()
    const roomRecord = roomMemory()
    const npcSnapshot = structuredClone(npcRecord)
    const roomSnapshot = structuredClone(roomRecord)

    deriveFactFromNpcMemory(npcRecord)
    deriveFactFromRoomMemory(roomRecord)

    expect(npcRecord).toEqual(npcSnapshot)
    expect(roomRecord).toEqual(roomSnapshot)
  })

  it('produces schema-valid facts for mapped and fail-closed records', () => {
    const facts = [
      deriveFactFromNpcMemory(npcMemory()),
      deriveFactFromNpcMemory(npcMemory({ kind: 'future_npc_kind' as MemoryKind })),
      deriveFactFromRoomMemory(roomMemory()),
      deriveFactFromRoomMemory(roomMemory({ kind: 'future_room_kind' as RoomMemoryKind })),
    ]

    for (const fact of facts) {
      expect(FactSchema.safeParse(fact).success).toBe(true)
    }
  })

  it('copies text verbatim at the 280-character boundary', () => {
    const text = 'a'.repeat(MAX_FACT_TEXT_CHARS)

    expect(deriveFactFromNpcMemory(npcMemory({ text })).text).toBe(text)
    expect(deriveFactFromRoomMemory(roomMemory({ text })).text).toBe(text)
  })

  it('passes through low, medium, and high confidence except on fail-closed paths', () => {
    for (const confidence of ['low', 'medium', 'high'] as const satisfies readonly MemoryConfidence[]) {
      expect(deriveFactFromNpcMemory(npcMemory({ confidence })).confidence).toBe(confidence)
      expect(deriveFactFromRoomMemory(roomMemory({ confidence })).confidence).toBe(confidence)
    }

    expect(deriveFactFromNpcMemory(npcMemory({ kind: 'future_npc_kind' as MemoryKind })).confidence).toBe('low')
    expect(deriveFactFromRoomMemory(roomMemory({ kind: 'future_room_kind' as RoomMemoryKind })).confidence).toBe('low')
  })

  it('never produces rumor from any current memory kind', () => {
    const npcKinds: MemoryKind[] = ['player_claim', 'npc_belief', 'npc_observation', 'dialogue_summary']
    const roomKinds: RoomMemoryKind[] = ['player_claim', 'room_observation', 'room_note', 'room_summary']

    expect(npcKinds.map((kind) => deriveFactFromNpcMemory(npcMemory({ kind })).kind)).not.toContain('rumor')
    expect(roomKinds.map((kind) => deriveFactFromRoomMemory(roomMemory({ kind })).kind)).not.toContain('rumor')
  })

  it('leaves subjectRef and objectRef undefined even when memory has snapshots or entity-like text', () => {
    const npcFact = deriveFactFromNpcMemory(npcMemory({
      text: 'entity:altar object:relic',
      entitySnapshots: { room: { id: 'room-1', displayName: 'Room One' } },
    }))
    const roomFact = deriveFactFromRoomMemory(roomMemory({
      text: 'entity:altar object:relic',
      entitySnapshots: { npc: { id: 'npc-1', displayName: 'NPC One' } },
    }))

    expect(npcFact.subjectRef).toBeUndefined()
    expect(npcFact.objectRef).toBeUndefined()
    expect(roomFact.subjectRef).toBeUndefined()
    expect(roomFact.objectRef).toBeUndefined()
  })

  it('array wrappers preserve order, map 1:1, and return [] for empty arrays', () => {
    const npcRecords = [
      npcMemory({ memoryId: 'npc-a' }),
      npcMemory({ memoryId: 'npc-b', kind: 'player_claim' }),
      npcMemory({ memoryId: 'npc-c', kind: 'dialogue_summary' }),
    ]
    const roomRecords = [
      roomMemory({ memoryId: 'room-a' }),
      roomMemory({ memoryId: 'room-b', kind: 'player_claim' }),
      roomMemory({ memoryId: 'room-c', kind: 'room_summary' }),
    ]

    expect(deriveFactsFromNpcMemories(npcRecords).map((fact) => fact.factId)).toEqual([
      'npc-memory:npc-a',
      'npc-memory:npc-b',
      'npc-memory:npc-c',
    ])
    expect(deriveFactsFromRoomMemories(roomRecords).map((fact) => fact.factId)).toEqual([
      'room-memory:room-a',
      'room-memory:room-b',
      'room-memory:room-c',
    ])
    expect(deriveFactsFromNpcMemories([])).toEqual([])
    expect(deriveFactsFromRoomMemories([])).toEqual([])
  })

  it('passes through every allowed source value', () => {
    for (const source of ['player', 'npc', 'game', 'llm'] as const satisfies readonly MemorySource[]) {
      expect(deriveFactFromNpcMemory(npcMemory({ provenance: { source } })).source).toBe(source)
      expect(deriveFactFromRoomMemory(roomMemory({ provenance: { source } })).source).toBe(source)
    }
  })
})

