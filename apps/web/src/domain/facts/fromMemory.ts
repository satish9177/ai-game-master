import {
  FACT_SCHEMA_VERSION,
  FactSchema,
} from './contracts'
import type { Fact, FactKind, FactVisibility } from './contracts'
import type { NpcMemoryRecord } from '../memory/contracts'
import type { RoomMemoryRecord } from '../memory/roomContracts'

type FactCandidate = Omit<Fact, 'kind' | 'authority' | 'confidence' | 'visibility'> & {
  kind: FactKind
  authority: 'unverified'
  confidence: Fact['confidence']
  visibility: FactVisibility
}

export function deriveFactFromNpcMemory(record: NpcMemoryRecord): Fact {
  const base = npcBaseFact(record)
  const candidate = buildNpcFactCandidate(record, base)
  return parseOrHidden(candidate, hiddenNpcFact(record, base))
}

export function deriveFactsFromNpcMemories(records: readonly NpcMemoryRecord[]): Fact[] {
  return records.map(deriveFactFromNpcMemory)
}

export function deriveFactFromRoomMemory(record: RoomMemoryRecord): Fact {
  const base = roomBaseFact(record)
  const candidate = buildRoomFactCandidate(record, base)
  return parseOrHidden(candidate, hiddenRoomFact(record, base))
}

export function deriveFactsFromRoomMemories(records: readonly RoomMemoryRecord[]): Fact[] {
  return records.map(deriveFactFromRoomMemory)
}

function buildNpcFactCandidate(record: NpcMemoryRecord, base: Omit<Fact, 'kind' | 'authority' | 'confidence' | 'visibility'>): FactCandidate {
  switch (record.kind) {
    case 'player_claim':
      return withCommonFactFields(base, 'player-claim', { scope: 'player-known' }, record.confidence)
    case 'npc_belief':
      return withCommonFactFields(base, 'npc-belief', { scope: 'npc-known', npcIds: [record.npcId] }, record.confidence)
    case 'npc_observation':
      return withCommonFactFields(base, 'observed', { scope: 'npc-known', npcIds: [record.npcId] }, record.confidence)
    case 'dialogue_summary':
      return withCommonFactFields(base, 'summary', { scope: 'npc-known', npcIds: [record.npcId] }, record.confidence)
    default:
      return hiddenNpcFact(record, base)
  }
}

function buildRoomFactCandidate(record: RoomMemoryRecord, base: Omit<Fact, 'kind' | 'authority' | 'confidence' | 'visibility'>): FactCandidate {
  switch (record.kind) {
    case 'player_claim':
      return withCommonFactFields(base, 'player-claim', { scope: 'player-known' }, record.confidence)
    case 'room_observation':
    case 'room_note':
      return withCommonFactFields(base, 'observed', { scope: 'room-known', roomId: record.roomId }, record.confidence)
    case 'room_summary':
      return withCommonFactFields(base, 'summary', { scope: 'room-known', roomId: record.roomId }, record.confidence)
    default:
      return hiddenRoomFact(record, base)
  }
}

function npcBaseFact(record: NpcMemoryRecord): Omit<Fact, 'kind' | 'authority' | 'confidence' | 'visibility'> {
  return {
    schemaVersion: FACT_SCHEMA_VERSION,
    factId: `npc-memory:${record.memoryId}`,
    worldId: record.worldId,
    sessionId: record.sessionId,
    source: record.provenance.source,
    text: record.text,
    provenance: {
      roomId: record.provenance.roomId,
      npcId: record.npcId,
      turnIndex: record.provenance.turnIndex,
    },
  }
}

function roomBaseFact(record: RoomMemoryRecord): Omit<Fact, 'kind' | 'authority' | 'confidence' | 'visibility'> {
  return {
    schemaVersion: FACT_SCHEMA_VERSION,
    factId: `room-memory:${record.memoryId}`,
    worldId: record.worldId,
    sessionId: record.sessionId,
    source: record.provenance.source,
    text: record.text,
    provenance: {
      roomId: record.roomId,
      npcId: record.provenance.npcId,
      turnIndex: record.provenance.turnIndex,
    },
  }
}

function withCommonFactFields(
  base: Omit<Fact, 'kind' | 'authority' | 'confidence' | 'visibility'>,
  kind: FactKind,
  visibility: FactVisibility,
  confidence: Fact['confidence'],
): FactCandidate {
  return {
    ...base,
    kind,
    authority: 'unverified',
    confidence,
    visibility,
  }
}

function hiddenNpcFact(
  record: NpcMemoryRecord,
  base: Omit<Fact, 'kind' | 'authority' | 'confidence' | 'visibility'>,
): FactCandidate {
  return hiddenFact(base, record.npcId)
}

function hiddenRoomFact(
  _record: RoomMemoryRecord,
  base: Omit<Fact, 'kind' | 'authority' | 'confidence' | 'visibility'>,
): FactCandidate {
  return hiddenFact(base)
}

function hiddenFact(
  base: Omit<Fact, 'kind' | 'authority' | 'confidence' | 'visibility'>,
  fallbackNpcId?: string,
): FactCandidate {
  return {
    ...base,
    kind: 'hidden',
    authority: 'unverified',
    confidence: 'low',
    visibility: { scope: 'hidden' },
    provenance: {
      ...base.provenance,
      npcId: base.provenance?.npcId ?? fallbackNpcId,
    },
  }
}

function parseOrHidden(candidate: FactCandidate, fallback: FactCandidate): Fact {
  const parsed = FactSchema.safeParse(candidate)
  if (parsed.success) return parsed.data

  const fallbackParsed = FactSchema.safeParse(fallback)
  if (fallbackParsed.success) return fallbackParsed.data

  return {
    schemaVersion: FACT_SCHEMA_VERSION,
    factId: 'invalid-memory-fact',
    worldId: 'unknown-world',
    sessionId: 'unknown-session',
    kind: 'hidden',
    source: 'game',
    authority: 'unverified',
    confidence: 'low',
    visibility: { scope: 'hidden' },
  }
}

