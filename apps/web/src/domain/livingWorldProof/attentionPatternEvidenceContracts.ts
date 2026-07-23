/**
 * B1 proof-local pattern-evidence records and the closed legal A-prime view.
 * These values are semantic proof fixtures, not production WorldEvent or
 * persistence contracts. Runtime accessor authority is owned exclusively by
 * `attentionPatternEvidenceAccessor.ts`.
 */
export const ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION =
  'attention-pattern-evidence-accessor-v1' as const

export const ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT = 32

export type PatternEvidenceVisibilityProvenance =
  | { readonly visibility: 'public' | 'declassified'; readonly provenanceId: string }
  | { readonly visibility: 'private' | 'unobserved' }

type ObservableActionEvidencePayload =
  | {
      readonly actionCode: 'aid'
      readonly actorId: string
      readonly targetId: string
    }
  | {
      readonly actionCode: 'harm'
      readonly actorId: string
      readonly targetId: string
      readonly publicSeverityBand: 'minor' | 'moderate' | 'major'
    }
  | {
      readonly actionCode: 'fulfill_commitment'
      readonly actorId: string
      readonly targetId: string
      readonly commitmentKey: string
    }
  | {
      readonly actionCode: 'reconcile'
      readonly actorId: string
      readonly targetId: string
    }

type ValidatedPublicCommunicationEvidencePayload =
  | {
      readonly communicationCode: 'commitment'
      readonly speakerId: string
      readonly recipientId: string
      readonly commitmentKey: string
      readonly publicDeadlineLsn: number
    }
  | {
      readonly communicationCode: 'retract_commitment' | 'explicit_refusal'
      readonly speakerId: string
      readonly recipientId: string
      readonly commitmentKey: string
    }
  | {
      readonly communicationCode: 'reconciliation'
      readonly speakerId: string
      readonly recipientId: string
    }

type ProofPatternEvidenceRecordCommon = {
  readonly evidenceViewContractVersion: string
  readonly recordId: string
  readonly commitLsn: number
  readonly worldTimeTick: number
  readonly visibilityProvenance: PatternEvidenceVisibilityProvenance
}

export type ProofPatternEvidenceRecord =
  | (ProofPatternEvidenceRecordCommon & {
      readonly recordKind: 'observable_action'
    } & ObservableActionEvidencePayload)
  | (ProofPatternEvidenceRecordCommon & {
      readonly recordKind: 'validated_public_communication'
    } & ValidatedPublicCommunicationEvidencePayload)
  | (ProofPatternEvidenceRecordCommon & {
      readonly recordKind: 'world_observable_availability'
      readonly availabilityCode: 'dead' | 'departed'
      readonly entityId: string
    })

export type ProofPatternEvidenceRecordInput = ProofPatternEvidenceRecord

export interface ProofPatternEvidenceSnapshot {
  readonly evidenceViewContractVersion: string
  readonly records: readonly ProofPatternEvidenceRecord[]
}

export interface ProofPatternEvidenceSnapshotInput {
  readonly evidenceViewContractVersion: string
  readonly records: readonly ProofPatternEvidenceRecord[]
}

interface AttentionReadablePatternEvidenceViewCommon {
  readonly evidenceViewContractVersion: string
  readonly recordId: string
  readonly commitLsn: number
  readonly worldTimeTick: number
  readonly visibilityProvenanceId: string
}

export type ObservableActionEvidenceViewFields =
  AttentionReadablePatternEvidenceViewCommon
  & { readonly recordKind: 'observable_action' }
  & ObservableActionEvidencePayload

export type ValidatedPublicCommunicationEvidenceViewFields =
  AttentionReadablePatternEvidenceViewCommon
  & { readonly recordKind: 'validated_public_communication' }
  & ValidatedPublicCommunicationEvidencePayload

export type WorldObservableAvailabilityEvidenceViewFields =
  AttentionReadablePatternEvidenceViewCommon
  & {
      readonly recordKind: 'world_observable_availability'
      readonly availabilityCode: 'dead' | 'departed'
      readonly entityId: string
    }

export type AttentionReadablePatternEvidenceViewFields =
  | ObservableActionEvidenceViewFields
  | ValidatedPublicCommunicationEvidenceViewFields
  | WorldObservableAvailabilityEvidenceViewFields

/**
 * Compile-time nominal brand only. It has no runtime value and grants no
 * authority. Runtime authority is the accessor-private WeakSet membership.
 */
declare const ATTENTION_PATTERN_EVIDENCE_VIEW_TYPE_BRAND: unique symbol

export type AttentionReadablePatternEvidenceView =
  AttentionReadablePatternEvidenceViewFields
  & { readonly [ATTENTION_PATTERN_EVIDENCE_VIEW_TYPE_BRAND]: true }

