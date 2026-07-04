import { deriveFactFromRoomMemory } from './fromMemory'
import { filterVisibleFacts } from './visibility'
import type { NPCFactViewer } from './visibility'
import type { RoomMemoryRecord } from '../memory/roomContracts'

export function selectVisibleRoomMemories(
  records: readonly RoomMemoryRecord[],
  viewer: NPCFactViewer,
): RoomMemoryRecord[] {
  const pairs = records.map((record) => ({
    record,
    fact: deriveFactFromRoomMemory(record),
  }))
  const visibleFacts = new Set(filterVisibleFacts(pairs.map(({ fact }) => fact), viewer))
  return pairs
    .filter(({ fact }) => visibleFacts.has(fact))
    .map(({ record }) => record)
}

