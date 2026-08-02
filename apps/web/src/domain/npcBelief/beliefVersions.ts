import type { SerializedBelief } from '../world/events'

export type WarrantRuleId = 'sole-copresent-candidate@1' | 'direct-witness@1'

export type WarrantPremiseId =
  | 'p1-before'
  | 'p2-after'
  | 'p3-sole-candidate'
  | 'p4-no-alternate-access'
  | 'p1-witnessed-take'

export type WarrantPremise = Readonly<{
  id: WarrantPremiseId
  kind: 'observed' | 'default'
  observationEventIds: readonly string[]
  defeasible: boolean
}>

export type NpcBeliefWarrant = Readonly<{
  ruleId: WarrantRuleId
  premises: readonly WarrantPremise[]
  defeasiblePremiseIds: readonly WarrantPremiseId[]
}>

export type NpcBeliefV1 = Readonly<{
  schemaVersion: 1
  holderNpcId: string
  predicate: 'player-took-item'
  itemId: string
  roomId: string
  confidence: 'high'
  supportingEventIds: readonly string[]
  lastUpdatedSeq: number
}>

export type NpcBeliefV2 = Readonly<{
  schemaVersion: 2
  holderNpcId: string
  predicate: 'player-took-item'
  itemId: string
  roomId: string
  confidence: 'low' | 'high'
  warrant: NpcBeliefWarrant
  supportingEventIds: readonly string[]
  lastUpdatedSeq: number
}>

export type NpcBeliefRecord = NpcBeliefV1 | NpcBeliefV2

export function normalizeCommittedBeliefWarrant(input: {
  belief: SerializedBelief
  supportingEventIds: readonly string[]
}): NpcBeliefWarrant {
  // Input must come from a WorldEventSchema-validated npc-action-committed payload.
  if (!('warrant' in input.belief)) {
    return {
      ruleId: 'direct-witness@1',
      premises: [{
        id: 'p1-witnessed-take',
        kind: 'observed',
        observationEventIds: input.supportingEventIds,
        defeasible: false,
      }],
      defeasiblePremiseIds: [],
    }
  }

  return input.belief.warrant
}
