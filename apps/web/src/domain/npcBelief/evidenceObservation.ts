import type { WorldEvent } from '../world/events'
import {
  evidencePresentationFor,
  type DefeasibleNpcActionBinding,
  type EvidenceArtifact,
  type UndercuttingEvidenceArtifact,
} from './defeasibleBindings'
import { evaluateDefeat, type BeliefRevision } from './defeatReasoning'
import type { NpcBeliefWarrant } from './beliefVersions'

type EvidencePresentedEvent = Extract<WorldEvent, { type: 'evidence-presented' }>
type EvidenceDiscoveredEvent = Extract<WorldEvent, { type: 'evidence-discovered' }>

export type EvidencePresentationClassification =
  | Readonly<{
      status: 'received'
      presentationEvent: EvidencePresentedEvent
      discoveryEvent: EvidenceDiscoveredEvent
      artifact: EvidenceArtifact
    }>
  | Readonly<{
      status: 'out-of-scope' | 'unknown-evidence' | 'invalid-discovery-provenance'
      presentationEvent: EvidencePresentedEvent
    }>

export type DefeaterReceivedObservation = Readonly<{
  schemaVersion: 1
  observerNpcId: string
  kind: 'defeater-received'
  fidelity: 'full'
  roomId: string
  evidenceId: string
  defeatsRuleId: UndercuttingEvidenceArtifact['defeats']['ruleId']
  defeatsPremiseId: UndercuttingEvidenceArtifact['defeats']['premiseId']
  presentedEventId: string
  discoveredEventId: string
  sourceEventId: string
  sourceSeq: number
  occurredAt: string
}>

export type EvidenceHolderScope = Readonly<{
  npcId: string
  npcRoomId: string
  evidenceArtifacts: readonly EvidenceArtifact[]
}>

export type RetractionEvidenceRefusalReason =
  | 'no-evidence'
  | 'evidence-out-of-scope'
  | 'unknown-evidence-target'
  | 'evidence-provenance-invalid'
  | 'no-defeater'
  | 'defeater-targets-unknown-premise'
  | 'defeater-targets-indefeasible-premise'
  | 'replacement-not-reachable'

export type RetractionEvidenceSelection =
  | Readonly<{
      status: 'selected'
      presentationEvent: EvidencePresentedEvent
      discoveryEvent: EvidenceDiscoveredEvent
      artifact: EvidenceArtifact
      observation: DefeaterReceivedObservation
      revision: Extract<BeliefRevision, { status: 'retracted' }>
    }>
  | Readonly<{
      status: 'refused'
      reason: RetractionEvidenceRefusalReason
    }>

export function evidenceHolderScopeFor(
  binding: DefeasibleNpcActionBinding,
): EvidenceHolderScope {
  return {
    npcId: binding.npcId,
    npcRoomId: binding.roomId,
    evidenceArtifacts: binding.evidenceArtifacts,
  }
}

export function classifyEvidencePresentations(
  log: readonly WorldEvent[],
  scope: EvidenceHolderScope,
): EvidencePresentationClassification[] {
  const discoveries = new Map<string, EvidenceDiscoveredEvent>()
  const classifications: EvidencePresentationClassification[] = []

  for (const event of log) {
    if (event.type === 'evidence-discovered') {
      discoveries.set(event.eventId, event)
      continue
    }
    if (event.type !== 'evidence-presented') continue

    if (event.payload.toNpcId !== scope.npcId || event.payload.roomId !== scope.npcRoomId) {
      classifications.push({ status: 'out-of-scope', presentationEvent: event })
      continue
    }

    const artifacts = scope.evidenceArtifacts.filter(
      (artifact) => artifact.evidenceId === event.payload.evidenceId,
    )
    if (artifacts.length !== 1) {
      classifications.push({ status: 'unknown-evidence', presentationEvent: event })
      continue
    }
    const artifact = artifacts[0]!
    const presentation = evidencePresentationFor(artifact)
    if (
      artifact.roomId !== scope.npcRoomId
      || presentation?.objectId !== event.payload.presentationObjectId
      || presentation.toNpcId !== scope.npcId
    ) {
      classifications.push({ status: 'out-of-scope', presentationEvent: event })
      continue
    }

    const discovery = discoveries.get(event.payload.discoveryEventId)
    if (
      discovery === undefined
      || discovery.seq >= event.seq
      || discovery.payload.evidenceId !== event.payload.evidenceId
      || discovery.payload.roomId !== event.payload.roomId
      || discovery.payload.sourceObjectId !== artifact.sourceObjectId
    ) {
      classifications.push({
        status: 'invalid-discovery-provenance',
        presentationEvent: event,
      })
      continue
    }

    classifications.push({
      status: 'received',
      presentationEvent: event,
      discoveryEvent: discovery,
      artifact,
    })
  }

  return classifications
}

