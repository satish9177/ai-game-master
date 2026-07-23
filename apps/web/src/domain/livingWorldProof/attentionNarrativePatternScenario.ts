/**
 * Stage B / B3 — proof-local fixtures for the deterministic narrative-pattern
 * monitor. Every evidence view is accessor-minted through the B1 seam; the
 * builders never fabricate a view. This module imports no ledger, trace,
 * template, replay, generative-service, or authoritative surface.
 */
import {
  ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
  createProofPatternEvidenceRecord,
  createProofPatternEvidenceSnapshot,
} from './attentionPatternEvidenceContracts'
import type {
  AttentionReadablePatternEvidenceView,
  ProofPatternEvidenceRecordInput,
} from './attentionPatternEvidenceContracts'
import { readAttentionReadablePatternEvidenceViews } from './attentionPatternEvidenceAccessor'
import { reconstructNarrativePatternInstances } from './attentionNarrativePatternMonitor'
import type { NarrativePatternMonitorResult } from './attentionNarrativePatternMonitor'

const REQUEST = Object.freeze({
  evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
})

type SeverityBand = 'minor' | 'moderate' | 'major'

function publicProvenance(recordId: string) {
  return { visibility: 'public', provenanceId: `public-${recordId}` } as const
}

/** Mint one or more accessor views from raw record inputs. */
export function mintPatternEvidenceViews(
  records: readonly ProofPatternEvidenceRecordInput[],
): readonly AttentionReadablePatternEvidenceView[] {
  const built = records.map((record) => createProofPatternEvidenceRecord(record))
  const snapshot = createProofPatternEvidenceSnapshot({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    records: built,
  })
  const result = readAttentionReadablePatternEvidenceViews(snapshot, REQUEST)
  if (result.kind !== 'ok') {
    throw new Error('attentionNarrativePatternScenario: fixture snapshot must be admitted')
  }
  return result.views
}

export function aidRecord(
  recordId: string,
  commitLsn: number,
  actorId: string,
  targetId: string,
): ProofPatternEvidenceRecordInput {
  return {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId,
    commitLsn,
    worldTimeTick: 1000 + commitLsn,
    visibilityProvenance: publicProvenance(recordId),
    recordKind: 'observable_action',
    actionCode: 'aid',
    actorId,
    targetId,
  }
}

export function harmRecord(
  recordId: string,
  commitLsn: number,
  actorId: string,
  targetId: string,
  publicSeverityBand: SeverityBand = 'major',
): ProofPatternEvidenceRecordInput {
  return {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId,
    commitLsn,
    worldTimeTick: 1000 + commitLsn,
    visibilityProvenance: publicProvenance(recordId),
    recordKind: 'observable_action',
    actionCode: 'harm',
    actorId,
    targetId,
    publicSeverityBand,
  }
}

export function reconcileActionRecord(
  recordId: string,
  commitLsn: number,
  actorId: string,
  targetId: string,
): ProofPatternEvidenceRecordInput {
  return {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId,
    commitLsn,
    worldTimeTick: 1000 + commitLsn,
    visibilityProvenance: publicProvenance(recordId),
    recordKind: 'observable_action',
    actionCode: 'reconcile',
    actorId,
    targetId,
  }
}

export function reconcileCommunicationRecord(
  recordId: string,
  commitLsn: number,
  speakerId: string,
  recipientId: string,
): ProofPatternEvidenceRecordInput {
  return {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId,
    commitLsn,
    worldTimeTick: 1000 + commitLsn,
    visibilityProvenance: publicProvenance(recordId),
    recordKind: 'validated_public_communication',
    communicationCode: 'reconciliation',
    speakerId,
    recipientId,
  }
}

export function commitmentRecord(
  recordId: string,
  commitLsn: number,
  speakerId: string,
  recipientId: string,
  commitmentKey: string,
  publicDeadlineLsn: number,
): ProofPatternEvidenceRecordInput {
  return {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId,
    commitLsn,
    worldTimeTick: 1000 + commitLsn,
    visibilityProvenance: publicProvenance(recordId),
    recordKind: 'validated_public_communication',
    communicationCode: 'commitment',
    speakerId,
    recipientId,
    commitmentKey,
    publicDeadlineLsn,
  }
}

export function fulfillmentRecord(
  recordId: string,
  commitLsn: number,
  actorId: string,
  targetId: string,
  commitmentKey: string,
): ProofPatternEvidenceRecordInput {
  return {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId,
    commitLsn,
    worldTimeTick: 1000 + commitLsn,
    visibilityProvenance: publicProvenance(recordId),
    recordKind: 'observable_action',
    actionCode: 'fulfill_commitment',
    actorId,
    targetId,
    commitmentKey,
  }
}

export function retractRecord(
  recordId: string,
  commitLsn: number,
  speakerId: string,
  recipientId: string,
  commitmentKey: string,
  refusal = false,
): ProofPatternEvidenceRecordInput {
  return {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId,
    commitLsn,
    worldTimeTick: 1000 + commitLsn,
    visibilityProvenance: publicProvenance(recordId),
    recordKind: 'validated_public_communication',
    communicationCode: refusal ? 'explicit_refusal' : 'retract_commitment',
    speakerId,
    recipientId,
    commitmentKey,
  }
}

export function availabilityRecord(
  recordId: string,
  commitLsn: number,
  entityId: string,
  availabilityCode: 'dead' | 'departed' = 'departed',
): ProofPatternEvidenceRecordInput {
  return {
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId,
    commitLsn,
    worldTimeTick: 1000 + commitLsn,
    visibilityProvenance: publicProvenance(recordId),
    recordKind: 'world_observable_availability',
    availabilityCode,
    entityId,
  }
}

/** Convenience: mint the records then run the monitor at one snapshot. */
export function runNarrativePatternMonitor(
  records: readonly ProofPatternEvidenceRecordInput[],
  evaluationSnapshotLsn: number,
): NarrativePatternMonitorResult {
  return reconstructNarrativePatternInstances({
    patternEvidenceViews: mintPatternEvidenceViews(records),
    evaluationSnapshotLsn,
  })
}
