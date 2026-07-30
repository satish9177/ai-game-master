/**
 * B5 direct-record assertions.  This proof-local module deliberately accepts
 * only the monitor's already validated advancing assertion inputs; it has no
 * access to raw records, a snapshot, the ledger, or a pattern verdict.
 */
import { canonicalSerialize, mintHash } from './canonicalSerialization'
import { ATTENTION_CANDIDATE_CANONICALIZATION_VERSION } from './attentionCandidatePolicy'
import type { NarrativePatternDirectEvidenceAssertionInput } from './attentionNarrativePatternContracts'
import { canonicalSerialize as canonicalAbsenceSerialize } from './canonicalSerialization'
import { isStructurallyValidAttentionAbsenceWitnessProvenance } from './attentionAbsenceWitnessProvenance'
import type { AttentionAbsenceWitnessProvenance } from './attentionAbsenceWitnessProvenance'

export const ATTENTION_DIRECT_EVIDENCE_ASSERTION_IDENTITY_VERSION =
  'attention-direct-evidence-assertion-identity-v2' as const

export const ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION =
  'attention-pattern-direct-evidence-template-v2' as const

export const ATTENTION_PATTERN_REVEAL_PACKAGE_SCHEMA_VERSION =
  'attention-pattern-reveal-package-v2' as const

export type AttentionDirectEvidenceAssertion =
  | {
      readonly assertionId: string
      readonly assertionKind: 'public_aid'
      readonly sourceRecordId: string
      readonly visibilityProvenanceId: string
      readonly token: 'public aid'
      readonly actorId: string
      readonly targetId: string
    }

  | {
      readonly assertionId: string
      readonly assertionKind: 'public_harm_severity'
      readonly sourceRecordId: string
      readonly visibilityProvenanceId: string
      readonly token: 'public harm severity'
      readonly actorId: string
      readonly targetId: string
      readonly publicSeverityBand: 'minor' | 'moderate' | 'major'
    }
  | {
      readonly assertionId: string
      readonly assertionKind: 'public_commitment'
      readonly sourceRecordId: string
      readonly visibilityProvenanceId: string
      readonly token: 'public commitment'
      readonly speakerId: string
      readonly recipientId: string
      readonly commitmentKey: string
    }
  | {
      readonly assertionId: string
      readonly assertionKind: 'certified_absence'
      readonly token: 'nothing in the admitted public record shows aid between'
      readonly entityA: string
      readonly entityB: string
      readonly relationId: string
      readonly fromLsn: number
      readonly toLsn: number
      readonly provenance: AttentionAbsenceWitnessProvenance
    }
  | {
      readonly assertionId: string
      readonly assertionKind: 'public_fulfillment_record'
      readonly sourceRecordId: string
      readonly visibilityProvenanceId: string
      readonly token: 'public fulfillment record'
      readonly actorId: string
      readonly targetId: string
      readonly commitmentKey: string
    }

export type AttentionPositiveDirectEvidenceAssertion = Exclude<
  AttentionDirectEvidenceAssertion,
  { readonly assertionKind: 'certified_absence' }
>

export type AttentionDirectEvidenceAssertionRefusal =
  | 'empty-assertion-input'
  | 'unsupported-assertion-input'
  | 'missing-direct-evidence-slot'
  | 'duplicate-direct-evidence-source'
  | 'invalid-direct-evidence-field-character'

export type AttentionDirectEvidenceAssertionResult =
  | { readonly kind: 'ok'; readonly assertions: readonly AttentionPositiveDirectEvidenceAssertion[] }
  | { readonly kind: 'refused'; readonly reason: AttentionDirectEvidenceAssertionRefusal }

