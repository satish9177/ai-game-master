import type { NpcBeliefRecord } from '../domain/npcBelief/beliefVersions'
import {
  SerializedBeliefV1Schema,
  SerializedBeliefV2Schema,
  type SerializedBelief,
} from '../domain/world/events'

export function serializeCommittedBelief(
  belief: NpcBeliefRecord,
): SerializedBelief {
  if (belief.schemaVersion === 1) {
    return SerializedBeliefV1Schema.parse({
      predicate: belief.predicate,
      itemId: belief.itemId,
      roomId: belief.roomId,
      confidence: belief.confidence,
    })
  }

  return SerializedBeliefV2Schema.parse({
    beliefSchemaVersion: 2,
    predicate: belief.predicate,
    itemId: belief.itemId,
    roomId: belief.roomId,
    confidence: belief.confidence,
    warrant: belief.warrant,
  })
}
