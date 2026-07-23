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
import { ATTENTION_REVEAL_SLOT_ORDER } from './attentionRevealPackage'
import type {
  AttentionRevealPackage,
  AttentionRevealResultTag,
  AttentionRevealSlotId,
} from './attentionRevealPackage'

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
