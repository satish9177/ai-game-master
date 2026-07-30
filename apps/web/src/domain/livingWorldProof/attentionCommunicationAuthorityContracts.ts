import { canonicalSerialize, mintHash } from './canonicalSerialization'

/** C3's fifth A-prime view family. It contains recorded authority only. */
export const ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION =
  'attention-communication-authority-accessor-c3-v1' as const

export type AttentionAuthorityVisibility = 'public' | 'declassified' | 'private' | 'unobserved'
export type AttentionRevealerClass = 'individual' | 'institution'

interface AuthorityRecordCommon {
  readonly authorityContractVersion: typeof ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION
  readonly visibility: AttentionAuthorityVisibility
  readonly entityId: string
  readonly revealerClass: AttentionRevealerClass
  readonly commitLsn: number
}

export type ProofCommunicationAuthorityRecord =
  | (AuthorityRecordCommon & {
      readonly authorityKind: 'public_knowledge'
      readonly propositionKey: string
      readonly groundingRecordId: string
      readonly visibilityProvenanceId: string
    })
  | (AuthorityRecordCommon & {
      readonly authorityKind: 'declassified_knowledge'
      readonly propositionKey: string
      readonly declassificationRecordId: string
    })
  | (AuthorityRecordCommon & {
      readonly authorityKind: 'communication_authority'
      readonly authorityScopeKey: string
      readonly grantingRecordId: string
    })

export interface ProofCommunicationAuthoritySnapshot {
  readonly authorityContractVersion: typeof ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION
  readonly records: readonly ProofCommunicationAuthorityRecord[]
}

type AuthorityViewCommon = {
  readonly authorityContractVersion: typeof ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION
  readonly entityId: string
  readonly commitLsn: number
}

export type AttentionReadableCommunicationAuthorityViewFields =
  | (AuthorityViewCommon & {
      readonly authorityKind: 'public_knowledge'
      readonly propositionKey: string
      readonly groundingRecordId: string
      readonly visibilityProvenanceId: string
    })
  | (AuthorityViewCommon & {
      readonly authorityKind: 'declassified_knowledge'
      readonly propositionKey: string
      readonly declassificationRecordId: string
    })
  | (AuthorityViewCommon & {
      readonly authorityKind: 'communication_authority'
      readonly authorityScopeKey: string
      readonly grantingRecordId: string
    })

declare const ATTENTION_COMMUNICATION_AUTHORITY_VIEW_BRAND: unique symbol
export type AttentionReadableCommunicationAuthorityView = AttentionReadableCommunicationAuthorityViewFields & {
  readonly [ATTENTION_COMMUNICATION_AUTHORITY_VIEW_BRAND]: true
}

export type AttentionCommunicationAuthorityAccessRefusal =
  | 'missing-communication-authority-contract-version'
  | 'communication-authority-contract-version-mismatch'
  | 'mutable-communication-authority-input'
  | 'invalid-communication-authority-input'

export type AttentionCommunicationAuthorityAccessResult =
  | { readonly kind: 'ok'; readonly views: readonly AttentionReadableCommunicationAuthorityView[] }
  | { readonly kind: 'refused'; readonly reason: AttentionCommunicationAuthorityAccessRefusal }

function present(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function coordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function exactKeys(value: object, expected: readonly string[], symbols: number): boolean {
  const keys = Object.getOwnPropertyNames(value).sort()
  const sorted = [...expected].sort()
  return keys.length === sorted.length
    && keys.every((key, index) => key === sorted[index])
    && Object.getOwnPropertySymbols(value).length === symbols
    && keys.every((key) => Object.getOwnPropertyDescriptor(value, key)?.enumerable === true)
}

export function isStructurallyValidProofCommunicationAuthorityRecord(
  value: unknown,
): value is ProofCommunicationAuthorityRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const common = record.authorityContractVersion === ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION
    && (record.visibility === 'public' || record.visibility === 'declassified' || record.visibility === 'private' || record.visibility === 'unobserved')
    && (record.revealerClass === 'individual' || record.revealerClass === 'institution')
    && present(record.entityId) && coordinate(record.commitLsn)
  if (!common) return false
  if (record.authorityKind === 'public_knowledge') return exactKeys(record, ['authorityContractVersion', 'visibility', 'authorityKind', 'entityId', 'revealerClass', 'propositionKey', 'groundingRecordId', 'visibilityProvenanceId', 'commitLsn'], 0)
    && present(record.propositionKey) && present(record.groundingRecordId) && present(record.visibilityProvenanceId)
  if (record.authorityKind === 'declassified_knowledge') return exactKeys(record, ['authorityContractVersion', 'visibility', 'authorityKind', 'entityId', 'revealerClass', 'propositionKey', 'declassificationRecordId', 'commitLsn'], 0)
    && present(record.propositionKey) && present(record.declassificationRecordId)
  if (record.authorityKind === 'communication_authority') return exactKeys(record, ['authorityContractVersion', 'visibility', 'authorityKind', 'entityId', 'revealerClass', 'authorityScopeKey', 'grantingRecordId', 'commitLsn'], 0)
    && present(record.authorityScopeKey) && present(record.grantingRecordId)
  return false
}

export function isStructurallyValidAttentionReadableCommunicationAuthorityView(
  value: unknown,
): value is AttentionReadableCommunicationAuthorityView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const view = value as Record<string, unknown>
  const common = view.authorityContractVersion === ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION
    && present(view.entityId) && coordinate(view.commitLsn)
  if (!common) return false
  if (view.authorityKind === 'public_knowledge') return exactKeys(view, ['authorityContractVersion', 'authorityKind', 'entityId', 'propositionKey', 'groundingRecordId', 'visibilityProvenanceId', 'commitLsn'], 1)
    && present(view.propositionKey) && present(view.groundingRecordId) && present(view.visibilityProvenanceId)
  if (view.authorityKind === 'declassified_knowledge') return exactKeys(view, ['authorityContractVersion', 'authorityKind', 'entityId', 'propositionKey', 'declassificationRecordId', 'commitLsn'], 1)
    && present(view.propositionKey) && present(view.declassificationRecordId)
  if (view.authorityKind === 'communication_authority') return exactKeys(view, ['authorityContractVersion', 'authorityKind', 'entityId', 'authorityScopeKey', 'grantingRecordId', 'commitLsn'], 1)
    && present(view.authorityScopeKey) && present(view.grantingRecordId)
  return false
}

export const ATTENTION_COMMUNICATION_AUTHORITY_CONTRACT_HASH = mintHash(canonicalSerialize({
  version: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION,
  variants: ['public_knowledge', 'declassified_knowledge', 'communication_authority'],
  admission: ['public', 'declassified'],
}))
