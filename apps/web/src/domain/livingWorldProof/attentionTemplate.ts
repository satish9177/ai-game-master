/**
 * Stage A / A4 — the deterministic extradiegetic template: the finite, versioned,
 * mechanical mapping from an approved reveal package to presented output.
 * Proof-local to `domain/livingWorldProof`; not a production module, reducer,
 * event, persistence contract, or UI component.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D18 "deterministic templates or direct structured rendering of its
 *    assertions — a mechanical, versioned mapping", D10 extradiegetic channel
 *    "NPC perception cannot consume this output", D8 `reveal_scope`, not the
 *    prose, is the approved artifact);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§26 "Template and phrasing isolation", T1-T7; §13 D4 byte-identical cold
 *    replay with zero calls);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§7 A4 "Rendering uses a finite template; unsupported legal fields are
 *    omitted in a fixed slot order"; §9 A4 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * **The whole renderer is the frozen label table below plus a join.** There is no
 * phrasing stage, no free text, no grammar, no selection among alternatives, no
 * network seam, and no injected renderer — nothing exists here that a call to any
 * outside service could be threaded through. D18 defers unrestricted phrasing
 * beyond v0 and fixes deterministic rendering as "the v0 default and the only
 * accepted v0 behavior"; `attentionZeroModelProbe.ts` carries the paired
 * zero-call evidence for a cold run of the whole Stage A path.
 *
 * **Rendering adds nothing** (replay spec T2). Every content token in the output
 * is a value the approved package already carried; the only other tokens are the
 * pinned template version and the pinned labels in the table below. A legally
 * absent field contributed no slot at the package boundary, so it contributes no
 * label, no placeholder, and no sentence here — absence stays absence rather than
 * becoming invented prose.
 *
 * Determinism rules honoured here, and asserted in `attentionTemplate.test.ts`:
 *
 *  - the pinned template version is the output's first line *and* is folded into
 *    the output identity, so two template versions can never render byte-
 *    identically and an identity can never be reinterpreted under another version;
 *  - slots render strictly in the package's pinned order; a package whose slots
 *    are out of order, repeated, or unknown to the table is a typed refusal, never
 *    silently re-sorted, de-duplicated, or skipped;
 *  - values are emitted verbatim: no case folding, padding, number formatting,
 *    pluralization, collation, `localeCompare`, or any other locale-sensitive
 *    transform participates;
 *  - no wall clock, RNG, random UUID, process-local counter, or object identity
 *    participates, so repeated runs on identical inputs are byte-identical.
 *
 * A rendering failure is a typed refusal that changes nothing: it mutates no
 * package, appends to no ledger, and cannot reach ranking or selection, which ran
 * to completion before this stage was entered (replay spec T5/T7). Recording the
 * refusal as a `presentation-failed` outcome is the caller's step, and the ledger
 * keeps it distinct from player non-engagement (T6).
 */
import { canonicalSerialize, mintHash } from './canonicalSerialization'
import { ATTENTION_TEMPLATE_VERSION } from './attentionCandidatePolicy'
import {
  ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
  ATTENTION_PATTERN_REVEAL_PACKAGE_SCHEMA_VERSION,
  isValidDirectEvidenceFieldValue,
} from './attentionDirectEvidenceAssertion'
import { validateAttentionInferenceProvenance } from './attentionInferenceProvenance'
import { ATTENTION_INFERENCE_PROVENANCE_POLICY } from './attentionInferenceProvenancePolicy'
import { ATTENTION_REVEAL_SLOT_ORDER } from './attentionRevealPackage'
import type {
  AttentionRevealPackage,
  AttentionDiegeticRevealPackage,
  AttentionRevealResultTag,
  AttentionRevealSlotId,
} from './attentionRevealPackage'
import type { AttentionRevealScope } from './attentionRevealScope'

/**
 * The finite template: one fixed label per approved slot, and nothing else. A
 * slot id absent from this table cannot be rendered, which is what makes the
 * template finite rather than open-ended.
 */
export const ATTENTION_TEMPLATE_SLOT_LABELS: Readonly<Record<AttentionRevealSlotId, string>> = Object.freeze({
  'opening-provenance-id': 'opening-provenance',
  'legally-visible-parties': 'parties',
  'legally-visible-public-stakes': 'public-stakes',
  'legally-visible-origin-consequence-reference': 'origin-consequence',
})

/** The fixed line prefixes for the two header lines. */
const TEMPLATE_HEADER_PREFIX = 'attention-reveal'
const CANDIDATE_LINE_PREFIX = 'candidate'

/** The fixed separators. Both are structural, not prose. */
const FIELD_SEPARATOR = '/'
const VALUE_SEPARATOR = '|'

export interface AttentionTemplateRequest {
  readonly templateVersion: string
  readonly approvedRevealScope?: AttentionRevealScope
}

