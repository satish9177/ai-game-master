import {
  ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
  createProofPatternEvidenceRecord,
  createProofPatternEvidenceSnapshot,
} from './attentionPatternEvidenceContracts'
import { readAttentionReadablePatternEvidenceViews } from './attentionPatternEvidenceAccessor'

export const B1_PATTERN_EVIDENCE_REQUEST = Object.freeze({
  evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
})

/** Canonical B1 fixture: all variants plus one hidden record that is excluded. */
export function buildAttentionPatternEvidenceB1Scenario() {
  const aid = createProofPatternEvidenceRecord({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId: 'evidence-action-aid-10',
    commitLsn: 10,
    worldTimeTick: 110,
    visibilityProvenance: { visibility: 'public', provenanceId: 'public-log-10' },
    recordKind: 'observable_action',
    actionCode: 'aid',
    actorId: 'warden',
    targetId: 'merchant',
  })
  const commitment = createProofPatternEvidenceRecord({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId: 'evidence-communication-12',
    commitLsn: 12,
    worldTimeTick: 112,
    visibilityProvenance: { visibility: 'declassified', provenanceId: 'declassification-12' },
    recordKind: 'validated_public_communication',
    communicationCode: 'commitment',
    speakerId: 'merchant',
    recipientId: 'warden',
    commitmentKey: 'repair-gate',
    publicDeadlineLsn: 20,
  })
  const departed = createProofPatternEvidenceRecord({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId: 'evidence-availability-14',
    commitLsn: 14,
    worldTimeTick: 114,
    visibilityProvenance: { visibility: 'public', provenanceId: 'public-log-14' },
    recordKind: 'world_observable_availability',
    availabilityCode: 'departed',
    entityId: 'courier',
  })
  const hidden = createProofPatternEvidenceRecord({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    recordId: 'evidence-hidden-11',
    commitLsn: 11,
    worldTimeTick: 111,
    visibilityProvenance: { visibility: 'private' },
    recordKind: 'observable_action',
    actionCode: 'harm',
    actorId: 'warden',
    targetId: 'merchant',
    publicSeverityBand: 'major',
  })
  const snapshot = createProofPatternEvidenceSnapshot({
    evidenceViewContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    records: [departed, hidden, commitment, aid],
  })
  const result = readAttentionReadablePatternEvidenceViews(snapshot, B1_PATTERN_EVIDENCE_REQUEST)
  if (result.kind !== 'ok') {
    throw new Error('attentionPatternEvidenceScenario: canonical B1 scenario must be admitted')
  }
  return Object.freeze({
    snapshot,
    views: result.views,
    hiddenRecordId: hidden.recordId,
    expectedRecordIds: Object.freeze([aid.recordId, commitment.recordId, departed.recordId]),
  })
}
