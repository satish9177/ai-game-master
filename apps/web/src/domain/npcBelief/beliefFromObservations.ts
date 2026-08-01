import {
  NPC_BELIEF_SCHEMA_VERSION,
  type NpcBelief,
  type NpcObservation,
} from './contracts'

export function deriveNpcBelief(
  observations: readonly NpcObservation[],
): NpcBelief | null {
  if (observations.length === 0) return null

  const ordered = [...observations].sort((left, right) => left.sourceSeq - right.sourceSeq)
  const newest = ordered[ordered.length - 1]!
  return {
    schemaVersion: NPC_BELIEF_SCHEMA_VERSION,
    holderNpcId: ordered[0]!.observerNpcId,
    predicate: 'player-took-item',
    itemId: newest.itemId,
    roomId: newest.roomId,
    confidence: 'high',
    supportingEventIds: ordered.map((observation) => observation.sourceEventId),
    lastUpdatedSeq: newest.sourceSeq,
  }
}
