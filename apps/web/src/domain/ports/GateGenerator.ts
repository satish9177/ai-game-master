import type { LoadedRoom } from '../loadRoomSpec'

export interface GateGenerator {
  generate(room: LoadedRoom): Promise<string | null>
}
