import {
  ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
  ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT,
  isStructurallyValidAttentionReadablePatternEvidenceView,
  isStructurallyValidProofPatternEvidenceRecord,
} from './attentionPatternEvidenceContracts'
import type {
  AttentionPatternEvidenceAccessRequest,
  AttentionPatternEvidenceAccessResult,
  AttentionReadablePatternEvidenceView,
  AttentionReadablePatternEvidenceViewFields,
  ProofPatternEvidenceRecord,
  ProofPatternEvidenceSnapshot,
} from './attentionPatternEvidenceContracts'

const ACCESSOR_MINT_MARKER: unique symbol =
  Symbol('attentionReadablePatternEvidenceView.accessorMint')

const ACCESSOR_MINTED_PATTERN_EVIDENCE_VIEWS = new WeakSet<object>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactSnapshotKeys(value: object): boolean {
  const expected = ['evidenceViewContractVersion', 'records']
  const ownNames = Object.getOwnPropertyNames(value)
  if (
    ownNames.length !== expected.length
    || ownNames.some((key) => !expected.includes(key))
    || expected.some((key) => !ownNames.includes(key))
    || ownNames.some((key) => Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true)
    || Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return false
  }
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false
  }
  return true
}

function legalVisibilityProvenanceId(record: ProofPatternEvidenceRecord): string | null {
  const provenance = record.visibilityProvenance
  if (provenance.visibility !== 'public' && provenance.visibility !== 'declassified') return null
  return provenance.provenanceId
}

function isDeeplyImmutableRecord(record: ProofPatternEvidenceRecord): boolean {
  return Object.isFrozen(record) && Object.isFrozen(record.visibilityProvenance)
}

function projectLegalFields(
  record: ProofPatternEvidenceRecord,
  visibilityProvenanceId: string,
): AttentionReadablePatternEvidenceViewFields {
  const common = {
    evidenceViewContractVersion: record.evidenceViewContractVersion,
    recordId: record.recordId,
    commitLsn: record.commitLsn,
    worldTimeTick: record.worldTimeTick,
    visibilityProvenanceId,
  }

  switch (record.recordKind) {
    case 'observable_action':
      switch (record.actionCode) {
        case 'aid':
        case 'reconcile':
          return {
            ...common,
            recordKind: record.recordKind,
            actionCode: record.actionCode,
            actorId: record.actorId,
            targetId: record.targetId,
          }
        case 'harm':
          return {
            ...common,
            recordKind: record.recordKind,
            actionCode: record.actionCode,
            actorId: record.actorId,
            targetId: record.targetId,
            publicSeverityBand: record.publicSeverityBand,
          }
        case 'fulfill_commitment':
          return {
            ...common,
            recordKind: record.recordKind,
            actionCode: record.actionCode,
            actorId: record.actorId,
            targetId: record.targetId,
            commitmentKey: record.commitmentKey,
          }
      }
      throw new Error('attentionPatternEvidenceAccessor: unsupported action code')
    case 'validated_public_communication':
      switch (record.communicationCode) {
        case 'commitment':
          return {
            ...common,
            recordKind: record.recordKind,
            communicationCode: record.communicationCode,
            speakerId: record.speakerId,
            recipientId: record.recipientId,
            commitmentKey: record.commitmentKey,
            publicDeadlineLsn: record.publicDeadlineLsn,
          }
        case 'retract_commitment':
        case 'explicit_refusal':
          return {
            ...common,
            recordKind: record.recordKind,
            communicationCode: record.communicationCode,
            speakerId: record.speakerId,
            recipientId: record.recipientId,
            commitmentKey: record.commitmentKey,
          }
        case 'reconciliation':
          return {
            ...common,
            recordKind: record.recordKind,
            communicationCode: record.communicationCode,
            speakerId: record.speakerId,
            recipientId: record.recipientId,
          }
      }
      throw new Error('attentionPatternEvidenceAccessor: unsupported communication code')
    case 'world_observable_availability':
      return {
        ...common,
        recordKind: record.recordKind,
        availabilityCode: record.availabilityCode,
        entityId: record.entityId,
      }
  }
}

