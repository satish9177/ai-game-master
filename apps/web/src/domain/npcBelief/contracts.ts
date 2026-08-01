/**
 * Production-safe mirror of the research belief contract.
 *
 * The confidence ladder mirrors ConfidenceSchema in
 * domain/livingWorldProof/contracts.ts (:110) -> low | medium | high
 * and deriveNpcBelief's full->high rule mirrors beliefFromObservation in
 * domain/livingWorldProof/beliefUpdate.ts (:15).
 *
 * Both are DELIBERATELY NOT IMPORTED: that directory is a research proof rig
 * whose own header declares it "Not wired into any use-case, store, or UI",
 * and the attention static-closure test does not cover belief modules, so an
 * import would be silent coupling rather than a caught one.
 *
 * v0 only ever produces the `high` rung, so `confidence` is the literal 'high'
 * rather than the full ladder. The other rungs become real when partial or
 * ambiguous observations do; widening this type, widening the event payload
 * enum, and reintroducing the matching threshold refusal are one change and
 * must land together.
 */

export const NPC_BELIEF_SCHEMA_VERSION = 1 as const
export const NPC_ACTION_FLAG_PREFIX = 'npc-action' as const

export type NpcObservation = Readonly<{
  schemaVersion: 1
  observerNpcId: string
  kind: 'item-taken-from-room'
  roomId: string
  itemId: string
  fidelity: 'full'
  sourceEventId: string
  sourceSeq: number
  occurredAt: string
}>

export type NpcBelief = Readonly<{
  schemaVersion: 1
  holderNpcId: string
  predicate: 'player-took-item'
  itemId: string
  roomId: string
  confidence: 'high'
  supportingEventIds: readonly string[]
  lastUpdatedSeq: number
}>

export function npcActionFlagKey(
  npcId: string,
  action: 'bar-exit',
  targetObjectId: string,
): string {
  return `${NPC_ACTION_FLAG_PREFIX}:${encodeURIComponent(npcId)}:${action}:${encodeURIComponent(targetObjectId)}`
}

export function parseNpcActionFlagKey(
  key: string,
): { npcId: string; action: 'bar-exit'; targetObjectId: string } | null {
  const segments = key.split(':')
  if (
    segments.length !== 4
    || segments[0] !== NPC_ACTION_FLAG_PREFIX
    || segments[2] !== 'bar-exit'
  ) return null

  try {
    const npcId = decodeURIComponent(segments[1]!)
    const targetObjectId = decodeURIComponent(segments[3]!)
    if (npcId.length === 0 || targetObjectId.length === 0) return null
    return { npcId, action: 'bar-exit', targetObjectId }
  } catch {
    return null
  }
}

export type NpcActionBinding = Readonly<{
  roomId: string
  npcId: string
  targetObjectId: string
  triggerItemId: string
}>

export const BELIEF_GATED_NPC_ACTION_BINDINGS = [
  {
    roomId: 'throne-room',
    npcId: 'herald-asha',
    targetObjectId: 'north-door',
    triggerItemId: 'gold-coin',
  },
] as const

export function npcActionBindingFor(roomId: string): NpcActionBinding | undefined {
  return BELIEF_GATED_NPC_ACTION_BINDINGS.find((binding) => binding.roomId === roomId)
}