export interface AttentionPatternEvidenceAccessRequest {
  readonly evidenceViewContractVersion: string
}

export type AttentionPatternEvidenceAccessRefusal =
  | 'missing-evidence-view-contract-version'
  | 'evidence-view-contract-version-mismatch'
  | 'mutable-pattern-evidence-input'
  | 'invalid-pattern-evidence-input'

export type AttentionPatternEvidenceAccessResult =
  | { readonly kind: 'ok'; readonly views: readonly AttentionReadablePatternEvidenceView[] }
  | { readonly kind: 'refused'; readonly reason: AttentionPatternEvidenceAccessRefusal }

const ACTION_CODES = Object.freeze(['aid', 'harm', 'fulfill_commitment', 'reconcile'] as const)
const COMMUNICATION_CODES = Object.freeze([
  'commitment',
  'retract_commitment',
  'explicit_refusal',
  'reconciliation',
] as const)
const AVAILABILITY_CODES = Object.freeze(['dead', 'departed'] as const)
const SEVERITY_BANDS = Object.freeze(['minor', 'moderate', 'major'] as const)

const SOURCE_COMMON_KEYS = Object.freeze([
  'evidenceViewContractVersion',
  'recordId',
  'commitLsn',
  'worldTimeTick',
  'visibilityProvenance',
  'recordKind',
])

