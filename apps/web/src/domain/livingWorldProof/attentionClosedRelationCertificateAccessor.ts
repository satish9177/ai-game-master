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
    || input.snapshotLsn < 0 || input.fromLsn < 0 || input.toLsn < input.fromLsn) {
    return { kind: 'refused', reason: 'absence_window_incomplete' }
  }
  if (!Array.isArray(input.patternEvidenceViews) || input.patternEvidenceViews.length > ATTENTION_ABSENCE_INTERVAL_MAX_RECORDS) {
    return { kind: 'refused', reason: 'absence_relation_not_closed' }
  }
  if (!input.patternEvidenceViews.every(isAttentionReadablePatternEvidenceViewFromAccessor)) {
    return { kind: 'refused', reason: 'absence_completeness_certificate_missing' }
  }
  const admitted = input.patternEvidenceViews.filter(isAid)
    .filter((view) => view.commitLsn >= input.fromLsn && view.commitLsn <= input.toLsn)
    .slice()
    .sort((left, right) => left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0)
  const ids = admitted.map((view) => view.recordId)
  const ticks = admitted.map((view) => view.worldTimeTick)
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
  return { kind: 'ok', certificate: Object.freeze(certificate) }
}

export function isAttentionReadableClosedRelationCertificateFromAccessor(
  value: unknown,
): value is AttentionReadableClosedRelationCertificateView {
  return typeof value === 'object' && value !== null && MINTED.has(value)
    && Object.getOwnPropertyDescriptor(value, MARKER)?.value === true
}
