import type { LoadedRoom } from '../loadRoomSpec'
import type { RoomSpec } from '../roomSpec'

/**
 * Durable saved-room port (ADR-0018). A pure domain contract: the SQLite adapter
 * (`SqliteRoomStore`) implements it server-side, and the shape deliberately
 * mirrors `RoomRegistry.resolve` so a future room-backed source can slot in
 * behind it ([ADR-0016]). Persisted rooms are the validated RoomSpec *data
 * document* only — never renderer objects ([ADR-0008]).
 *
 * Expected failures are typed results, not thrown (mirrors `RoomLoadResult` /
 * the `WorldStore` port).
 */

export type RoomStoreSaveResult =
  | { ok: true }
  | { ok: false; error: { code: 'invalid-room' } }

export type RoomStoreGetResult =
  | { ok: true; room: LoadedRoom }
  | { ok: false; reason: 'not-found' | 'invalid-stored-room' }

export interface RoomStore {
  /** Persist a validated RoomSpec data document (create-or-replace). */
  saveRoom(spec: RoomSpec): Promise<RoomStoreSaveResult>
  /** Look up a saved room by its id and re-validate it at the boundary. */
  getRoom(roomId: string): Promise<RoomStoreGetResult>
}
