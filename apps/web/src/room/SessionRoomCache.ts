import type { LoadedRoom } from '../domain/loadRoomSpec'

export class SessionRoomCache {
  private readonly rooms = new Map<string, LoadedRoom>()

  get(roomId: string): LoadedRoom | undefined {
    return this.rooms.get(roomId)
  }

  set(roomId: string, room: LoadedRoom): void {
    this.rooms.set(roomId, room)
  }

  has(roomId: string): boolean {
    return this.rooms.has(roomId)
  }
}
