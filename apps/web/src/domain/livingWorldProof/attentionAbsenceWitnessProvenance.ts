import { canonicalSerialize, mintHash } from './canonicalSerialization'
import {
  ATTENTION_ABSENCE_COMPLETENESS_POLICY_HASH,
  ATTENTION_ABSENCE_COMPLETENESS_POLICY_VERSION,
  ATTENTION_CLOSED_RELATION_ID,
  ATTENTION_CLOSED_RELATION_SEMANTIC_VERSION,
  isStructurallyValidAttentionReadableClosedRelationCertificateView,
} from './attentionClosedRelationCertificateContracts'
import type { AttentionReadableClosedRelationCertificateView } from './attentionClosedRelationCertificateContracts'
import {
  isAttentionReadableClosedRelationCertificateFromAccessor,
  readAttentionCertifiedClosedRelationRecords,
} from './attentionClosedRelationCertificateAccessor'
import { NO_RECORDED_PUBLIC_AID_BETWEEN_V1 } from './attentionAbsencePredicateLibrary'

export type AbsenceWitnessPolicyRef = 'absence-witness-disabled-v0' | 'absence-witness-c2-v1'
export type AttentionAbsenceWitnessRefusal =
  | 'absence_match_exists'
  | 'absence_relation_not_closed'
  | 'absence_window_incomplete'
  | 'absence_completeness_certificate_missing'
  | 'absence_certificate_not_structural'

export interface AttentionAbsenceWitnessProvenance {
  readonly kind: 'absence_witness'
  readonly predicateId: string
  readonly predicateSemanticVersion: string
  readonly predicateContentHash: string
  readonly boundEntities: readonly [string, string]
  readonly closedRelationId: typeof ATTENTION_CLOSED_RELATION_ID
  readonly relationSemanticVersion: typeof ATTENTION_CLOSED_RELATION_SEMANTIC_VERSION
  readonly certificateId: string
  readonly admittedRecordDigest: string
  readonly snapshotLsn: number
  readonly fromLsn: number
  readonly toLsn: number
  readonly fromWorldTimeTick: number
  readonly toWorldTimeTick: number
  readonly completenessPolicyVersion: typeof ATTENTION_ABSENCE_COMPLETENESS_POLICY_VERSION
  readonly completenessPolicyHash: string
  readonly result: 'no-matching-record'
}

export type AttentionAbsenceWitnessBuildResult =
  | { readonly kind: 'ok'; readonly provenance: AttentionAbsenceWitnessProvenance; readonly canonicalBytes: string }
  | { readonly kind: 'refused'; readonly reason: AttentionAbsenceWitnessRefusal }

function present(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function coordinate(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function exact(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(); const sorted = [...expected].sort()
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index])
}

