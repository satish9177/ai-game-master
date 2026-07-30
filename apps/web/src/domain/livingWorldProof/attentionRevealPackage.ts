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
  ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_TEMPLATE_VERSION,
  isAttentionRankingSnapshotLsnInRange,
} from './attentionCandidatePolicy'
import type { AttentionCandidate } from './attentionCandidate'
import {
  ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
  ATTENTION_PATTERN_REVEAL_PACKAGE_SCHEMA_VERSION,
  hasValidDirectEvidenceAssertionFields,
} from './attentionDirectEvidenceAssertion'
import type {
  AttentionDirectEvidenceAssertion,
  AttentionPositiveDirectEvidenceAssertion,
} from './attentionDirectEvidenceAssertion'
import { attentionStageBResourcePolicy } from './attentionNarrativePatternResourcePolicy'
import type { AttentionStageBResourcePolicy } from './attentionNarrativePatternResourcePolicy'
import type { AttentionAggregateAssertion } from './attentionAggregateLegitimacy'
import { validateAttentionInferenceProvenance } from './attentionInferenceProvenance'
import { ATTENTION_INFERENCE_PROVENANCE_POLICY } from './attentionInferenceProvenancePolicy'
import type { AttentionRevealScope } from './attentionRevealScope'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION,
  createAttentionDiegeticRevealProposal,
} from './attentionDiegeticRevealProposal'
import type {
  AttentionDiegeticRevealProposal,
  AttentionDiegeticRevealProposalRefusal,
} from './attentionDiegeticRevealProposal'

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
export interface AttentionQuestRevealPackage {
  readonly templateVersion: string
  readonly candidateId: string
  readonly slots: readonly AttentionRevealSlot[]
  readonly resultTag: AttentionRevealResultTag
}

export interface AttentionPatternRevealPackage {
  readonly packageSchemaVersion: typeof ATTENTION_PATTERN_REVEAL_PACKAGE_SCHEMA_VERSION
  readonly templateVersion: typeof ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION
  readonly candidateId: string
  readonly assertions: readonly (AttentionDirectEvidenceAssertion | AttentionAggregateAssertion)[]
  readonly resultTag: 'presentation-ready'
  readonly approvedRevealScope?: AttentionRevealScope
}

/** One package pipeline, discriminated by its pinned branch template. */
export type AttentionRevealPackage = AttentionQuestRevealPackage | AttentionPatternRevealPackage

/** C6's pattern-only diegetic branch; the enclosed package remains immutable. */
export interface AttentionDiegeticRevealPackage {
  readonly package: AttentionPatternRevealPackage
  readonly proposal: AttentionDiegeticRevealProposal
}

/** The exact own keys of a built package — exported as closure evidence. */
export const ATTENTION_REVEAL_PACKAGE_KEYS: readonly string[] = Object.freeze([
  'candidateId',
  'resultTag',
  'slots',
  'templateVersion',
])

export const ATTENTION_PATTERN_REVEAL_PACKAGE_KEYS: readonly string[] = Object.freeze([
  'assertions',
  'candidateId',
  'packageSchemaVersion',
  'resultTag',
  'templateVersion',
])

export interface AttentionRevealPackageRequest {
  readonly templateVersion: string
  readonly directEvidenceAssertions?: readonly AttentionPositiveDirectEvidenceAssertion[]
  readonly absenceAssertions?: readonly Extract<AttentionDirectEvidenceAssertion, { readonly assertionKind: 'certified_absence' }>[]
  /** C1's licensed aggregate root. It is additive only when explicitly supplied. */
  readonly aggregateAssertion?: AttentionAggregateAssertion
  /** B5 — explicit pattern resource policy; defaults to the pinned singleton. */
  readonly policy?: AttentionStageBResourcePolicy
  readonly approvedRevealScope?: AttentionRevealScope
}

/** The closed typed refusal set. Every case refuses; none approximates. */
export type AttentionRevealPackageRefusal =
  | 'unsupported-source-family'
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
  | 'missing-direct-evidence-assertions'
  | 'empty-direct-evidence-assertions'
  | 'too-many-direct-evidence-assertions'
  | 'duplicate-direct-evidence-assertion'
  | 'direct-evidence-source-mismatch'
  | 'invalid-direct-evidence-field-character'
  | 'missing-required-direct-evidence-assertion'
  | 'unexpected-direct-evidence-assertion'
  | 'pattern-assertion-out-of-order'
  | 'invalid-aggregate-assertion'
  | 'unsupported-direct-evidence-assertions-for-quest'

