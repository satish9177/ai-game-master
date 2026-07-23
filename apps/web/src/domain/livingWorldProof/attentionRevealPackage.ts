/**
 * Stage A / A4 — the Stage A `RevealPackage` subset: a structured, deterministic,
 * harness-visible presentation value built from one normalized (B-domain)
 * attention candidate. Proof-local to `domain/livingWorldProof`; not a production
 * module, reducer, event, persistence contract, or UI input.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D8 `RevealPackage` immutable for exactly one attempt, D10 extradiegetic
 *    presentation, D18 deterministic template rendering only, D4 the closed
 *    legally-visible field set);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§12 "only legally-visible fields appear", §26 "Template and phrasing
 *    isolation" T2/T3, §27 `QuestCandidate` preservation);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§7 A4 "The `RevealPackage` subset ... has a template version, candidate ID,
 *    approved slots, and a result tag"; §9 A4 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * **The Stage A subset is exactly the four fields plan §7 names** — template
 * version, candidate ID, approved slots, result tag — and no more. D8's full v0
 * package additionally carries snapshot LSN, channel, revealer, recipient /
 * audience scope, reveal scope, per-assertion provenance kinds, and phrasing
 * fallback material; every one of those is deliberately absent here. Some
 * (revealer, recipient, reveal scope, aggregate legitimacy) are diegetic or
 * Stage B/C surfaces the controlling A4 section does not authorize; the rest have
 * no Stage A coordinate to be filled from honestly. Inventing any of them would
 * be presentation-legitimacy policy this slice is explicitly not allowed to make.
 *
 * Its single accepted input is an `AttentionCandidate` — the A3 normalized,
 * deterministically ordered candidate. It imports neither the A1 contracts module
 * nor the A1 accessor nor the A2 boundary, so it cannot name a raw
 * `QuestCandidate`, a proof snapshot, a private party, a secret opening detail,
 * the `open | resolved` lifecycle, or the accessor-origin mint. Every field it
 * can read was already admitted by A1's accessor-origin authority, closed by A2,
 * and normalized by A3; there is no second path around them, and nothing here
 * re-derives a value from the A domain, which this module cannot reach anyway.
 *
 * **Legally absent stays absent.** An optional legal field the candidate does not
 * carry produces no slot at all: no placeholder, no redaction marker, no invented
 * prose standing in for it. That is ADR-0013 D4's rule ("A field with no
 * legally-visible value is *absent* from the view, not populated from the private
 * record and hidden downstream") applied one boundary later, and it is what keeps
 * the package's byte content a function of legal data only.
 *
 * Determinism: slot order is the pinned `ATTENTION_REVEAL_SLOT_ORDER`, never
 * input or iteration order; party values arrive already canonicalized by A3 and
 * are copied, never re-sorted under a host collation; no wall clock, RNG, random
 * UUID, process counter, locale-sensitive formatting, or object identity
 * participates. A built package is deeply frozen, so it is immutable for exactly
 * one presentation attempt (D8) and a second attempt requires a new build rather
 * than a mutation.
 *
 * There is no write path back out of this module: it returns a value or a typed
 * refusal, holds no store, and calls nothing.
 */
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_TEMPLATE_VERSION,
  isAttentionRankingSnapshotLsnInRange,
} from './attentionCandidatePolicy'
import type { AttentionCandidate } from './attentionCandidate'

/**
 * The approved slots: the closed set of legally readable content fields a Stage A
 * candidate can carry (ADR-0013 D4's legally-visible field set, less the
 * identity and version coordinates that are package fields or refusal inputs
 * rather than presented content).
 */
export type AttentionRevealSlotId =
  | 'opening-provenance-id'
  | 'legally-visible-parties'
  | 'legally-visible-public-stakes'
  | 'legally-visible-origin-consequence-reference'

/**
 * The fixed slot order (plan §7: "unsupported legal fields are omitted in a fixed
 * slot order"). Absent slots are skipped; present slots always appear in this
 * sequence, whatever order the candidate's fields were written in.
 */
