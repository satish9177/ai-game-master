import {
  ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION,
  isStructurallyValidProofCommunicationAuthorityRecord,
} from './attentionCommunicationAuthorityContracts'
import type {
  AttentionCommunicationAuthorityAccessResult,
  AttentionReadableCommunicationAuthorityView,
  AttentionReadableCommunicationAuthorityViewFields,
  ProofCommunicationAuthorityRecord,
  ProofCommunicationAuthoritySnapshot,
} from './attentionCommunicationAuthorityContracts'

const MARKER: unique symbol = Symbol('attentionCommunicationAuthority.accessorMint')
const MINTED = new WeakSet<object>()

function project(record: ProofCommunicationAuthorityRecord): AttentionReadableCommunicationAuthorityViewFields {
  switch (record.authorityKind) {
    case 'public_knowledge':
      return { authorityContractVersion: record.authorityContractVersion, authorityKind: 'public_knowledge', entityId: record.entityId, commitLsn: record.commitLsn,
        propositionKey: record.propositionKey, groundingRecordId: record.groundingRecordId, visibilityProvenanceId: record.visibilityProvenanceId }
    case 'declassified_knowledge':
      return { authorityContractVersion: record.authorityContractVersion, authorityKind: 'declassified_knowledge', entityId: record.entityId, commitLsn: record.commitLsn,
        propositionKey: record.propositionKey, declassificationRecordId: record.declassificationRecordId }
    case 'communication_authority':
      return { authorityContractVersion: record.authorityContractVersion, authorityKind: 'communication_authority', entityId: record.entityId, commitLsn: record.commitLsn,
        authorityScopeKey: record.authorityScopeKey, grantingRecordId: record.grantingRecordId }
  }
}

function compare(left: AttentionReadableCommunicationAuthorityView, right: AttentionReadableCommunicationAuthorityView): number {
  const kindOrder = { declassified_knowledge: 0, public_knowledge: 1, communication_authority: 2 } as const
  if (kindOrder[left.authorityKind] !== kindOrder[right.authorityKind]) return kindOrder[left.authorityKind] - kindOrder[right.authorityKind]
  if (left.commitLsn !== right.commitLsn) return left.commitLsn - right.commitLsn
  return left.entityId < right.entityId ? -1 : left.entityId > right.entityId ? 1 : 0
}

/** The fifth and sole accessor mint. Private/unobserved and institutional material is never admitted. */
export function readAttentionReadableCommunicationAuthorityViews(
  snapshot: ProofCommunicationAuthoritySnapshot,
  request: { readonly authorityContractVersion: string },
): AttentionCommunicationAuthorityAccessResult {
  if (typeof request?.authorityContractVersion !== 'string' || request.authorityContractVersion.trim().length === 0) return { kind: 'refused', reason: 'missing-communication-authority-contract-version' }
  if (request.authorityContractVersion !== ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION || snapshot?.authorityContractVersion !== ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION) return { kind: 'refused', reason: 'communication-authority-contract-version-mismatch' }
  if (!Object.isFrozen(snapshot) || !Array.isArray(snapshot.records) || !Object.isFrozen(snapshot.records) || snapshot.records.some((record) => !Object.isFrozen(record))) return { kind: 'refused', reason: 'mutable-communication-authority-input' }
  if (Object.getOwnPropertyNames(snapshot).sort().join(',') !== 'authorityContractVersion,records' || Object.getOwnPropertySymbols(snapshot).length !== 0 || snapshot.records.some((record) => !isStructurallyValidProofCommunicationAuthorityRecord(record))) return { kind: 'refused', reason: 'invalid-communication-authority-input' }
  const views: AttentionReadableCommunicationAuthorityView[] = []
  for (const record of snapshot.records) {
    if ((record.visibility !== 'public' && record.visibility !== 'declassified') || record.revealerClass !== 'individual') continue
    const view: Record<PropertyKey, unknown> = project(record)
    Object.defineProperty(view, MARKER, { value: true, enumerable: false, writable: false, configurable: false })
    Object.freeze(view)
    MINTED.add(view)
    views.push(view as AttentionReadableCommunicationAuthorityView)
  }
  views.sort(compare)
  return { kind: 'ok', views: Object.freeze(views) }
}

export function isAttentionReadableCommunicationAuthorityViewFromAccessor(value: unknown): value is AttentionReadableCommunicationAuthorityView {
  return typeof value === 'object' && value !== null && MINTED.has(value)
    && Object.getOwnPropertyDescriptor(value, MARKER)?.value === true
}