export type AttentionRevealPackageResult =
  | { readonly kind: 'ok'; readonly revealPackage: AttentionRevealPackage }
  | { readonly kind: 'refused'; readonly reason: AttentionRevealPackageRefusal }

export type AttentionDiegeticRevealPackageResult =
  | { readonly kind: 'ok'; readonly diegeticPackage: AttentionDiegeticRevealPackage }
  | { readonly kind: 'refused'; readonly reason: AttentionDiegeticRevealProposalRefusal }

/** C6's one-way conversion from an approved package into the frozen B-domain
 * proposal.  It has no writer, validator, ledger, or authoritative resource. */
export function buildAttentionDiegeticRevealPackage(input: {
  readonly revealPackage: AttentionPatternRevealPackage
  readonly channelId: string
  readonly revealerId: string
  readonly recipientScope: string
  readonly revealScope: string
  readonly rankingSnapshotLsn: number
  readonly revalidationSnapshotLsn: number
  readonly policyIdentities: readonly string[]
}): AttentionDiegeticRevealPackageResult {
  const proposal = createAttentionDiegeticRevealProposal({
    schemaVersion: ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION,
    candidateId: input.revealPackage.candidateId,
    assertions: input.revealPackage.assertions.map((assertion) => assertion.assertionId),
    assertionProvenanceDigests: input.revealPackage.assertions.map((assertion) => canonicalSerialize(assertion)),
    channelId: input.channelId,
    revealerId: input.revealerId,
    recipientScope: input.recipientScope,
    revealScope: input.revealScope,
    rankingSnapshotLsn: input.rankingSnapshotLsn,
    revalidationSnapshotLsn: input.revalidationSnapshotLsn,
    policyIdentities: input.policyIdentities,
  })
  if (proposal.kind === 'refused') return proposal
  return { kind: 'ok', diegeticPackage: Object.freeze({ package: input.revealPackage, proposal: proposal.proposal }) }
}

