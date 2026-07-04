import { describe, expect, it } from 'vitest'
import { selectVisibleRoomMemories } from './selectVisibleRoomMemories'
import type { NPCFactViewer } from './visibility'
import {
  ROOM_MEMORY_SCHEMA_VERSION,
} from '../memory/roomContracts'
import type { RoomMemoryKind, RoomMemoryRecord } from '../memory/roomContracts'

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

const viewer: NPCFactViewer = {
  kind: 'npc',
  worldId: 'world-1',
  sessionId: 'session-1',
  npcId: 'npc-1',
  roomId: 'room-1',
}

describe('selectVisibleRoomMemories', () => {
  it('drops player_claim room memory for an NPC viewer', () => {
    const claim = roomMemory({ kind: 'player_claim' })

    expect(selectVisibleRoomMemories([claim], viewer)).toEqual([])
  })

  it('keeps room_observation, room_note, and room_summary in the viewer room', () => {
    const observation = roomMemory({ memoryId: 'observation', kind: 'room_observation' })
    const note = roomMemory({ memoryId: 'note', kind: 'room_note' })
    const summary = roomMemory({ memoryId: 'summary', kind: 'room_summary' })

    expect(selectVisibleRoomMemories([observation, note, summary], viewer)).toEqual([
      observation,
      note,
      summary,
    ])
  })

  it('drops different-room room memory', () => {
    const otherRoom = roomMemory({ roomId: 'room-2' })

    expect(selectVisibleRoomMemories([otherRoom], viewer)).toEqual([])
  })

  it('drops cross-world and cross-session records', () => {
    const matching = roomMemory({ memoryId: 'matching' })
    const crossWorld = roomMemory({ memoryId: 'cross-world', worldId: 'world-2' })
    const crossSession = roomMemory({ memoryId: 'cross-session', sessionId: 'session-2' })

    expect(selectVisibleRoomMemories([crossWorld, matching, crossSession], viewer)).toEqual([
      matching,
    ])
  })

  it('drops unknown-kind room memory without throwing', () => {
    const unknownKind = roomMemory({ kind: 'future_room_kind' as RoomMemoryKind })

    expect(() => selectVisibleRoomMemories([unknownKind], viewer)).not.toThrow()
    expect(selectVisibleRoomMemories([unknownKind], viewer)).toEqual([])
  })

  it('preserves original input order among surviving records', () => {
    const first = roomMemory({ memoryId: 'first', kind: 'room_summary' })
    const droppedClaim = roomMemory({ memoryId: 'claim', kind: 'player_claim' })
    const second = roomMemory({ memoryId: 'second', kind: 'room_note' })
    const droppedRoom = roomMemory({ memoryId: 'wrong-room', roomId: 'room-2' })
    const third = roomMemory({ memoryId: 'third', kind: 'room_observation' })

    expect(selectVisibleRoomMemories([first, droppedClaim, second, droppedRoom, third], viewer)).toEqual([
      first,
      second,
      third,
    ])
  })

  it('does not mutate the input array or records', () => {
    const records = [
      roomMemory({ memoryId: 'visible' }),
      roomMemory({ memoryId: 'hidden', kind: 'player_claim' }),
    ]
    const snapshot = structuredClone(records)

    selectVisibleRoomMemories(records, viewer)

    expect(records).toEqual(snapshot)
  })

  it('returns [] for empty input', () => {
    expect(selectVisibleRoomMemories([], viewer)).toEqual([])
  })

  it('returns the original memory records, not Fact objects', () => {
    const visible = roomMemory({ memoryId: 'visible' })
    const result = selectVisibleRoomMemories([visible], viewer)

    expect(result).toHaveLength(1)
    expect(result[0]).toBe(visible)
    expect(result[0]?.kind).toBe('room_observation')
    expect('factId' in result[0]!).toBe(false)
    expect('visibility' in result[0]!).toBe(false)
  })
})