export function deriveDefeaterObservations(
  log: readonly WorldEvent[],
  scope: EvidenceHolderScope,
): DefeaterReceivedObservation[] {
  return classifyEvidencePresentations(log, scope).flatMap((classification) => {
    if (classification.status !== 'received' || classification.artifact.class !== 'undercutting') {
      return []
    }
    const { artifact, discoveryEvent, presentationEvent } = classification
    return [{
      schemaVersion: 1,
      observerNpcId: scope.npcId,
      kind: 'defeater-received',
      fidelity: 'full',
      roomId: scope.npcRoomId,
      evidenceId: artifact.evidenceId,
      defeatsRuleId: artifact.defeats.ruleId,
      defeatsPremiseId: artifact.defeats.premiseId,
      presentedEventId: presentationEvent.eventId,
      discoveredEventId: discoveryEvent.eventId,
      sourceEventId: presentationEvent.eventId,
      sourceSeq: presentationEvent.seq,
      occurredAt: presentationEvent.occurredAt,
    }]
  })
}

export function selectRetractionEvidence(input: Readonly<{
  log: readonly WorldEvent[]
  scope: EvidenceHolderScope
  warrant: NpcBeliefWarrant
}>): RetractionEvidenceSelection {
  const orderedLog = [...input.log].sort(compareEvents)
  const classifications = classifyEvidencePresentations(orderedLog, input.scope)
    .sort(compareClassifications)
  const observations = deriveDefeaterObservations(orderedLog, input.scope)
    .sort(compareDefeaterObservations)

  for (const observation of observations) {
    const received = classifications.find((classification) =>
      classification.status === 'received'
      && classification.presentationEvent.eventId === observation.presentedEventId
      && classification.discoveryEvent.eventId === observation.discoveredEventId
      && classification.artifact.evidenceId === observation.evidenceId
      && classification.artifact.class === 'undercutting'
      && classification.artifact.defeats.ruleId === observation.defeatsRuleId
      && classification.artifact.defeats.premiseId === observation.defeatsPremiseId)
    if (received === undefined || received.status !== 'received') continue

    const revision = evaluateDefeat({ warrant: input.warrant, artifact: received.artifact })
    if (revision.status === 'retracted') {
      return {
        status: 'selected',
        presentationEvent: received.presentationEvent,
        discoveryEvent: received.discoveryEvent,
        artifact: received.artifact,
        observation,
        revision,
      }
    }
  }

  const received = classifications.filter(
    (classification): classification is Extract<
      EvidencePresentationClassification,
      { status: 'received' }
    > => classification.status === 'received',
  )
  for (const classification of received) {
    const revision = evaluateDefeat({ warrant: input.warrant, artifact: classification.artifact })
    if (revision.status === 'replaced') {
      return { status: 'refused', reason: 'replacement-not-reachable' }
    }
    if (revision.status === 'unchanged'
      && revision.reason === 'defeater-targets-unknown-premise') {
      return { status: 'refused', reason: 'defeater-targets-unknown-premise' }
    }
    if (revision.status === 'unchanged'
      && revision.reason === 'defeater-targets-indefeasible-premise') {
      return { status: 'refused', reason: 'defeater-targets-indefeasible-premise' }
    }
  }
  if (received.length > 0) return { status: 'refused', reason: 'no-defeater' }

  const diagnostic = classifications[0]
  if (diagnostic === undefined) return { status: 'refused', reason: 'no-evidence' }
  if (diagnostic.status === 'out-of-scope') {
    return { status: 'refused', reason: 'evidence-out-of-scope' }
  }
  if (diagnostic.status === 'invalid-discovery-provenance') {
    return { status: 'refused', reason: 'evidence-provenance-invalid' }
  }
  return { status: 'refused', reason: 'unknown-evidence-target' }
}

function compareEvents(left: WorldEvent, right: WorldEvent): number {
  return left.seq - right.seq || left.eventId.localeCompare(right.eventId)
}

function compareClassifications(
  left: EvidencePresentationClassification,
  right: EvidencePresentationClassification,
): number {
  return compareEvents(left.presentationEvent, right.presentationEvent)
}

function compareDefeaterObservations(
  left: DefeaterReceivedObservation,
  right: DefeaterReceivedObservation,
): number {
  return left.sourceSeq - right.sourceSeq
    || left.sourceEventId.localeCompare(right.sourceEventId)
}