function mintAttentionReadablePatternEvidenceView(
  fields: AttentionReadablePatternEvidenceViewFields,
): AttentionReadablePatternEvidenceView {
  if (!isStructurallyValidAttentionReadablePatternEvidenceView(fields)) {
    throw new Error('attentionPatternEvidenceAccessor: cannot mint structurally invalid evidence')
  }

  const view: Record<PropertyKey, unknown> = { ...fields }
  Object.defineProperty(view, ACCESSOR_MINT_MARKER, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  Object.freeze(view)
  ACCESSOR_MINTED_PATTERN_EVIDENCE_VIEWS.add(view)
  return view as unknown as AttentionReadablePatternEvidenceView
}

/**
 * Read-only runtime authority verifier. It cannot mint, attach the private
 * marker, or add WeakSet membership.
 */
export function isAttentionReadablePatternEvidenceViewFromAccessor(
  value: unknown,
): value is AttentionReadablePatternEvidenceView {
  if (!isRecord(value) || !ACCESSOR_MINTED_PATTERN_EVIDENCE_VIEWS.has(value)) return false
  const descriptor = Object.getOwnPropertyDescriptor(value, ACCESSOR_MINT_MARKER)
  return descriptor?.value === true
    && descriptor.enumerable === false
    && descriptor.writable === false
    && descriptor.configurable === false
}

function compareCanonicalEvidence(
  left: AttentionReadablePatternEvidenceView,
  right: AttentionReadablePatternEvidenceView,
): number {
  if (left.commitLsn < right.commitLsn) return -1
  if (left.commitLsn > right.commitLsn) return 1
  if (left.recordId < right.recordId) return -1
  if (left.recordId > right.recordId) return 1
  return 0
}

/**
 * Sole B1 projection seam. Exact structural validation and legal admission
 * happen before canonical ordering and the newest-32 suffix, so private or
 * unobserved records neither appear nor consume a position.
 */
export function readAttentionReadablePatternEvidenceViews(
  snapshot: ProofPatternEvidenceSnapshot,
  request: AttentionPatternEvidenceAccessRequest,
): AttentionPatternEvidenceAccessResult {
  if (
    typeof request?.evidenceViewContractVersion !== 'string'
    || request.evidenceViewContractVersion.trim().length === 0
  ) {
    return { kind: 'refused', reason: 'missing-evidence-view-contract-version' }
  }
  if (
    !isRecord(snapshot)
    || request.evidenceViewContractVersion !== ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION
    || snapshot.evidenceViewContractVersion !== ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION
    || request.evidenceViewContractVersion !== snapshot.evidenceViewContractVersion
  ) {
    return { kind: 'refused', reason: 'evidence-view-contract-version-mismatch' }
  }
  if (
    !Object.isFrozen(snapshot)
    || !Array.isArray(snapshot.records)
    || !Object.isFrozen(snapshot.records)
    || snapshot.records.some((record) => !isDeeplyImmutableRecord(record))
  ) {
    return { kind: 'refused', reason: 'mutable-pattern-evidence-input' }
  }
  if (
    !hasExactSnapshotKeys(snapshot)
    || snapshot.records.some((record) => !isStructurallyValidProofPatternEvidenceRecord(record))
  ) {
    return { kind: 'refused', reason: 'invalid-pattern-evidence-input' }
  }

  const admitted: AttentionReadablePatternEvidenceView[] = []
  for (const record of snapshot.records) {
    const visibilityProvenanceId = legalVisibilityProvenanceId(record)
    if (visibilityProvenanceId === null) continue
    try {
      admitted.push(mintAttentionReadablePatternEvidenceView(
        projectLegalFields(record, visibilityProvenanceId),
      ))
    } catch {
      return { kind: 'refused', reason: 'invalid-pattern-evidence-input' }
    }
  }

  admitted.sort(compareCanonicalEvidence)
  return {
    kind: 'ok',
    views: Object.freeze(admitted.slice(-ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT)),
  }
}