export const ATTENTION_REVEAL_SLOT_ORDER: readonly AttentionRevealSlotId[] = Object.freeze([
  'opening-provenance-id',
  'legally-visible-parties',
  'legally-visible-public-stakes',
  'legally-visible-origin-consequence-reference',
])

/**
 * The only slot ADR-0013 D4 guarantees on every admitted candidate: A1 admits a
 * view solely on accepted public/declassified opening provenance, so a normalized
 * candidate without it could not exist. It is required here so a fabricated
 * candidate refuses rather than rendering a package with no legal grounding.
 */
const REQUIRED_SLOT_ID: AttentionRevealSlotId = 'opening-provenance-id'

/**
 * The closed presentation-result vocabulary (plan §7: a rendering failure is a
 * recorded `presentation-fallback` / `presentation-failed` outcome).
 *
 *  - `presentation-ready`    — the package carries at least one optional legal
 *                              slot beyond the required opening provenance;
 *  - `presentation-fallback` — every optional legal field is legally absent, so
 *                              the package carries only the required slot and
 *                              presentation proceeds on the deterministic
 *                              minimum. This is the deterministic fallback plan
 *                              §7 requires for a missing optional slot: a smaller
 *                              legal package, never invented prose;
 *  - `presentation-failed`   — reserved for the render stage. A package is never
 *                              built with this tag; `attentionTemplate.ts`
 *                              refuses instead, and the caller records the
 *                              refusal under this tag. It lives in this union so
 *                              the presentation-result vocabulary is closed in
 *                              one place rather than duplicated in the ledger.
 */
export type AttentionRevealResultTag =
  | 'presentation-ready'
  | 'presentation-fallback'
  | 'presentation-failed'

export interface AttentionRevealSlot {
  readonly slotId: AttentionRevealSlotId
  readonly values: readonly string[]
}

/** The Stage A subset, exactly as plan §7 fixes it. */
export interface AttentionRevealPackage {
  readonly templateVersion: string
  readonly candidateId: string
  readonly slots: readonly AttentionRevealSlot[]
  readonly resultTag: AttentionRevealResultTag
}

/** The exact own keys of a built package — exported as closure evidence. */
export const ATTENTION_REVEAL_PACKAGE_KEYS: readonly string[] = Object.freeze([
  'candidateId',
  'resultTag',
  'slots',
  'templateVersion',
])

export interface AttentionRevealPackageRequest {
  readonly templateVersion: string
}

/** The closed typed refusal set. Every case refuses; none approximates. */
export type AttentionRevealPackageRefusal =
  | 'missing-template-version'
  | 'unsupported-template-version'
  | 'missing-accessor-contract-version'
  | 'missing-canonicalization-version'
  | 'unsupported-canonicalization-version'
  | 'missing-identity-schema-version'
  | 'unsupported-identity-schema-version'
  | 'missing-ranking-snapshot-lsn'
  | 'ranking-snapshot-lsn-out-of-range'
  | 'missing-candidate-id'
  | 'missing-opening-provenance-id'
  | 'empty-legally-visible-slot-value'

export type AttentionRevealPackageResult =
  | { readonly kind: 'ok'; readonly revealPackage: AttentionRevealPackage }
  | { readonly kind: 'refused'; readonly reason: AttentionRevealPackageRefusal }