/** The closed typed refusal set. Every case refuses; none approximates. */
export type AttentionTemplateRefusal =
  | 'missing-template-version'
  | 'unsupported-template-version'
  | 'template-version-mismatch'
  | 'unrenderable-result-tag'
  | 'missing-candidate-id'
  | 'unknown-template-slot'
  | 'duplicate-template-slot'
  | 'template-slot-out-of-order'
  | 'missing-template-slot-value'
  | 'missing-required-template-slot'
  | 'unsupported-pattern-package-schema'
  | 'missing-pattern-assertion'
  | 'malformed-pattern-assertion'
  | 'duplicate-pattern-assertion'

export type AttentionTemplateResult =
  | {
      readonly kind: 'ok'
      readonly templateVersion: string
      readonly resultTag: AttentionRevealResultTag
      readonly lines: readonly string[]
      readonly output: string
      readonly outputIdentity: string
    }
  | { readonly kind: 'refused'; readonly reason: AttentionTemplateRefusal }

function isPresent(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isKnownSlotId(slotId: string): slotId is AttentionRevealSlotId {
  return ATTENTION_REVEAL_SLOT_ORDER.includes(slotId as AttentionRevealSlotId)
}

/**
 * The final gate at the actual point of slash-delimited interpolation. A
 * value that reaches here has already been checked by the assertion builder
 * and the package builder, but this renderer never trusts an upstream package
 * it did not build itself: a forged package handed directly to this function
 * must still refuse rather than let a value containing a separator or control
 * character forge apparent extra lines or fields (RN019 direct-only
 * presentation legality).
 */
function isValidRenderedField(value: unknown): value is string {
  return isPresent(value) && isValidDirectEvidenceFieldValue(value)
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function assertionLine(assertion: Extract<AttentionRevealPackage, { readonly assertions: readonly unknown[] }>['assertions'][number]):
  string | AttentionTemplateRefusal {
  if (!isPresent(assertion.assertionId)) {
    return 'malformed-pattern-assertion'
  }
  switch (assertion.assertionKind) {
    case 'public_aid':
      return assertion.token === 'public aid'
        && hasExactKeys(assertion, ['assertionId', 'assertionKind', 'sourceRecordId', 'visibilityProvenanceId', 'token', 'actorId', 'targetId'])
        && isPresent(assertion.sourceRecordId) && isPresent(assertion.visibilityProvenanceId)
        && isValidRenderedField(assertion.actorId) && isValidRenderedField(assertion.targetId)
        ? `${assertion.token}/${assertion.actorId}/${assertion.targetId}`
        : 'malformed-pattern-assertion'
    case 'public_harm_severity':
      return assertion.token === 'public harm severity'
        && hasExactKeys(assertion, ['assertionId', 'assertionKind', 'sourceRecordId', 'visibilityProvenanceId', 'token', 'actorId', 'targetId', 'publicSeverityBand'])
        && isPresent(assertion.sourceRecordId) && isPresent(assertion.visibilityProvenanceId)
        && isValidRenderedField(assertion.actorId) && isValidRenderedField(assertion.targetId)
        && ['minor', 'moderate', 'major'].includes(assertion.publicSeverityBand)
        ? `${assertion.token}/${assertion.actorId}/${assertion.targetId}/${assertion.publicSeverityBand}`
        : 'malformed-pattern-assertion'
    case 'public_commitment':
      return assertion.token === 'public commitment'
        && hasExactKeys(assertion, ['assertionId', 'assertionKind', 'sourceRecordId', 'visibilityProvenanceId', 'token', 'speakerId', 'recipientId', 'commitmentKey'])
        && isPresent(assertion.sourceRecordId) && isPresent(assertion.visibilityProvenanceId)
        && isValidRenderedField(assertion.speakerId) && isValidRenderedField(assertion.recipientId)
        && isValidRenderedField(assertion.commitmentKey)
        ? `${assertion.token}/${assertion.speakerId}/${assertion.recipientId}/${assertion.commitmentKey}`
        : 'malformed-pattern-assertion'
    case 'public_fulfillment_record':
      return assertion.token === 'public fulfillment record'
        && hasExactKeys(assertion, ['assertionId', 'assertionKind', 'sourceRecordId', 'visibilityProvenanceId', 'token', 'actorId', 'targetId', 'commitmentKey'])
        && isPresent(assertion.sourceRecordId) && isPresent(assertion.visibilityProvenanceId)
        && isValidRenderedField(assertion.actorId) && isValidRenderedField(assertion.targetId)
        && isValidRenderedField(assertion.commitmentKey)
        ? `${assertion.token}/${assertion.actorId}/${assertion.targetId}/${assertion.commitmentKey}`
        : 'malformed-pattern-assertion'
    case 'certified_absence':
      return assertion.token === 'nothing in the admitted public record shows aid between'
        && hasExactKeys(assertion, ['assertionId', 'assertionKind', 'token', 'entityA', 'entityB', 'relationId', 'fromLsn', 'toLsn', 'provenance'])
        && isValidRenderedField(assertion.entityA) && isValidRenderedField(assertion.entityB)
        && isValidRenderedField(assertion.relationId) && Number.isSafeInteger(assertion.fromLsn) && Number.isSafeInteger(assertion.toLsn)
        ? `${assertion.token}/${assertion.entityA}/${assertion.entityB}/${assertion.relationId}/${assertion.fromLsn}/${assertion.toLsn}`
        : 'malformed-pattern-assertion'
    case 'aggregate': {
      const valid = validateAttentionInferenceProvenance(assertion.provenance, ATTENTION_INFERENCE_PROVENANCE_POLICY)
      if (
        !hasExactKeys(assertion, [
          'assertionId', 'assertionKind', 'participants', 'provenance',
          'ruleContentHash', 'ruleId', 'ruleSemanticVersion', 'token',
        ])
        || valid.kind !== 'ok'
        || assertion.provenance.assertionId !== assertion.assertionId
        || assertion.provenance.ruleId !== assertion.ruleId
        || assertion.provenance.ruleSemanticVersion !== assertion.ruleSemanticVersion
        || assertion.provenance.ruleContentHash !== assertion.ruleContentHash
        || assertion.provenance.token !== assertion.token
        || assertion.participants.length < 2
        || assertion.participants.some((participant) => !isValidRenderedField(participant))
        || new Set(assertion.participants).size !== assertion.participants.length
      ) return 'malformed-pattern-assertion'
      if (assertion.token === 'public aid was exchanged' && assertion.participants.length === 2) {
        return `${assertion.token}/${assertion.participants[0]}/${assertion.participants[1]}`
      }
      if (assertion.token === 'recorded public aid linked' && assertion.participants.length >= 3) {
        return `${assertion.token}/${assertion.participants.join(VALUE_SEPARATOR)}`
      }
      return 'malformed-pattern-assertion'
    }
    default:
      return 'malformed-pattern-assertion'
  }
}

/**
 * The rendered-output identity: the pinned template version, prefixed onto a hash
 * of the canonical rendered form. The version participates twice — as the prefix
 * and inside the hashed bytes — so an identity minted under a later template can
 * be neither compared equal to, nor silently reinterpreted as, one minted here.
 *
 * `canonicalSerialization.ts` is reused unchanged, as every Stage A slice before
 * this one did. Its own header records that it is a proof-local stand-in and not
 * a production canonical-serialization or cryptographic-hash choice; that limit
 * is unchanged here, and nothing in this module promotes it.
 */
function templateOutputIdentity(
  templateVersion: string,
  resultTag: AttentionRevealResultTag,
  candidateId: string,
  lines: readonly string[],
): string {
  return templateVersion + ':' + mintHash(canonicalSerialize({
    candidateId,
    lines,
    resultTag,
    templateVersion,
  }))
}

/**
 * Render an approved reveal package through the pinned deterministic template.
 *
 * Checks run in declared order and stop at the first failure, so the reason a
 * caller receives is stable. Nothing is repaired: an out-of-order, repeated,
 * unknown, or empty slot refuses rather than being re-sorted, merged, dropped, or
 * filled in, because each of those repairs would let the rendered bytes stop
 * being a pure function of the approved package.
 */
export function renderAttentionRevealPackage(
  revealPackage: AttentionRevealPackage,
  request: AttentionTemplateRequest,
): AttentionTemplateResult {
  if (!isPresent(request.templateVersion)) {
    return { kind: 'refused', reason: 'missing-template-version' }
  }
  if ('assertions' in revealPackage) {
    if (request.templateVersion !== ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION) {
      return { kind: 'refused', reason: 'unsupported-template-version' }
    }
    if (revealPackage.templateVersion !== request.templateVersion) {
      return { kind: 'refused', reason: 'template-version-mismatch' }
    }
    if (revealPackage.packageSchemaVersion !== ATTENTION_PATTERN_REVEAL_PACKAGE_SCHEMA_VERSION) {
      return { kind: 'refused', reason: 'unsupported-pattern-package-schema' }
    }
    if (
      revealPackage.approvedRevealScope !== undefined
      && (request.approvedRevealScope === undefined
        || canonicalSerialize(request.approvedRevealScope) !== canonicalSerialize(revealPackage.approvedRevealScope))
    ) return { kind: 'refused', reason: 'unrenderable-result-tag' }
    if (revealPackage.resultTag !== 'presentation-ready' || !isPresent(revealPackage.candidateId)) {
      return { kind: 'refused', reason: 'unrenderable-result-tag' }
    }
    if (revealPackage.assertions.length === 0) return { kind: 'refused', reason: 'missing-pattern-assertion' }
    const assertionIds = new Set<string>()
    const sourceIds = new Set<string>()
    let aggregateSeen = false
    const lines: string[] = []
    for (const assertion of revealPackage.assertions) {
      if (assertionIds.has(assertion.assertionId)) {
        return { kind: 'refused', reason: 'duplicate-pattern-assertion' }
      }
      assertionIds.add(assertion.assertionId)
      if (assertion.assertionKind === 'aggregate') {
        if (aggregateSeen || lines.length !== revealPackage.assertions.length - 1) {
          return { kind: 'refused', reason: 'malformed-pattern-assertion' }
        }
        aggregateSeen = true
      } else if (assertion.assertionKind !== 'certified_absence') {
        if (aggregateSeen || sourceIds.has(assertion.sourceRecordId)) {
          return { kind: 'refused', reason: 'duplicate-pattern-assertion' }
        }
        sourceIds.add(assertion.sourceRecordId)
      }
      const line = assertionLine(assertion)
      if (line === 'malformed-pattern-assertion') return { kind: 'refused', reason: line }
      lines.push(line)
    }
    const frozenLines = Object.freeze(lines)
    return {
      kind: 'ok',
      templateVersion: request.templateVersion,
      resultTag: revealPackage.resultTag,
      lines: frozenLines,
      output: frozenLines.join('\n'),
      outputIdentity: templateOutputIdentity(
        request.templateVersion,
        revealPackage.resultTag,
        revealPackage.candidateId,
        frozenLines,
      ),
    }
  }
  if (request.templateVersion !== ATTENTION_TEMPLATE_VERSION) {
    return { kind: 'refused', reason: 'unsupported-template-version' }
  }
  if (revealPackage.templateVersion !== request.templateVersion) {
    return { kind: 'refused', reason: 'template-version-mismatch' }
  }
  // `presentation-failed` is the tag a caller records *for* a refusal; a package
  // carrying it was never approved for an attempt, so rendering it would
  // manufacture output for a result that has none.
  if (revealPackage.resultTag !== 'presentation-ready' && revealPackage.resultTag !== 'presentation-fallback') {
    return { kind: 'refused', reason: 'unrenderable-result-tag' }
  }
  if (!isPresent(revealPackage.candidateId)) {
    return { kind: 'refused', reason: 'missing-candidate-id' }
  }

  const lines: string[] = [
    TEMPLATE_HEADER_PREFIX + FIELD_SEPARATOR + request.templateVersion,
    CANDIDATE_LINE_PREFIX + FIELD_SEPARATOR + revealPackage.candidateId,
  ]

  let previousOrderIndex = -1
  for (const slot of revealPackage.slots) {
    if (!isKnownSlotId(slot.slotId)) {
      return { kind: 'refused', reason: 'unknown-template-slot' }
    }
    const orderIndex = ATTENTION_REVEAL_SLOT_ORDER.indexOf(slot.slotId)
    if (orderIndex === previousOrderIndex) {
      return { kind: 'refused', reason: 'duplicate-template-slot' }
    }
    if (orderIndex < previousOrderIndex) {
      return { kind: 'refused', reason: 'template-slot-out-of-order' }
    }
    previousOrderIndex = orderIndex

    if (slot.values.length === 0 || slot.values.some((value) => !isPresent(value))) {
      return { kind: 'refused', reason: 'missing-template-slot-value' }
    }
    lines.push(
      ATTENTION_TEMPLATE_SLOT_LABELS[slot.slotId] + FIELD_SEPARATOR + slot.values.join(VALUE_SEPARATOR),
    )
  }

  // The opening-provenance slot is the one slot every admitted candidate carries,
  // so a package without it is not a legally grounded package at all.
  if (!revealPackage.slots.some((slot) => slot.slotId === 'opening-provenance-id')) {
    return { kind: 'refused', reason: 'missing-required-template-slot' }
  }

  const frozenLines = Object.freeze([...lines])

  return {
    kind: 'ok',
    templateVersion: request.templateVersion,
    resultTag: revealPackage.resultTag,
    lines: frozenLines,
    output: frozenLines.join('\n'),
    outputIdentity: templateOutputIdentity(
      request.templateVersion,
      revealPackage.resultTag,
      revealPackage.candidateId,
      frozenLines,
    ),
  }
}

/** C6's diegetic branch has no free-form phrasing: it delegates all assertion
 * text to the existing deterministic package renderer. */
export function renderAttentionDiegeticRevealPackage(
  diegeticPackage: AttentionDiegeticRevealPackage,
): AttentionTemplateResult {
  return renderAttentionRevealPackage(diegeticPackage.package, {
    templateVersion: diegeticPackage.package.templateVersion,
  })
}