function isPresent(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
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
  // B5's exhaustive two-family dispatch: a `narrative_pattern_instance`
  // candidate builds the bounded direct-evidence pattern package below, and a
  // `quest_candidate` builds byte-for-byte the committed Stage A package. Any
  // other runtime `sourceKind` -- unreachable under the closed type but not
  // under a forged or cast value -- refuses deterministically before any
  // quest-specific assumption or canonicalization check runs.
  if (!isPresent(request.templateVersion)) {
    return { kind: 'refused', reason: 'missing-template-version' }
  }
  if (attentionCandidate.sourceKind === 'narrative_pattern_instance') {
    if (request.templateVersion !== ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION) {
      return { kind: 'refused', reason: 'unsupported-template-version' }
    }
    if (attentionCandidate.identitySchemaVersion !== ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION) {
      return { kind: 'refused', reason: 'unsupported-identity-schema-version' }
    }
    if (!isPresent(attentionCandidate.candidateId)) return { kind: 'refused', reason: 'missing-candidate-id' }
    if (request.directEvidenceAssertions === undefined) {
      return { kind: 'refused', reason: 'missing-direct-evidence-assertions' }
    }
    if (request.directEvidenceAssertions.length === 0) {
      return { kind: 'refused', reason: 'empty-direct-evidence-assertions' }
    }
    const policy = request.policy ?? attentionStageBResourcePolicy()
    const absenceAssertions = request.absenceAssertions ?? []
    const assertionCount = request.directEvidenceAssertions.length + absenceAssertions.length + (request.aggregateAssertion === undefined ? 0 : 1)
    if (assertionCount > policy.revealPackageAssertions) {
      return { kind: 'refused', reason: 'too-many-direct-evidence-assertions' }
    }
    const assertionIds = new Set<string>()
    const seenSourceKeys = new Set<string>()
    const givenOrder: string[] = []
    const expectedOrder = attentionCandidate.canonicalSupportingRecordIdentityTuple.map(
      (entry) => entry[2] + '\u0000' + entry[3],
    )
    for (const assertion of request.directEvidenceAssertions) {
      if (!isPresent(assertion.assertionId) || assertionIds.has(assertion.assertionId)) {
        return { kind: 'refused', reason: 'duplicate-direct-evidence-assertion' }
      }
      if (!hasValidDirectEvidenceAssertionFields(assertion)) {
        return { kind: 'refused', reason: 'invalid-direct-evidence-field-character' }
      }
      assertionIds.add(assertion.assertionId)
      const sourceKey = assertion.sourceRecordId + '\u0000' + assertion.visibilityProvenanceId
      if (seenSourceKeys.has(sourceKey)) {
        return { kind: 'refused', reason: 'duplicate-direct-evidence-assertion' }
      }
      if (!expectedOrder.includes(sourceKey)) {
        return { kind: 'refused', reason: 'direct-evidence-source-mismatch' }
      }
      seenSourceKeys.add(sourceKey)
      givenOrder.push(sourceKey)
    }
    // Assertion order must equal the canonical supporting-record semantic-step
    // order (RN019 section 7.2): a rankable instance supporting tuple is
    // exactly its advancing evidence, so a legally built request length and
    // sequence always match the tuple. A shorter, longer, or reordered
    // sequence is refused rather than sorted or repaired.
    if (givenOrder.length < expectedOrder.length) {
      return { kind: 'refused', reason: 'missing-required-direct-evidence-assertion' }
    }
    if (givenOrder.length > expectedOrder.length) {
      return { kind: 'refused', reason: 'unexpected-direct-evidence-assertion' }
    }
    if (givenOrder.some((key, index) => key !== expectedOrder[index])) {
      return { kind: 'refused', reason: 'pattern-assertion-out-of-order' }
    }
    for (const assertion of absenceAssertions) {
      if (assertion.assertionKind !== 'certified_absence' || !isPresent(assertion.assertionId) || assertionIds.has(assertion.assertionId)
        || !hasValidDirectEvidenceAssertionFields(assertion)) return { kind: 'refused', reason: 'invalid-direct-evidence-field-character' }
      assertionIds.add(assertion.assertionId)
    }
    if (request.aggregateAssertion !== undefined) {
      const aggregate = request.aggregateAssertion
      if (
        !hasExactKeys(aggregate, [
          'assertionId', 'assertionKind', 'participants', 'provenance',
          'ruleContentHash', 'ruleId', 'ruleSemanticVersion', 'token',
        ])
        || aggregate.assertionKind !== 'aggregate'
        || !isPresent(aggregate.assertionId)
        || !isPresent(aggregate.ruleId)
        || !isPresent(aggregate.ruleSemanticVersion)
        || !isPresent(aggregate.ruleContentHash)
        || !Array.isArray(aggregate.participants)
        || aggregate.participants.length < 2
        || aggregate.participants.some((participant) => !isPresent(participant))
        || new Set(aggregate.participants).size !== aggregate.participants.length
        || aggregate.provenance.assertionId !== aggregate.assertionId
        || aggregate.provenance.ruleId !== aggregate.ruleId
        || aggregate.provenance.ruleSemanticVersion !== aggregate.ruleSemanticVersion
        || aggregate.provenance.ruleContentHash !== aggregate.ruleContentHash
        || aggregate.provenance.token !== aggregate.token
        || validateAttentionInferenceProvenance(aggregate.provenance, ATTENTION_INFERENCE_PROVENANCE_POLICY).kind !== 'ok'
      ) return { kind: 'refused', reason: 'invalid-aggregate-assertion' }
    }
    return {
      kind: 'ok',
      revealPackage: Object.freeze({
        packageSchemaVersion: ATTENTION_PATTERN_REVEAL_PACKAGE_SCHEMA_VERSION,
        templateVersion: ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION,
        candidateId: attentionCandidate.candidateId,
        assertions: Object.freeze([
          ...request.directEvidenceAssertions.map((assertion) => Object.freeze({ ...assertion })),
          ...absenceAssertions.map((assertion) => Object.freeze({ ...assertion })),
          ...(request.aggregateAssertion === undefined ? [] : [Object.freeze({ ...request.aggregateAssertion })]),
        ]),
        resultTag: 'presentation-ready',
        ...(request.approvedRevealScope === undefined ? {} : { approvedRevealScope: request.approvedRevealScope }),
      }),
    }
  }
  if (attentionCandidate.sourceKind !== 'quest_candidate') {
    return { kind: 'refused', reason: 'unsupported-source-family' }
  }
  if (request.directEvidenceAssertions !== undefined) {
    return { kind: 'refused', reason: 'unsupported-direct-evidence-assertions-for-quest' }
  }
  if (request.absenceAssertions !== undefined) return { kind: 'refused', reason: 'unsupported-direct-evidence-assertions-for-quest' }
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