function isPresent(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function slot(slotId: AttentionRevealSlotId, values: readonly string[]): AttentionRevealSlot {
  return Object.freeze({ slotId, values: Object.freeze([...values]) })
}

/**
 * Build the Stage A reveal package for one normalized attention candidate.
 *
 * Version coordinates are checked first and in declared order, so the reason a
 * caller receives is stable rather than dependent on which check was cheapest.
 * Every one of them refuses; none is defaulted, repaired, or approximated
 * (ADR-0013 D15 "Missing versions refuse"; replay spec §22 K3 "the harness
 * refuses, it does not approximate"). The two versions this rig owns —
 * canonicalization and identity schema — are checked against their pins, because
 * a package cannot honestly claim a canonical form this build does not implement;
 * the accessor-contract version is checked for presence only and stays opaque,
 * exactly as A3's cache-key module treats it, since A1's accessor already owns
 * which version it will serve.
 *
 * The candidate is read and never written: it is already deeply frozen by A3, and
 * every value copied out is either a string primitive or a fresh frozen copy.
 */
export function buildAttentionRevealPackage(
  attentionCandidate: AttentionCandidate,
  request: AttentionRevealPackageRequest,
): AttentionRevealPackageResult {
  if (!isPresent(request.templateVersion)) {
    return { kind: 'refused', reason: 'missing-template-version' }
  }
  if (request.templateVersion !== ATTENTION_TEMPLATE_VERSION) {
    return { kind: 'refused', reason: 'unsupported-template-version' }
  }
  if (!isPresent(attentionCandidate.accessorContractVersion)) {
    return { kind: 'refused', reason: 'missing-accessor-contract-version' }
  }
  if (!isPresent(attentionCandidate.canonicalizationVersion)) {
    return { kind: 'refused', reason: 'missing-canonicalization-version' }
  }
  if (attentionCandidate.canonicalizationVersion !== ATTENTION_CANDIDATE_CANONICALIZATION_VERSION) {
    return { kind: 'refused', reason: 'unsupported-canonicalization-version' }
  }
  if (!isPresent(attentionCandidate.identitySchemaVersion)) {
    return { kind: 'refused', reason: 'missing-identity-schema-version' }
  }
  if (attentionCandidate.identitySchemaVersion !== ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION) {
    return { kind: 'refused', reason: 'unsupported-identity-schema-version' }
  }
  if (typeof attentionCandidate.rankingSnapshotLsn !== 'number') {
    return { kind: 'refused', reason: 'missing-ranking-snapshot-lsn' }
  }
  if (!isAttentionRankingSnapshotLsnInRange(attentionCandidate.rankingSnapshotLsn)) {
    return { kind: 'refused', reason: 'ranking-snapshot-lsn-out-of-range' }
  }
  if (!isPresent(attentionCandidate.candidateId)) {
    return { kind: 'refused', reason: 'missing-candidate-id' }
  }
  if (!isPresent(attentionCandidate.openingProvenanceId)) {
    return { kind: 'refused', reason: 'missing-opening-provenance-id' }
  }

  const parties = attentionCandidate.legallyVisibleParties
  if (parties.some((party) => !isPresent(party))) {
    return { kind: 'refused', reason: 'empty-legally-visible-slot-value' }
  }
  // A field the candidate declares must carry a value. Absent is legal; present
  // but blank is a malformed candidate, and is refused rather than rendered as an
  // empty slot that would read as "this fact is known to be nothing".
  if (
    attentionCandidate.legallyVisiblePublicStakes !== undefined
    && !isPresent(attentionCandidate.legallyVisiblePublicStakes)
  ) {
    return { kind: 'refused', reason: 'empty-legally-visible-slot-value' }
  }
  if (
    attentionCandidate.legallyVisibleOriginConsequenceReference !== undefined
    && !isPresent(attentionCandidate.legallyVisibleOriginConsequenceReference)
  ) {
    return { kind: 'refused', reason: 'empty-legally-visible-slot-value' }
  }

  // Assembled strictly in the pinned slot order. An optional field that is
  // legally absent contributes nothing at all.
  const slots: AttentionRevealSlot[] = [slot(REQUIRED_SLOT_ID, [attentionCandidate.openingProvenanceId])]
  if (parties.length > 0) {
    slots.push(slot('legally-visible-parties', parties))
  }
  if (attentionCandidate.legallyVisiblePublicStakes !== undefined) {
    slots.push(slot('legally-visible-public-stakes', [attentionCandidate.legallyVisiblePublicStakes]))
  }
  if (attentionCandidate.legallyVisibleOriginConsequenceReference !== undefined) {
    slots.push(slot(
      'legally-visible-origin-consequence-reference',
      [attentionCandidate.legallyVisibleOriginConsequenceReference],
    ))
  }

  const resultTag: AttentionRevealResultTag = slots.length > 1 ? 'presentation-ready' : 'presentation-fallback'

  return {
    kind: 'ok',
    revealPackage: Object.freeze({
      templateVersion: request.templateVersion,
      candidateId: attentionCandidate.candidateId,
      slots: Object.freeze(slots),
      resultTag,
    }),
  }
}
