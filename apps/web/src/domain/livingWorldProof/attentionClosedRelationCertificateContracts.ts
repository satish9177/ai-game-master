import { canonicalSerialize, mintHash } from './canonicalSerialization'

export const ATTENTION_CLOSED_RELATION_CERTIFICATE_ACCESSOR_VERSION =
  'attention-closed-relation-certificate-accessor-c2-v1' as const
export const ATTENTION_CLOSED_RELATION_ID = 'admitted_observable_action_aid_v1' as const
export const ATTENTION_CLOSED_RELATION_SEMANTIC_VERSION = '1.0.0' as const
export const ATTENTION_ABSENCE_COMPLETENESS_POLICY_VERSION = 'attention-absence-completeness-policy-c2-v1' as const
export const ATTENTION_ABSENCE_INTERVAL_BOUND_VERSION = 'absence-interval-bound-newest-32-admitted-v1' as const
export const ATTENTION_ABSENCE_INTERVAL_MAX_RECORDS = 32
export const ATTENTION_ABSENCE_COMPLETENESS_POLICY_HASH = mintHash(canonicalSerialize({
  version: ATTENTION_ABSENCE_COMPLETENESS_POLICY_VERSION,
  intervalBoundVersion: ATTENTION_ABSENCE_INTERVAL_BOUND_VERSION,
  newestAdmittedRecords: ATTENTION_ABSENCE_INTERVAL_MAX_RECORDS,
  relation: ATTENTION_CLOSED_RELATION_ID,
}))

export interface AttentionReadableClosedRelationCertificateView {
  readonly certificateContractVersion: typeof ATTENTION_CLOSED_RELATION_CERTIFICATE_ACCESSOR_VERSION
  readonly closedRelationId: typeof ATTENTION_CLOSED_RELATION_ID
  readonly relationSemanticVersion: typeof ATTENTION_CLOSED_RELATION_SEMANTIC_VERSION
  readonly certificateId: string
  readonly snapshotLsn: number
  readonly fromLsn: number
  readonly toLsn: number
  readonly fromWorldTimeTick: number
  readonly toWorldTimeTick: number
  readonly completenessPolicyVersion: typeof ATTENTION_ABSENCE_COMPLETENESS_POLICY_VERSION
  readonly completenessPolicyHash: string
  readonly admittedRecordIds: readonly string[]
  readonly admittedRecordDigest: string
}

function present(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }
function coordinate(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }

export function isStructurallyValidAttentionReadableClosedRelationCertificateView(
  value: unknown,
): value is AttentionReadableClosedRelationCertificateView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const expected = [
    'certificateContractVersion', 'closedRelationId', 'relationSemanticVersion', 'certificateId', 'snapshotLsn',
    'fromLsn', 'toLsn', 'fromWorldTimeTick', 'toWorldTimeTick', 'completenessPolicyVersion',
    'completenessPolicyHash', 'admittedRecordIds', 'admittedRecordDigest',
  ].sort()
  const keys = Object.getOwnPropertyNames(record).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return false
  if (Object.getOwnPropertySymbols(record).length !== 1) return false
  if (
    record.certificateContractVersion !== ATTENTION_CLOSED_RELATION_CERTIFICATE_ACCESSOR_VERSION
    || record.closedRelationId !== ATTENTION_CLOSED_RELATION_ID
    || record.relationSemanticVersion !== ATTENTION_CLOSED_RELATION_SEMANTIC_VERSION
    || record.completenessPolicyVersion !== ATTENTION_ABSENCE_COMPLETENESS_POLICY_VERSION
    || record.completenessPolicyHash !== ATTENTION_ABSENCE_COMPLETENESS_POLICY_HASH
    || !present(record.certificateId) || !present(record.admittedRecordDigest)
    || !coordinate(record.snapshotLsn) || !coordinate(record.fromLsn) || !coordinate(record.toLsn)
    || !coordinate(record.fromWorldTimeTick) || !coordinate(record.toWorldTimeTick)
    || record.fromLsn > record.toLsn || record.fromWorldTimeTick > record.toWorldTimeTick
    || !Array.isArray(record.admittedRecordIds) || record.admittedRecordIds.some((id) => !present(id))
  ) return false
  const ids = record.admittedRecordIds as string[]
  if (ids.length > ATTENTION_ABSENCE_INTERVAL_MAX_RECORDS || new Set(ids).size !== ids.length) return false
  if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) return false
  return record.admittedRecordDigest === mintHash(canonicalSerialize(ids))
}
