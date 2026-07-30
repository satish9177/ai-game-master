import { canonicalSerialize, mintHash } from './canonicalSerialization'
import {
  ATTENTION_ABSENCE_COMPLETENESS_POLICY_HASH,
  ATTENTION_ABSENCE_COMPLETENESS_POLICY_VERSION,
  ATTENTION_ABSENCE_INTERVAL_MAX_RECORDS,
  ATTENTION_CLOSED_RELATION_CERTIFICATE_ACCESSOR_VERSION,
  ATTENTION_CLOSED_RELATION_ID,
  ATTENTION_CLOSED_RELATION_SEMANTIC_VERSION,
} from './attentionClosedRelationCertificateContracts'
import type { AttentionReadableClosedRelationCertificateView } from './attentionClosedRelationCertificateContracts'
import type { AttentionReadablePatternEvidenceView } from './attentionPatternEvidenceContracts'
import { isAttentionReadablePatternEvidenceViewFromAccessor } from './attentionPatternEvidenceAccessor'

const MARKER: unique symbol = Symbol('attentionClosedRelationCertificate.accessorMint')
const MINTED = new WeakSet<object>()
/**
 * The certificate exposes identities only.  The matching predicate is evaluated
 * through this accessor-owned resource, never from a caller claim or an ambient
 * store read.
 */
const CERTIFIED_ADMITTED_RECORDS = new WeakMap<object, readonly AttentionReadablePatternEvidenceView[]>()

export type AttentionClosedRelationCertificateRefusal =
  | 'absence_relation_not_closed'
  | 'absence_window_incomplete'
  | 'absence_completeness_certificate_missing'

export type AttentionClosedRelationCertificateResult =
  | { readonly kind: 'ok'; readonly certificate: AttentionReadableClosedRelationCertificateView }
  | { readonly kind: 'refused'; readonly reason: AttentionClosedRelationCertificateRefusal }

function isAid(view: AttentionReadablePatternEvidenceView): view is Extract<AttentionReadablePatternEvidenceView, { readonly recordKind: 'observable_action'; readonly actionCode: 'aid' }> {
  return view.recordKind === 'observable_action' && view.actionCode === 'aid'
}

/** The fourth and sole accessor mint. It sees only already-admitted A-prime evidence. */
export function readAttentionReadableClosedRelationCertificate(input: {
  readonly snapshotLsn: number
  readonly fromLsn: number
  readonly toLsn: number
  readonly patternEvidenceViews: readonly AttentionReadablePatternEvidenceView[]
}): AttentionClosedRelationCertificateResult {
  if (!Number.isSafeInteger(input.snapshotLsn) || !Number.isSafeInteger(input.fromLsn) || !Number.isSafeInteger(input.toLsn)
    || input.snapshotLsn < 0 || input.fromLsn < 0 || input.toLsn < input.fromLsn || input.toLsn > input.snapshotLsn) {
    return { kind: 'refused', reason: 'absence_window_incomplete' }
  }
  if (!Array.isArray(input.patternEvidenceViews)) {
    return { kind: 'refused', reason: 'absence_relation_not_closed' }
  }
  if (!input.patternEvidenceViews.every(isAttentionReadablePatternEvidenceViewFromAccessor)) {
    return { kind: 'refused', reason: 'absence_completeness_certificate_missing' }
  }
  const completeAdmitted = input.patternEvidenceViews.slice()
    .sort((left, right) => left.commitLsn - right.commitLsn || (left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0))
  if (new Set(completeAdmitted.map((view) => view.recordId)).size !== completeAdmitted.length
    || completeAdmitted.some((view) => view.commitLsn > input.snapshotLsn)) {
    return { kind: 'refused', reason: 'absence_relation_not_closed' }
  }
  const dropped = completeAdmitted.slice(0, Math.max(0, completeAdmitted.length - ATTENTION_ABSENCE_INTERVAL_MAX_RECORDS))
  // A requested interval that reaches any discarded predecessor is not fully
  // enumerable under the fixed newest-32 admission policy.
  if (dropped.some((view) => view.commitLsn >= input.fromLsn)) {
    return { kind: 'refused', reason: 'absence_window_incomplete' }
  }
  const admittedWindow = completeAdmitted.slice(-ATTENTION_ABSENCE_INTERVAL_MAX_RECORDS)
  // Pattern A-prime inputs may already be the accessor's newest-32 suffix.  If
  // that full suffix begins after the requested lower bound, the omitted prefix
  // is unknowable here and absence must not be inferred from its nonappearance.
  if (admittedWindow.length === ATTENTION_ABSENCE_INTERVAL_MAX_RECORDS
    && admittedWindow[0]!.commitLsn > input.fromLsn) {
    return { kind: 'refused', reason: 'absence_window_incomplete' }
  }
  const admitted = admittedWindow.filter(isAid)
    .filter((view) => view.commitLsn >= input.fromLsn && view.commitLsn <= input.toLsn)
    .slice()
    .sort((left, right) => left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0)
  const ids = admitted.map((view) => view.recordId)
  const ticks = admittedWindow
    .filter((view) => view.commitLsn >= input.fromLsn && view.commitLsn <= input.toLsn)
    .map((view) => view.worldTimeTick)
  const admittedRecordDigest = mintHash(canonicalSerialize(ids))
  const fields = {
    certificateContractVersion: ATTENTION_CLOSED_RELATION_CERTIFICATE_ACCESSOR_VERSION,
    closedRelationId: ATTENTION_CLOSED_RELATION_ID,
    relationSemanticVersion: ATTENTION_CLOSED_RELATION_SEMANTIC_VERSION,
    snapshotLsn: input.snapshotLsn,
    fromLsn: input.fromLsn,
    toLsn: input.toLsn,
    fromWorldTimeTick: ticks.length === 0 ? input.fromLsn : Math.min(...ticks),
    toWorldTimeTick: ticks.length === 0 ? input.toLsn : Math.max(...ticks),
    completenessPolicyVersion: ATTENTION_ABSENCE_COMPLETENESS_POLICY_VERSION,
    completenessPolicyHash: ATTENTION_ABSENCE_COMPLETENESS_POLICY_HASH,
    admittedRecordIds: Object.freeze(ids),
    admittedRecordDigest,
  }
  const certificateId = 'attention-closed-relation-certificate-c2-v1:' + mintHash(canonicalSerialize(fields))
  const certificate = { ...fields, certificateId } as AttentionReadableClosedRelationCertificateView
  Object.defineProperty(certificate, MARKER, { value: true, enumerable: false })
  MINTED.add(certificate)
  CERTIFIED_ADMITTED_RECORDS.set(certificate, Object.freeze(admitted))
  return { kind: 'ok', certificate: Object.freeze(certificate) }
}

export function isAttentionReadableClosedRelationCertificateFromAccessor(
  value: unknown,
): value is AttentionReadableClosedRelationCertificateView {
  return typeof value === 'object' && value !== null && MINTED.has(value)
    && Object.getOwnPropertyDescriptor(value, MARKER)?.value === true
}

/**
 * Read the complete, already-admitted relation members named by a certificate.
 * This resource seam deliberately returns `undefined` for every copied,
 * forged, malformed, or foreign certificate.
 */
export function readAttentionCertifiedClosedRelationRecords(
  certificate: AttentionReadableClosedRelationCertificateView,
): readonly AttentionReadablePatternEvidenceView[] | undefined {
  if (!isAttentionReadableClosedRelationCertificateFromAccessor(certificate)) return undefined
  return CERTIFIED_ADMITTED_RECORDS.get(certificate)
}