export function buildAttentionAbsenceWitnessProvenance(input: {
  readonly policyRef: AbsenceWitnessPolicyRef
  readonly certificate: AttentionReadableClosedRelationCertificateView | undefined
  readonly entityA: string
  readonly entityB: string
}): AttentionAbsenceWitnessBuildResult {
  if (input.policyRef !== 'absence-witness-c2-v1') return { kind: 'refused', reason: 'absence_completeness_certificate_missing' }
  if (input.certificate === undefined) return { kind: 'refused', reason: 'absence_completeness_certificate_missing' }
  const certificate = input.certificate
  if (!isStructurallyValidAttentionReadableClosedRelationCertificateView(certificate)) {
    return { kind: 'refused', reason: 'absence_certificate_not_structural' }
  }
  if (!isAttentionReadableClosedRelationCertificateFromAccessor(certificate)) {
    return { kind: 'refused', reason: 'absence_certificate_not_structural' }
  }
  if (!present(input.entityA) || !present(input.entityB) || input.entityA === input.entityB) {
    return { kind: 'refused', reason: 'absence_certificate_not_structural' }
  }
  const boundEntities = input.entityA < input.entityB ? [input.entityA, input.entityB] as const : [input.entityB, input.entityA] as const
  if (certificate.closedRelationId !== ATTENTION_CLOSED_RELATION_ID
    || certificate.relationSemanticVersion !== ATTENTION_CLOSED_RELATION_SEMANTIC_VERSION) {
    return { kind: 'refused', reason: 'absence_relation_not_closed' }
  }
  if (certificate.completenessPolicyHash !== ATTENTION_ABSENCE_COMPLETENESS_POLICY_HASH) {
    return { kind: 'refused', reason: 'absence_completeness_certificate_missing' }
  }
  const admitted = readAttentionCertifiedClosedRelationRecords(certificate)
  if (admitted === undefined) return { kind: 'refused', reason: 'absence_certificate_not_structural' }
  const actualIds = admitted.map((view) => view.recordId).slice().sort()
  if (canonicalSerialize(actualIds) !== canonicalSerialize(certificate.admittedRecordIds)
    || mintHash(canonicalSerialize(actualIds)) !== certificate.admittedRecordDigest) {
    return { kind: 'refused', reason: 'absence_certificate_not_structural' }
  }
  const matching = admitted.some((view) => (
    view.recordKind === 'observable_action'
    && view.actionCode === 'aid'
    && view.commitLsn >= certificate.fromLsn
    && view.commitLsn <= certificate.toLsn
    && ((view.actorId === boundEntities[0] && view.targetId === boundEntities[1])
      || (view.actorId === boundEntities[1] && view.targetId === boundEntities[0]))
  ))
  if (matching) return { kind: 'refused', reason: 'absence_match_exists' }
  const predicateContentHash = mintHash(canonicalSerialize(NO_RECORDED_PUBLIC_AID_BETWEEN_V1))
  const provenance: AttentionAbsenceWitnessProvenance = Object.freeze({
    kind: 'absence_witness', predicateId: NO_RECORDED_PUBLIC_AID_BETWEEN_V1.predicateId,
    predicateSemanticVersion: NO_RECORDED_PUBLIC_AID_BETWEEN_V1.semanticVersion, predicateContentHash,
    boundEntities, closedRelationId: certificate.closedRelationId,
    relationSemanticVersion: certificate.relationSemanticVersion, certificateId: certificate.certificateId,
    admittedRecordDigest: certificate.admittedRecordDigest, snapshotLsn: certificate.snapshotLsn,
    fromLsn: certificate.fromLsn, toLsn: certificate.toLsn,
    fromWorldTimeTick: certificate.fromWorldTimeTick, toWorldTimeTick: certificate.toWorldTimeTick,
    completenessPolicyVersion: certificate.completenessPolicyVersion,
    completenessPolicyHash: certificate.completenessPolicyHash, result: 'no-matching-record',
  })
  return { kind: 'ok', provenance, canonicalBytes: canonicalSerialize(provenance) }
}

export function isStructurallyValidAttentionAbsenceWitnessProvenance(value: unknown): value is AttentionAbsenceWitnessProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!exact(record, ['kind', 'predicateId', 'predicateSemanticVersion', 'predicateContentHash', 'boundEntities', 'closedRelationId', 'relationSemanticVersion', 'certificateId', 'admittedRecordDigest', 'snapshotLsn', 'fromLsn', 'toLsn', 'fromWorldTimeTick', 'toWorldTimeTick', 'completenessPolicyVersion', 'completenessPolicyHash', 'result'])) return false
  return record.kind === 'absence_witness' && record.predicateId === NO_RECORDED_PUBLIC_AID_BETWEEN_V1.predicateId
    && record.predicateSemanticVersion === NO_RECORDED_PUBLIC_AID_BETWEEN_V1.semanticVersion
    && record.predicateContentHash === mintHash(canonicalSerialize(NO_RECORDED_PUBLIC_AID_BETWEEN_V1))
    && Array.isArray(record.boundEntities) && record.boundEntities.length === 2 && present(record.boundEntities[0]) && present(record.boundEntities[1]) && record.boundEntities[0] < record.boundEntities[1]
    && record.closedRelationId === ATTENTION_CLOSED_RELATION_ID && record.relationSemanticVersion === ATTENTION_CLOSED_RELATION_SEMANTIC_VERSION
    && present(record.certificateId) && present(record.admittedRecordDigest)
    && [record.snapshotLsn, record.fromLsn, record.toLsn, record.fromWorldTimeTick, record.toWorldTimeTick].every(coordinate)
    && (record.fromLsn as number) <= (record.toLsn as number) && (record.fromWorldTimeTick as number) <= (record.toWorldTimeTick as number)
    && record.completenessPolicyVersion === ATTENTION_ABSENCE_COMPLETENESS_POLICY_VERSION
    && record.completenessPolicyHash === ATTENTION_ABSENCE_COMPLETENESS_POLICY_HASH && record.result === 'no-matching-record'
}
