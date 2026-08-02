import type { WorldEvent } from '../world/events'
import {
  evidencePresentationFor,
  type DefeasibleNpcActionBinding,
  type EvidenceArtifact,
  type UndercuttingEvidenceArtifact,
} from './defeasibleBindings'

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