function isPresent(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * The closed canonical visible-field grammar rule. The pattern template joins
 * rendered lines with a newline and separates fields within a line with a
 * slash, so any player-visible value that contains a slash, a line or
 * paragraph separator, or a C0/C1 control character (including CR and LF)
 * could forge apparent extra assertion lines or fields out of one admitted
 * record. Nothing is stripped, normalized, or escaped: RN019 pins no
 * escaping scheme, so a value containing one of these code points refuses
 * rather than being silently repaired. Forbidden code points are compared
 * numerically, never via a literal character embedded in source, so the
 * forbidden set is exact and auditable.
 */
const FORBIDDEN_VISIBLE_FIELD_CODE_POINTS: readonly number[] = [0x2028, 0x2029]
const SLASH_CODE_POINT = 0x2f

function isForbiddenVisibleFieldCodePoint(codePoint: number): boolean {
  if (codePoint === SLASH_CODE_POINT) return true
  if (FORBIDDEN_VISIBLE_FIELD_CODE_POINTS.includes(codePoint)) return true
  if (codePoint <= 0x1f) return true // C0 controls, including CR (0x0d) and LF (0x0a)
  if (codePoint >= 0x7f && codePoint <= 0x9f) return true // DEL and C1 controls
  return false
}

export function isValidDirectEvidenceFieldValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (isForbiddenVisibleFieldCodePoint(value.charCodeAt(index))) return false
  }
  return true
}

function isValidField(value: unknown): value is string {
  return isPresent(value) && isValidDirectEvidenceFieldValue(value)
}

/**
 * Defense-in-depth: re-validates every rendered field of an already-built
 * assertion. `buildOne` below is the only legitimate constructor and already
 * enforces this, but a forged assertion object (bypassing the builder) must
 * still be caught wherever it is next consumed -- the package builder and the
 * template renderer both call this same function rather than re-deriving the
 * rule.
 */
const NON_RENDERED_ASSERTION_FIELDS: ReadonlySet<string> = new Set([
  'assertionId', 'assertionKind', 'sourceRecordId', 'visibilityProvenanceId', 'token',
])

export function hasValidDirectEvidenceAssertionFields(assertion: AttentionDirectEvidenceAssertion): boolean {
  if (assertion.assertionKind === 'certified_absence') {
    return assertion.token === 'nothing in the admitted public record shows aid between'
      && isStructurallyValidAttentionAbsenceWitnessProvenance(assertion.provenance)
      && assertion.entityA === assertion.provenance.boundEntities[0]
      && assertion.entityB === assertion.provenance.boundEntities[1]
      && assertion.relationId === assertion.provenance.closedRelationId
      && assertion.fromLsn === assertion.provenance.fromLsn && assertion.toLsn === assertion.provenance.toLsn
  }
  for (const [key, value] of Object.entries(assertion)) {
    if (NON_RENDERED_ASSERTION_FIELDS.has(key)) continue
    if (typeof value !== 'string' || !isValidDirectEvidenceFieldValue(value)) return false
  }
  return true
}

export function buildAttentionCertifiedAbsenceAssertion(
  provenance: AttentionAbsenceWitnessProvenance,
): AttentionDirectEvidenceAssertion | AttentionDirectEvidenceAssertionRefusal {
  if (!isStructurallyValidAttentionAbsenceWitnessProvenance(provenance)) return 'unsupported-assertion-input'
  const assertion = {
    assertionKind: 'certified_absence' as const,
    token: 'nothing in the admitted public record shows aid between' as const,
    entityA: provenance.boundEntities[0], entityB: provenance.boundEntities[1],
    relationId: provenance.closedRelationId, fromLsn: provenance.fromLsn, toLsn: provenance.toLsn, provenance,
  }
  return Object.freeze({ ...assertion, assertionId: ATTENTION_DIRECT_EVIDENCE_ASSERTION_IDENTITY_VERSION + ':' + mintHash(canonicalAbsenceSerialize(assertion)) })
}

function assertionId(assertion: Omit<AttentionDirectEvidenceAssertion, 'assertionId'>): string {
  return ATTENTION_DIRECT_EVIDENCE_ASSERTION_IDENTITY_VERSION + ':' + mintHash(canonicalSerialize({
    ...assertion,
    assertionCanonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    assertionIdentityVersion: ATTENTION_DIRECT_EVIDENCE_ASSERTION_IDENTITY_VERSION,
  }))
}

/** Distinguishes a blank/missing field from a present-but-injection-shaped one. */
function fieldRefusal(value: unknown): 'missing-direct-evidence-slot' | 'invalid-direct-evidence-field-character' {
  return isPresent(value) ? 'invalid-direct-evidence-field-character' : 'missing-direct-evidence-slot'
}

