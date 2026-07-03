import { toRoomMemoryDebugView } from '../domain/memory/roomMemoryDebugView'
import type { RoomMemoryDebugRow } from '../domain/memory/roomMemoryDebugView'
import type { RoomMemoryRecord } from '../domain/memory/roomContracts'

export type RoomMemoryDebugSnapshotSource = Readonly<{
  snapshotAll: () => RoomMemoryRecord[]
}>

export type RoomMemoryDebugViewerState = Readonly<{
  open: boolean
  rows: readonly RoomMemoryDebugRow[]
}>

export const INITIAL_ROOM_MEMORY_DEBUG_VIEWER_STATE: RoomMemoryDebugViewerState = {
  open: false,
  rows: [],
}

export function toggleRoomMemoryDebugViewer(
  state: RoomMemoryDebugViewerState,
  source: RoomMemoryDebugSnapshotSource,
): RoomMemoryDebugViewerState {
  if (state.open) return { ...state, open: false }
  return snapshotRoomMemoryDebugViewer(source)
}

export function refreshRoomMemoryDebugViewer(
  state: RoomMemoryDebugViewerState,
  source: RoomMemoryDebugSnapshotSource,
): RoomMemoryDebugViewerState {
  if (!state.open) return state
  return snapshotRoomMemoryDebugViewer(source)
}

function snapshotRoomMemoryDebugViewer(
  source: RoomMemoryDebugSnapshotSource,
): RoomMemoryDebugViewerState {
  return {
    open: true,
    rows: toRoomMemoryDebugView(source.snapshotAll()),
  }
}
