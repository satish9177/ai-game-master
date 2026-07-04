import { describe, expect, it } from 'vitest'
import { DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT } from './recallRoomMemoryContext'
import type { RecalledRoomMemory } from './recallRoomMemoryContext'
import { buildVisibleRoomMemoryContext } from './buildVisibleRoomMemoryContext'
import { ROOM_MEMORY_SCHEMA_VERSION } from '../domain/memory/roomContracts'
import type { RoomMemoryKind, RoomMemoryRecord } from '../domain/memory/roomContracts'

function roomMemory(overrides: Partial<RoomMemoryRecord> = {}): RoomMemoryRecord {
  return {
    schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
    memoryId: 'mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    roomId: 'room-1',
    kind: 'room_observation',
    text: 'remembered room text',
    provenance: { source: 'game', npcId: 'npc-source', turnIndex: 2 },
    confidence: 'medium',
    seq: 1,
    createdAt: '2026-07-04T00:00:00.000Z',
    ...overrides,
  }
}

function recalled(records: RoomMemoryRecord[]): RecalledRoomMemory {
  return {
    scope: {
      worldId: 'world-1',
      sessionId: 'session-1',
      roomId: 'room-1',
    },
    records,
  }
}

describe('buildVisibleRoomMemoryContext', () => {
  it('excludes player_claim room memory for an NPC viewer', () => {
    const context = buildVisibleRoomMemoryContext(
      recalled([roomMemory({ kind: 'player_claim', text: 'the player said this' })]),
      'npc-real-1',
    )

    expect(context).toEqual({ entries: [] })
  })

  it('keeps room_observation, room_note, and room_summary in the viewer room', () => {
    const observation = roomMemory({ memoryId: 'observation', kind: 'room_observation', text: 'observed' })
    const note = roomMemory({ memoryId: 'note', kind: 'room_note', text: 'noted' })
    const summary = roomMemory({ memoryId: 'summary', kind: 'room_summary', text: 'summarized' })

    expect(buildVisibleRoomMemoryContext(recalled([observation, note, summary]), 'npc-real-1')).toEqual({
      entries: [
        { text: 'observed', kind: 'room_observation' },
        { text: 'noted', kind: 'room_note' },
        { text: 'summarized', kind: 'room_summary' },
      ],
    })
  })

  it('filters before applying DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT', () => {
    const records = [
      roomMemory({ memoryId: 'claim-1', kind: 'player_claim', text: 'claim 1' }),
      roomMemory({ memoryId: 'claim-2', kind: 'player_claim', text: 'claim 2' }),
      roomMemory({ memoryId: 'visible-1', text: 'visible 1' }),
      roomMemory({ memoryId: 'visible-2', text: 'visible 2' }),
      roomMemory({ memoryId: 'visible-3', text: 'visible 3' }),
      roomMemory({ memoryId: 'visible-4', text: 'visible 4' }),
      roomMemory({ memoryId: 'visible-5', text: 'visible 5' }),
      roomMemory({ memoryId: 'visible-6', text: 'visible 6' }),
    ]

    const context = buildVisibleRoomMemoryContext(recalled(records), 'npc-real-1')

    expect(context?.entries).toHaveLength(DEFAULT_ROOM_MEMORY_DIALOGUE_LIMIT)
    expect(context?.entries.map((entry) => entry.text)).toEqual([
      'visible 1',
      'visible 2',
      'visible 3',
      'visible 4',
      'visible 5',
    ])
  })

  it('drops different-room, cross-world, and cross-session records', () => {
    const matching = roomMemory({ memoryId: 'matching', text: 'matching' })
    const differentRoom = roomMemory({ memoryId: 'different-room', roomId: 'room-2', text: 'different room' })
    const crossWorld = roomMemory({ memoryId: 'cross-world', worldId: 'world-2', text: 'cross world' })
    const crossSession = roomMemory({ memoryId: 'cross-session', sessionId: 'session-2', text: 'cross session' })

    expect(
      buildVisibleRoomMemoryContext(
        recalled([differentRoom, crossWorld, matching, crossSession]),
        'npc-real-1',
      ),
    ).toEqual({
      entries: [{ text: 'matching', kind: 'room_observation' }],
    })
  })

  it('drops unknown-kind room memory without throwing', () => {
    const unknownKind = roomMemory({ kind: 'future_room_kind' as RoomMemoryKind })

    expect(() => buildVisibleRoomMemoryContext(recalled([unknownKind]), 'npc-real-1')).not.toThrow()
    expect(buildVisibleRoomMemoryContext(recalled([unknownKind]), 'npc-real-1')).toEqual({ entries: [] })
  })

  it('returns an empty entries context for empty input or all-filtered input', () => {
    expect(buildVisibleRoomMemoryContext(recalled([]), 'npc-real-1')).toEqual({ entries: [] })
    expect(
      buildVisibleRoomMemoryContext(
        recalled([roomMemory({ kind: 'player_claim' }), roomMemory({ roomId: 'room-2' })]),
        'npc-real-1',
      ),
    ).toEqual({ entries: [] })
  })

  it('returns memory-shaped entries with text and original memory kind', () => {
    const context = buildVisibleRoomMemoryContext(
      recalled([roomMemory({ kind: 'room_note', text: 'visible note' })]),
      'npc-real-1',
    )

    expect(context).toEqual({
      entries: [{ text: 'visible note', kind: 'room_note' }],
    })
    expect(context?.entries[0]).not.toHaveProperty('factId')
    expect(context?.entries[0]).not.toHaveProperty('visibility')
  })

  it('preserves input order among surviving visible records', () => {
    const first = roomMemory({ memoryId: 'first', kind: 'room_summary', text: 'first' })
    const dropped = roomMemory({ memoryId: 'dropped', kind: 'player_claim', text: 'dropped' })
    const second = roomMemory({ memoryId: 'second', kind: 'room_note', text: 'second' })
    const third = roomMemory({ memoryId: 'third', kind: 'room_observation', text: 'third' })

    expect(buildVisibleRoomMemoryContext(recalled([first, dropped, second, third]), 'npc-real-1')).toEqual({
      entries: [
        { text: 'first', kind: 'room_summary' },
        { text: 'second', kind: 'room_note' },
        { text: 'third', kind: 'room_observation' },
      ],
    })
  })

  it('does not mutate recalled input, records, or scope', () => {
    const input = recalled([
      roomMemory({ memoryId: 'visible' }),
      roomMemory({ memoryId: 'claim', kind: 'player_claim' }),
    ])
    const snapshot = structuredClone(input)

    buildVisibleRoomMemoryContext(input, 'npc-real-1')

    expect(input).toEqual(snapshot)
  })

  it('uses a real npcId argument without requiring a placeholder id', () => {
    const input = recalled([roomMemory({ text: 'visible' })])

    expect(buildVisibleRoomMemoryContext(input, 'npc-alpha')).toEqual(
      buildVisibleRoomMemoryContext(input, 'npc-beta'),
    )
  })
})