function buildOne(
  input: NarrativePatternDirectEvidenceAssertionInput,
): AttentionPositiveDirectEvidenceAssertion | AttentionDirectEvidenceAssertionRefusal {
  if (!isPresent(input.sourceRecordId) || !isPresent(input.visibilityProvenanceId)) {
    return 'missing-direct-evidence-slot'
  }
  switch (input.assertionKind) {
    case 'public_aid': {
      if (!isValidField(input.actorId)) return fieldRefusal(input.actorId)
      if (!isValidField(input.targetId)) return fieldRefusal(input.targetId)
      const assertion = {
        assertionKind: 'public_aid' as const,
        sourceRecordId: input.sourceRecordId,
        visibilityProvenanceId: input.visibilityProvenanceId,
        token: 'public aid' as const,
        actorId: input.actorId,
        targetId: input.targetId,
      }
      return Object.freeze({ ...assertion, assertionId: assertionId(assertion) })
    }
    case 'public_harm_severity': {
      if (!isValidField(input.actorId)) return fieldRefusal(input.actorId)
      if (!isValidField(input.targetId)) return fieldRefusal(input.targetId)
      const assertion = {
        assertionKind: 'public_harm_severity' as const,
        sourceRecordId: input.sourceRecordId,
        visibilityProvenanceId: input.visibilityProvenanceId,
        token: 'public harm severity' as const,
        actorId: input.actorId,
        targetId: input.targetId,
        publicSeverityBand: input.publicSeverityBand,
      }
      return Object.freeze({ ...assertion, assertionId: assertionId(assertion) })
    }
    case 'public_commitment': {
      if (!isValidField(input.speakerId)) return fieldRefusal(input.speakerId)
      if (!isValidField(input.recipientId)) return fieldRefusal(input.recipientId)
      if (!isValidField(input.commitmentKey)) return fieldRefusal(input.commitmentKey)
      const assertion = {
        assertionKind: 'public_commitment' as const,
        sourceRecordId: input.sourceRecordId,
        visibilityProvenanceId: input.visibilityProvenanceId,
        token: 'public commitment' as const,
        speakerId: input.speakerId,
        recipientId: input.recipientId,
        commitmentKey: input.commitmentKey,
      }
      return Object.freeze({ ...assertion, assertionId: assertionId(assertion) })
    }
    case 'public_fulfillment_record': {
      if (!isValidField(input.actorId)) return fieldRefusal(input.actorId)
      if (!isValidField(input.targetId)) return fieldRefusal(input.targetId)
      if (!isValidField(input.commitmentKey)) return fieldRefusal(input.commitmentKey)
      const assertion = {
        assertionKind: 'public_fulfillment_record' as const,
        sourceRecordId: input.sourceRecordId,
        visibilityProvenanceId: input.visibilityProvenanceId,
        token: 'public fulfillment record' as const,
        actorId: input.actorId,
        targetId: input.targetId,
        commitmentKey: input.commitmentKey,
      }
      return Object.freeze({ ...assertion, assertionId: assertionId(assertion) })
    }
    default:
      return 'unsupported-assertion-input'
  }
}

/**
 * Converts the monitor-contract's advancing-record inputs into immutable,
 * one-record assertions.  No sort, merge, subset, or paraphrase occurs here:
 * monitor order is the canonical evidence order and duplicate source identities
 * are a refusal.
 */
export function buildAttentionDirectEvidenceAssertions(
  inputs: readonly NarrativePatternDirectEvidenceAssertionInput[],
): AttentionDirectEvidenceAssertionResult {
  if (inputs.length === 0) return { kind: 'refused', reason: 'empty-assertion-input' }
  const sourceIds = new Set<string>()
  const assertions: AttentionPositiveDirectEvidenceAssertion[] = []
  for (const input of inputs) {
    const assertion = buildOne(input)
    if (typeof assertion === 'string') return { kind: 'refused', reason: assertion }
    if (sourceIds.has(assertion.sourceRecordId)) return { kind: 'refused', reason: 'duplicate-direct-evidence-source' }
    sourceIds.add(assertion.sourceRecordId)
    assertions.push(assertion)
  }
  return { kind: 'ok', assertions: Object.freeze(assertions) }
}
