import type {
  NpcBeliefWarrant,
  WarrantPremiseId,
} from './beliefVersions'
import type { DefeasibleNpcObservation } from './observationScopeV2'

export type WarrantAbstentionReason =
  | 'no-observations'
  | 'missing-before-premise'
  | 'missing-after-premise'
  | 'ambiguous-candidates'
  | 'no-candidates'

export type DerivedWarrant = Readonly<{
  warrant: NpcBeliefWarrant
  beliefVersion: 1 | 2
  confidence: 'low' | 'high'
  itemId: string
  supportingEventIds: readonly string[]
  lastUpdatedSeq: number
}>

export type DeriveWarrantResult =
  | Readonly<{ status: 'warranted'; derived: DerivedWarrant }>
  | Readonly<{ status: 'abstained'; reason: WarrantAbstentionReason }>

type DeriveWarrantInput = Readonly<{
  observations: readonly DefeasibleNpcObservation[]
  holderNpcId: string
  roomId: string
  itemId: string
}>

type ActorCoPresentObservation = Extract<
  DefeasibleNpcObservation,
  { kind: 'actor-co-present' }
>

function ordered<T extends { sourceSeq: number }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.sourceSeq - right.sourceSeq)
}

function uniqueInOrder(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index)
}

export function deriveWarrant(input: DeriveWarrantInput): DeriveWarrantResult {
  const holderObservations = input.observations.filter(
    (observation) => observation.observerNpcId === input.holderNpcId
      && observation.roomId === input.roomId,
  )
  const directWitnesses = ordered(holderObservations.filter(
    (observation) => observation.kind === 'item-taken-from-room'
      && observation.itemId === input.itemId,
  ))

  if (directWitnesses.length > 0) {
    const supportingEventIds = directWitnesses.map((observation) => observation.sourceEventId)
    const warrant: NpcBeliefWarrant = {
      ruleId: 'direct-witness@1',
      premises: [{
        id: 'p1-witnessed-take',
        kind: 'observed',
        observationEventIds: supportingEventIds,
        defeasible: false,
      }],
      defeasiblePremiseIds: [],
    }
    return {
      status: 'warranted',
      derived: {
        warrant,
        beliefVersion: 1,
        confidence: 'high',
        itemId: input.itemId,
        supportingEventIds,
        lastUpdatedSeq: directWitnesses[directWitnesses.length - 1]!.sourceSeq,
      },
    }
  }

  if (holderObservations.length === 0) {
    return { status: 'abstained', reason: 'no-observations' }
  }

  const reads = ordered(holderObservations.filter(
    (observation) => observation.kind === 'container-state-read',
  ))
  const presentReads = reads.filter((observation) => observation.contents === 'present')
  const before = presentReads[presentReads.length - 1]
  if (before === undefined) {
    return { status: 'abstained', reason: 'missing-before-premise' }
  }

  const absentReads = reads.filter(
    (observation) => observation.containerId === before.containerId
      && observation.contents === 'absent'
      && observation.sourceSeq > before.sourceSeq,
  )
  const after = absentReads[absentReads.length - 1]
  if (after === undefined) {
    return { status: 'abstained', reason: 'missing-after-premise' }
  }

  const candidateSpans = ordered(holderObservations.filter(
    (observation): observation is ActorCoPresentObservation =>
      observation.kind === 'actor-co-present'
      && observation.fromSeq <= before.sourceSeq
      && observation.toSeq >= after.sourceSeq,
  ))
  const candidateActorIds = uniqueInOrder(candidateSpans.map((observation) => observation.actorId))
  if (candidateActorIds.length === 0) {
    return { status: 'abstained', reason: 'no-candidates' }
  }
  if (candidateActorIds.length !== 1) {
    return { status: 'abstained', reason: 'ambiguous-candidates' }
  }

  const candidateEvidence = candidateSpans.filter(
    (observation) => observation.actorId === candidateActorIds[0],
  )
  const supportingEventIds = uniqueInOrder([
    before.sourceEventId,
    after.sourceEventId,
    ...candidateEvidence.map((observation) => observation.sourceEventId),
  ])
  const defeasiblePremiseIds: readonly WarrantPremiseId[] = [
    'p3-sole-candidate',
    'p4-no-alternate-access',
  ]
  const warrant: NpcBeliefWarrant = {
    ruleId: 'sole-copresent-candidate@1',
    premises: [
      {
        id: 'p1-before',
        kind: 'observed',
        observationEventIds: [before.sourceEventId],
        defeasible: false,
      },
      {
        id: 'p2-after',
        kind: 'observed',
        observationEventIds: [after.sourceEventId],
        defeasible: false,
      },
      {
        id: 'p3-sole-candidate',
        kind: 'observed',
        observationEventIds: candidateEvidence.map((observation) => observation.sourceEventId),
        defeasible: true,
      },
      {
        id: 'p4-no-alternate-access',
        kind: 'default',
        observationEventIds: [],
        defeasible: true,
      },
    ],
    defeasiblePremiseIds,
  }

  return {
    status: 'warranted',
    derived: {
      warrant,
      beliefVersion: 2,
      confidence: 'low',
      itemId: input.itemId,
      supportingEventIds,
      lastUpdatedSeq: Math.max(
        before.sourceSeq,
        after.sourceSeq,
        ...candidateEvidence.map((observation) => observation.sourceSeq),
      ),
    },
  }
}