const VIEW_COMMON_KEYS = Object.freeze([
  'evidenceViewContractVersion',
  'recordId',
  'commitLsn',
  'worldTimeTick',
  'visibilityProvenanceId',
  'recordKind',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function hasExactOwnEnumerableStringKeys(
  value: object,
  expectedKeys: readonly string[],
  allowInternalNonEnumerableSymbols: boolean,
): boolean {
  const ownNames = Object.getOwnPropertyNames(value)
  if (
    ownNames.length !== expectedKeys.length
    || ownNames.some((key) => !expectedKeys.includes(key))
    || expectedKeys.some((key) => !ownNames.includes(key))
    || ownNames.some((key) => Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true)
  ) {
    return false
  }

  const symbols = Object.getOwnPropertySymbols(value)
  if (
    (!allowInternalNonEnumerableSymbols && symbols.length !== 0)
    || (
      allowInternalNonEnumerableSymbols
      && symbols.some((symbol) => Object.getOwnPropertyDescriptor(value, symbol)?.enumerable !== false)
    )
  ) {
    return false
  }

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false
  }
  return true
}

function hasValidVisibilityProvenance(value: unknown): value is PatternEvidenceVisibilityProvenance {
  if (!isRecord(value)) return false
  if (value.visibility === 'public' || value.visibility === 'declassified') {
    return hasExactOwnEnumerableStringKeys(value, ['visibility', 'provenanceId'], false)
      && isNonEmptyString(value.provenanceId)
  }
  if (value.visibility === 'private' || value.visibility === 'unobserved') {
    return hasExactOwnEnumerableStringKeys(value, ['visibility'], false)
  }
  return false
}

function hasValidCommonSourceFields(value: Record<string, unknown>): boolean {
  return value.evidenceViewContractVersion === ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION
    && isNonEmptyString(value.recordId)
    && isCoordinate(value.commitLsn)
    && isCoordinate(value.worldTimeTick)
    && hasValidVisibilityProvenance(value.visibilityProvenance)
}

function hasValidCommonViewFields(value: Record<string, unknown>): boolean {
  return value.evidenceViewContractVersion === ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION
    && isNonEmptyString(value.recordId)
    && isCoordinate(value.commitLsn)
    && isCoordinate(value.worldTimeTick)
    && isNonEmptyString(value.visibilityProvenanceId)
}

function hasValidActionSemantics(
  value: Record<string, unknown>,
  commonKeys: readonly string[],
  allowInternalNonEnumerableSymbols: boolean,
): boolean {
  if (!ACTION_CODES.includes(value.actionCode as never)) return false
  if (!isNonEmptyString(value.actorId) || !isNonEmptyString(value.targetId)) return false

  switch (value.actionCode) {
    case 'aid':
    case 'reconcile':
      return hasExactOwnEnumerableStringKeys(
        value,
        [...commonKeys, 'actionCode', 'actorId', 'targetId'],
        allowInternalNonEnumerableSymbols,
      )
    case 'harm':
      return hasExactOwnEnumerableStringKeys(
        value,
        [...commonKeys, 'actionCode', 'actorId', 'targetId', 'publicSeverityBand'],
        allowInternalNonEnumerableSymbols,
      ) && SEVERITY_BANDS.includes(value.publicSeverityBand as never)
    case 'fulfill_commitment':
      return hasExactOwnEnumerableStringKeys(
        value,
        [...commonKeys, 'actionCode', 'actorId', 'targetId', 'commitmentKey'],
        allowInternalNonEnumerableSymbols,
      ) && isNonEmptyString(value.commitmentKey)
    default:
      return false
  }
}

function hasValidCommunicationSemantics(
  value: Record<string, unknown>,
  commonKeys: readonly string[],
  allowInternalNonEnumerableSymbols: boolean,
): boolean {
  if (!COMMUNICATION_CODES.includes(value.communicationCode as never)) return false
  if (!isNonEmptyString(value.speakerId) || !isNonEmptyString(value.recipientId)) return false

  switch (value.communicationCode) {
    case 'commitment':
      return hasExactOwnEnumerableStringKeys(
        value,
        [
          ...commonKeys,
          'communicationCode',
          'speakerId',
          'recipientId',
          'commitmentKey',
          'publicDeadlineLsn',
        ],
        allowInternalNonEnumerableSymbols,
      )
        && isNonEmptyString(value.commitmentKey)
        && isCoordinate(value.publicDeadlineLsn)
        && value.publicDeadlineLsn >= Number(value.commitLsn)
    case 'retract_commitment':
    case 'explicit_refusal':
      return hasExactOwnEnumerableStringKeys(
        value,
        [...commonKeys, 'communicationCode', 'speakerId', 'recipientId', 'commitmentKey'],
        allowInternalNonEnumerableSymbols,
      ) && isNonEmptyString(value.commitmentKey)
    case 'reconciliation':
      return hasExactOwnEnumerableStringKeys(
        value,
        [...commonKeys, 'communicationCode', 'speakerId', 'recipientId'],
        allowInternalNonEnumerableSymbols,
      )
    default:
      return false
  }
}

export function isStructurallyValidProofPatternEvidenceRecord(
  value: unknown,
): value is ProofPatternEvidenceRecord {
  if (!isRecord(value) || !hasValidCommonSourceFields(value)) return false

  switch (value.recordKind) {
    case 'observable_action':
      return hasValidActionSemantics(value, SOURCE_COMMON_KEYS, false)
    case 'validated_public_communication':
      return hasValidCommunicationSemantics(value, SOURCE_COMMON_KEYS, false)
    case 'world_observable_availability':
      return hasExactOwnEnumerableStringKeys(
        value,
        [...SOURCE_COMMON_KEYS, 'availabilityCode', 'entityId'],
        false,
      )
        && AVAILABILITY_CODES.includes(value.availabilityCode as never)
        && isNonEmptyString(value.entityId)
    default:
      return false
  }
}

export function isStructurallyValidAttentionReadablePatternEvidenceView(
  value: unknown,
): value is AttentionReadablePatternEvidenceViewFields {
  if (!isRecord(value) || !hasValidCommonViewFields(value)) return false

  switch (value.recordKind) {
    case 'observable_action':
      return hasValidActionSemantics(value, VIEW_COMMON_KEYS, true)
    case 'validated_public_communication':
      return hasValidCommunicationSemantics(value, VIEW_COMMON_KEYS, true)
    case 'world_observable_availability':
      return hasExactOwnEnumerableStringKeys(
        value,
        [...VIEW_COMMON_KEYS, 'availabilityCode', 'entityId'],
        true,
      )
        && AVAILABILITY_CODES.includes(value.availabilityCode as never)
        && isNonEmptyString(value.entityId)
    default:
      return false
  }
}

export function createProofPatternEvidenceRecord(
  input: ProofPatternEvidenceRecordInput,
): ProofPatternEvidenceRecord {
  if (!isStructurallyValidProofPatternEvidenceRecord(input)) {
    throw new Error('attentionPatternEvidenceContracts: invalid or unsupported pattern evidence record')
  }

  const visibilityProvenance = Object.freeze({ ...input.visibilityProvenance })
  return Object.freeze({
    ...input,
    visibilityProvenance,
  }) as ProofPatternEvidenceRecord
}

export function createProofPatternEvidenceSnapshot(
  input: ProofPatternEvidenceSnapshotInput,
): ProofPatternEvidenceSnapshot {
  if (
    !isRecord(input)
    || !hasExactOwnEnumerableStringKeys(
      input,
      ['evidenceViewContractVersion', 'records'],
      false,
    )
    || input.evidenceViewContractVersion !== ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION
    || !Array.isArray(input.records)
    || input.records.some((record) => (
      !Object.isFrozen(record)
      || !Object.isFrozen(record.visibilityProvenance)
      || !isStructurallyValidProofPatternEvidenceRecord(record)
    ))
  ) {
    throw new Error('attentionPatternEvidenceContracts: snapshot requires exact immutable proof records')
  }

  return Object.freeze({
    evidenceViewContractVersion: input.evidenceViewContractVersion,
    records: Object.freeze([...input.records]),
  })
}
