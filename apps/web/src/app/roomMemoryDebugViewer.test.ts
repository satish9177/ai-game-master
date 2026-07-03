import { describe, expect, it, vi } from 'vitest'
import { ROOM_MEMORY_SCHEMA_VERSION, type RoomMemoryRecord } from '../domain/memory/roomContracts'
import {
  INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE,
  refreshRoomMemoryDebugViewer,
  toggleRoomMemoryDebugViewer,
  type RoomMemoryDebugSnapshotSource,
} from './roomMemoryDebugViewer'

function record(overrides: Partial<RoomMemoryRecord> = {}): RoomMemoryRecord {
  return {
    schemaVersion: ROOM_MEMORY_SCHEMA_VERSION,
    memoryId: 'mem-1',
    worldId: 'world-1',
    sessionId: 'session-1',
    roomId: 'room-1',
    kind: 'room_observation',
    text: 'safe remembered room detail',
    provenance: { source: 'game' },
    confidence: 'medium',
    seq: 1,
    createdAt: '2026-06-23T10:00:00.000Z',
    ...overrides,
  }
}

function source(records: readonly RoomMemoryRecord[]) {
  const snapshotAll = vi.fn(() => records.map((memory) => structuredClone(memory)))
  return {
    snapshotAll,
    record: vi.fn(),
    restoreAll: vi.fn(),
  }
}

describe('roomMemoryDebugViewer seam', () => {
  it('opening the panel snapshots once and projects sanitized rows', () => {
    const store = source([record({ memoryId: 'mem-open' })])

    const state = toggleRoomMemoryDebugViewer(INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE, store)

    expect(state.open).toBe(true)
    expect(state.rows.map((row) => row.memoryId)).toEqual(['mem-open'])
    expect(store.snapshotAll).toHaveBeenCalledTimes(1)
  })

  it('closing the panel does not snapshot again', () => {
    const store = source([record()])
    const open = toggleRoomMemoryDebugViewer(INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE, store)

    const closed = toggleRoomMemoryDebugViewer(open, store)

    expect(closed.open).toBe(false)
    expect(closed.rows).toBe(open.rows)
    expect(store.snapshotAll).toHaveBeenCalledTimes(1)
  })

  it('refresh snapshots again only while open', () => {
    const first = record({ memoryId: 'mem-first' })
    const second = record({ memoryId: 'mem-second', seq: 2 })
    const snapshotAll = vi
      .fn<RoomMemoryDebugSnapshotSource['snapshotAll']>()
      .mockReturnValueOnce([first])
      .mockReturnValueOnce([second])
    const store = { snapshotAll, record: vi.fn(), restoreAll: vi.fn() }

    const open = toggleRoomMemoryDebugViewer(INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE, store)
    const refreshed = refreshRoomMemoryDebugViewer(open, store)

    expect(open.rows.map((row) => row.memoryId)).toEqual(['mem-first'])
    expect(refreshed.rows.map((row) => row.memoryId)).toEqual(['mem-second'])
    expect(snapshotAll).toHaveBeenCalledTimes(2)
  })

  it('refresh while closed is a no-op with no polling or subscription behavior', () => {
    const store = source([record()])

    const state = refreshRoomMemoryDebugViewer(INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE, store)

    expect(state).toBe(INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE)
    expect(store.snapshotAll).not.toHaveBeenCalled()
  })

  it('does not call or expose memory write APIs', () => {
    const store = source([record()])
    const open = toggleRoomMemoryDebugViewer(INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE, store)

    refreshRoomMemoryDebugViewer(open, store)

    expect(store.record).not.toHaveBeenCalled()
    expect(store.restoreAll).not.toHaveBeenCalled()
  })

  it('does not mutate memory records returned by the snapshot source', () => {
    const records = [record({ memoryId: 'mem-stable' })]
    const before = structuredClone(records)
    const snapshotAll = vi.fn(() => records)
    const store = { snapshotAll }

    toggleRoomMemoryDebugViewer(INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE, store)

    expect(records).toEqual(before)
  })
})
