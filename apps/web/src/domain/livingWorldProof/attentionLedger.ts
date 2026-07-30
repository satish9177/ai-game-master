/**
 * Stage A / A4 — the replay-local, non-authoritative Attention Ledger (surface C):
 * an immutable append sequence of presentation outcomes, plus the closed set of
 * declared features later ranking is permitted to read from it. Proof-local to
 * `domain/livingWorldProof`; not a production module, reducer, event, store,
 * migration, or persistence contract.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D2 surface C, D17 "Attention Ledger; non-authoritative, one-way", D15
 *    cooldown keyed on world time or committed LSN and never wall clock);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§24 "Attention Ledger closure" L1-L4, §25 "No online policy adaptation"
 *    L5-L6, §26 T6 a rendering failure is not non-engagement);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§7 A4 "an in-memory/replay-local immutable append sequence ... No database
 *    table or migration is allowed"; §9 A4 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * **What this is not.** There is no store, table, migration, connection, file,
 * cache, index, or process-global registry here, and no persistence of any kind:
 * a ledger is a frozen value a caller holds for the length of one proof run, and
 * append returns a new frozen value rather than mutating the old one. It is
 * non-authoritative by construction — nothing in this module can create, resolve,
 * or touch a `QuestCandidate` lifecycle, a world event, world state, NPC memory,
 * a belief, a relationship, a goal, or a routine, because it imports no module
 * that names any of them and exposes no function that returns one.
 *
 * **One-way, and only through declared features.** D17 permits the ledger to
 * influence "only later attention ranking and presentation-density decisions, and
 * only through already-declared, versioned deterministic features". The one
 * sanctioned read is `attentionLedgerFeatures`, whose output keys are pinned in
 * `ATTENTION_LEDGER_FEATURE_KEYS`: exposure, repetition, non-engagement, and the
 * cooldown coordinate. Nothing here feeds detection, A-prime construction, or
 * candidate identity — and it structurally cannot, since A1/A2/A3 import no A4
 * module. No weight, threshold, or policy is learned, tuned, or selected from
 * ledger content (D17's "no online policy adaptation"); this module contains no
 * arithmetic beyond counting its own records.
 *
 * **Deliberately absent**, because the controlling A4 plan section does not
 * authorize them and no Stage A coordinate could fill them honestly: the
 * presentation-time revalidation coordinate and its two-clock rule (A5), the
 * ordering/tie-break trace and the complete `AttentionTrace` (A5), a
 * presentation-density window (its limit is unpinned — plan §6.1(3)), cooldown and
 * retirement thresholds (ADR-0013 open question 3, experiment-owned), typed
 * rejection diagnostics and the player-observable/engine-only partition (D11), and
 * any eligibility field — Stage A eligibility is A-prime membership itself and a
 * separate stored flag is expressly forbidden (plan §6.1(2)).
 *
 * Determinism: record identity is a pure function of the record's own declared
 * fields, including its append position, canonically serialized by the proof
 * rig's deep key-sorting helper and prefixed with the pinned ledger-policy
 * version. No wall clock, RNG, random UUID, process counter, locale comparison,
 * object identity, or map/set iteration order participates.
 */
import { canonicalSerialize, mintHash } from './canonicalSerialization'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_EXPOSURE_POLICY_VERSION,
  ATTENTION_LEDGER_POLICY_VERSION,
  ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
  ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
  ATTENTION_TEMPLATE_VERSION,
  isAttentionRankingSnapshotLsnInRange,
} from './attentionCandidatePolicy'
import type { AttentionCandidate } from './attentionCandidate'
import type { AttentionRevealResultTag } from './attentionRevealPackage'
import { ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION } from './attentionDirectEvidenceAssertion'
import {
  ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
  attentionStageBResourcePolicy,
} from './attentionNarrativePatternResourcePolicy'
import type { AttentionStageBResourcePolicy } from './attentionNarrativePatternResourcePolicy'

/**
 * The closed outcome vocabulary: the three presentation results (plan §7) plus
 * player non-engagement, which D17 keeps ledger-only and which §26 T6 requires be
 * distinct from a rendering failure. Reusing `AttentionRevealResultTag` keeps one
 * presentation vocabulary rather than a second copy that could drift from it.
 */
export type AttentionLedgerOutcome = AttentionRevealResultTag | 'non-engagement' | 'revalidation-failed'

/** C7's naming-only bridge: the established failed-render outcome is classified
 * as the existing D11 phrasing_failed code without changing when it fires. */
export function attentionLedgerOutcomeDiagnostic(outcome: AttentionLedgerOutcome): 'phrasing_failed' | null {
  return outcome === 'presentation-failed' ? 'phrasing_failed' : null
}

/** B5's disjoint pattern-presentation record contract; never a quest sentinel. */
export { ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION } from './attentionCandidatePolicy'

/** The outcomes that count as an exposure — a reveal actually rendered. */
const PRESENTED_OUTCOMES: readonly AttentionLedgerOutcome[] = Object.freeze([
  'presentation-ready',
  'presentation-fallback',
])

/** The outcomes that carry rendered output, and therefore an output identity. */
function outcomeCarriesOutput(outcome: AttentionLedgerOutcome): boolean {
  return PRESENTED_OUTCOMES.includes(outcome)
}

/** The common, non-branch record coordinates. */
interface AttentionLedgerRecordBase {
  readonly exposurePolicyVersion: string
  readonly templateChannelPolicyVersion: string
  readonly canonicalizationVersion: string
  readonly accessorContractVersion: string
  readonly templateVersion: string
  readonly sequence: number
  readonly recordId: string
  readonly sourceId: string
  readonly candidateId: string
  readonly rankingSnapshotLsn: number
  readonly outcome: AttentionLedgerOutcome
  readonly renderedOutputIdentity?: string
}

/** The committed, byte-frozen Stage A quest record branch. */
export type AttentionQuestLedgerRecord = AttentionLedgerRecordBase & {
  readonly sourceKind: 'quest_candidate'
  readonly ledgerPolicyVersion: typeof ATTENTION_LEDGER_POLICY_VERSION
}

/** The disjoint B5 pattern-presentation record branch. */
export type AttentionPatternPresentationLedgerRecord = AttentionLedgerRecordBase & {
  readonly sourceKind: 'narrative_pattern_instance'
  readonly patternPresentationLedgerPolicyVersion: typeof ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION
  /** Committed presentation coordinate; never wall time. */
  readonly presentationLsn: number
  readonly resourcePolicyVersion: typeof ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION
}

/** One immutable, source-kind-discriminated ledger record. */
export type AttentionLedgerRecord = AttentionQuestLedgerRecord | AttentionPatternPresentationLedgerRecord

type AttentionLedgerRecordFields = Omit<AttentionQuestLedgerRecord, 'recordId'>
  | Omit<AttentionPatternPresentationLedgerRecord, 'recordId'>

/** The exact own keys of a record, less the optional one — closure evidence. */
export const ATTENTION_LEDGER_RECORD_KEYS: readonly string[] = Object.freeze([
  'accessorContractVersion',
  'canonicalizationVersion',
  'candidateId',
  'exposurePolicyVersion',
  'ledgerPolicyVersion',
  'outcome',
  'rankingSnapshotLsn',
  'recordId',
  'sequence',
  'sourceId',
  'sourceKind',
  'templateChannelPolicyVersion',
  'templateVersion',
])

/** B5-only keys for the pattern branch; quest bytes keep the list above exactly. */
export const ATTENTION_PATTERN_PRESENTATION_LEDGER_RECORD_KEYS: readonly string[] = Object.freeze([
  'accessorContractVersion',
  'candidateId',
  'canonicalizationVersion',
  'exposurePolicyVersion',
  'outcome',
  'patternPresentationLedgerPolicyVersion',
  'presentationLsn',
  'rankingSnapshotLsn',
  'recordId',
  'resourcePolicyVersion',
  'sequence',
  'sourceId',
  'sourceKind',
  'templateChannelPolicyVersion',
  'templateVersion',
])

/** The replay-local ledger value: a policy pin and a frozen append sequence. */
export interface AttentionLedger {
  readonly ledgerPolicyVersion: string
  readonly records: readonly AttentionLedgerRecord[]
}

export interface AttentionLedgerRequest {
  readonly ledgerPolicyVersion: string
}

export interface AttentionLedgerAppendInput {
  readonly attentionCandidate: AttentionCandidate
  readonly exposurePolicyVersion: string
  readonly templateChannelPolicyVersion: string
  readonly templateVersion: string
  readonly outcome: AttentionLedgerOutcome
  readonly renderedOutputIdentity?: string
  readonly patternPresentationLedgerPolicyVersion?: string
  readonly presentationLsn?: number
  readonly resourcePolicyVersion?: string
}

/** The closed typed refusal set. Every case refuses; none approximates. */
export type AttentionLedgerRefusal =
  | 'missing-ledger-policy-version'
  | 'unsupported-ledger-policy-version'
  | 'missing-exposure-policy-version'
  | 'unsupported-exposure-policy-version'
  | 'missing-template-channel-policy-version'
  | 'unsupported-template-channel-policy-version'
  | 'missing-template-version'
  | 'unsupported-template-version'
  | 'missing-canonicalization-version'
  | 'unsupported-canonicalization-version'
  | 'missing-accessor-contract-version'
  | 'missing-ranking-snapshot-lsn'
  | 'ranking-snapshot-lsn-out-of-range'
  | 'missing-source-id'
  | 'missing-candidate-id'
  | 'unsupported-outcome'
  | 'missing-rendered-output-identity'
  | 'unexpected-rendered-output-identity'
  | 'duplicate-record-identity'
  | 'missing-pattern-presentation-lsn'
  | 'pattern-presentation-lsn-out-of-range'
  | 'missing-pattern-presentation-ledger-policy-version'
  | 'unsupported-pattern-presentation-ledger-policy-version'
  | 'missing-resource-policy-version'
  | 'unsupported-resource-policy-version'
  | 'mixed-ledger-record-branch'
  | 'unsupported-ledger-record-source-kind'

export type AttentionLedgerCreateResult =
  | { readonly kind: 'ok'; readonly ledger: AttentionLedger }
  | { readonly kind: 'refused'; readonly reason: AttentionLedgerRefusal }

export type AttentionLedgerAppendResult =
  | { readonly kind: 'ok'; readonly ledger: AttentionLedger; readonly record: AttentionLedgerRecord }
  | { readonly kind: 'refused'; readonly reason: AttentionLedgerRefusal }

/** The closed feature set later ranking may read (D13/D17; replay spec L1). */
export interface AttentionLedgerFeatures {
  readonly exposureCount: number
  readonly repetitionCount: number
  readonly nonEngagementCount: number
  readonly lastPresentedRankingSnapshotLsn: number | null
}

/**
 * The pinned feature keys. Exported so the closure obligation is checkable
 * mechanically: a later slice that widened the projection would have to change
 * this list, which is a visible policy edit rather than a silent read.
 */
export const ATTENTION_LEDGER_FEATURE_KEYS: readonly string[] = Object.freeze([
  'exposureCount',
  'lastPresentedRankingSnapshotLsn',
  'nonEngagementCount',
  'repetitionCount',
])

const SUPPORTED_OUTCOMES: readonly AttentionLedgerOutcome[] = Object.freeze([
  'presentation-ready',
  'presentation-fallback',
  'presentation-failed',
  'non-engagement',
  'revalidation-failed',
])

function isPresent(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isQuestLedgerRecord(record: AttentionLedgerRecord): record is AttentionQuestLedgerRecord {
  return record.sourceKind === 'quest_candidate'
    && record.ledgerPolicyVersion === ATTENTION_LEDGER_POLICY_VERSION
    && !hasOwn(record, 'patternPresentationLedgerPolicyVersion')
    && !hasOwn(record, 'presentationLsn')
    && !hasOwn(record, 'resourcePolicyVersion')
}

function isPatternPresentationLedgerRecord(
  record: AttentionLedgerRecord,
): record is AttentionPatternPresentationLedgerRecord {
  return record.sourceKind === 'narrative_pattern_instance'
    && record.patternPresentationLedgerPolicyVersion === ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION
    && isAttentionRankingSnapshotLsnInRange(record.presentationLsn)
    && record.resourcePolicyVersion === ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION
    && !hasOwn(record, 'ledgerPolicyVersion')
}

/**
 * Create an empty replay-local ledger under an explicit policy version. A missing
 * or unsupported version refuses rather than defaulting: a ledger keyed to a
 * policy nobody declared would make every record it later holds unauditable
 * (ADR-0013 D15 "Missing versions refuse").
 */
export function createAttentionLedger(request: AttentionLedgerRequest): AttentionLedgerCreateResult {
  if (!isPresent(request.ledgerPolicyVersion)) {
    return { kind: 'refused', reason: 'missing-ledger-policy-version' }
  }
  if (request.ledgerPolicyVersion !== ATTENTION_LEDGER_POLICY_VERSION) {
    return { kind: 'refused', reason: 'unsupported-ledger-policy-version' }
  }
  return {
    kind: 'ok',
    ledger: Object.freeze({
      ledgerPolicyVersion: request.ledgerPolicyVersion,
      records: Object.freeze([]),
    }),
  }
}

/**
 * The deterministic record identity: every declared field of the record,
 * canonically serialized and hashed, prefixed with the pinned ledger-policy
 * version. The append position is one of those fields, so two otherwise identical
 * appends are distinguishable records rather than one aliased record, and the
 * identity of a record is fixed by its position in the sequence — which is what
 * makes "deterministic record identity and order" a single property rather than
 * two that could disagree.
 */
function ledgerRecordIdentity(fields: AttentionLedgerRecordFields): string {
  const prefix = fields.sourceKind === 'quest_candidate'
    ? fields.ledgerPolicyVersion
    : fields.patternPresentationLedgerPolicyVersion
  return prefix + ':' + mintHash(canonicalSerialize(fields))
}

/**
 * Append one presentation outcome, returning a new ledger.
 *
 * The input ledger is not touched: it is frozen, its records array is frozen, and
 * the result is a fresh frozen value built from a copy. Append-only is therefore
 * structural — this module exposes no update, remove, replace, truncate, or
 * rewrite function, and a caller holding an earlier ledger still holds exactly
 * the bytes it held before.
 *
 * Version coordinates are checked in declared order and every one refuses; the
 * three this rig owns are checked against their pins, and the accessor-contract
 * version stays opaque and presence-checked, exactly as A3's cache-key module
 * treats it.
 */
export function appendAttentionLedgerRecord(
  ledger: AttentionLedger,
  input: AttentionLedgerAppendInput,
): AttentionLedgerAppendResult {
  if (!isPresent(ledger.ledgerPolicyVersion)) {
    return { kind: 'refused', reason: 'missing-ledger-policy-version' }
  }
  if (ledger.ledgerPolicyVersion !== ATTENTION_LEDGER_POLICY_VERSION) {
    return { kind: 'refused', reason: 'unsupported-ledger-policy-version' }
  }
  if (!isPresent(input.exposurePolicyVersion)) {
    return { kind: 'refused', reason: 'missing-exposure-policy-version' }
  }
  if (input.exposurePolicyVersion !== ATTENTION_EXPOSURE_POLICY_VERSION) {
    return { kind: 'refused', reason: 'unsupported-exposure-policy-version' }
  }
  if (!isPresent(input.templateChannelPolicyVersion)) {
    return { kind: 'refused', reason: 'missing-template-channel-policy-version' }
  }
  if (input.templateChannelPolicyVersion !== ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION) {
    return { kind: 'refused', reason: 'unsupported-template-channel-policy-version' }
  }
  if (!isPresent(input.templateVersion)) {
    return { kind: 'refused', reason: 'missing-template-version' }
  }
  const expectedTemplateVersion = input.attentionCandidate.sourceKind === 'narrative_pattern_instance'
    ? ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION
    : ATTENTION_TEMPLATE_VERSION
  if (input.templateVersion !== expectedTemplateVersion) {
    return { kind: 'refused', reason: 'unsupported-template-version' }
  }

  const attentionCandidate = input.attentionCandidate
  if (
    attentionCandidate.sourceKind !== 'quest_candidate'
    && attentionCandidate.sourceKind !== 'narrative_pattern_instance'
  ) return { kind: 'refused', reason: 'unsupported-ledger-record-source-kind' }
  if (!isPresent(attentionCandidate.canonicalizationVersion)) {
    return { kind: 'refused', reason: 'missing-canonicalization-version' }
  }
  if (attentionCandidate.canonicalizationVersion !== ATTENTION_CANDIDATE_CANONICALIZATION_VERSION) {
    return { kind: 'refused', reason: 'unsupported-canonicalization-version' }
  }
  if (!isPresent(attentionCandidate.accessorContractVersion)) {
    return { kind: 'refused', reason: 'missing-accessor-contract-version' }
  }
  if (typeof attentionCandidate.rankingSnapshotLsn !== 'number') {
    return { kind: 'refused', reason: 'missing-ranking-snapshot-lsn' }
  }
  if (!isAttentionRankingSnapshotLsnInRange(attentionCandidate.rankingSnapshotLsn)) {
    return { kind: 'refused', reason: 'ranking-snapshot-lsn-out-of-range' }
  }
  if (!isPresent(attentionCandidate.sourceId)) {
    return { kind: 'refused', reason: 'missing-source-id' }
  }
  if (!isPresent(attentionCandidate.candidateId)) {
    return { kind: 'refused', reason: 'missing-candidate-id' }
  }
  if (!SUPPORTED_OUTCOMES.includes(input.outcome)) {
    return { kind: 'refused', reason: 'unsupported-outcome' }
  }

  // A rendered outcome must carry its output identity, and an unrendered one must
  // not: a `presentation-failed` or `non-engagement` record that carried output
  // bytes would misreport that something was presented.
  const carriesOutput = outcomeCarriesOutput(input.outcome)
  if (carriesOutput && !isPresent(input.renderedOutputIdentity)) {
    return { kind: 'refused', reason: 'missing-rendered-output-identity' }
  }
  if (!carriesOutput && input.renderedOutputIdentity !== undefined) {
    return { kind: 'refused', reason: 'unexpected-rendered-output-identity' }
  }

  const isPatternRecord = attentionCandidate.sourceKind === 'narrative_pattern_instance'
  if (isPatternRecord) {
    if (hasOwn(input as unknown as object, 'ledgerPolicyVersion')) {
      return { kind: 'refused', reason: 'mixed-ledger-record-branch' }
    }
    if (!isPresent(input.patternPresentationLedgerPolicyVersion)) {
      return { kind: 'refused', reason: 'missing-pattern-presentation-ledger-policy-version' }
    }
    if (input.patternPresentationLedgerPolicyVersion !== ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION) {
      return { kind: 'refused', reason: 'unsupported-pattern-presentation-ledger-policy-version' }
    }
    if (typeof input.presentationLsn !== 'number') {
      return { kind: 'refused', reason: 'missing-pattern-presentation-lsn' }
    }
    if (!isAttentionRankingSnapshotLsnInRange(input.presentationLsn)) {
      return { kind: 'refused', reason: 'pattern-presentation-lsn-out-of-range' }
    }
    if (!isPresent(input.resourcePolicyVersion)) {
      return { kind: 'refused', reason: 'missing-resource-policy-version' }
    }
    if (input.resourcePolicyVersion !== ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION) {
      return { kind: 'refused', reason: 'unsupported-resource-policy-version' }
    }
  } else if (
    input.patternPresentationLedgerPolicyVersion !== undefined
    || input.presentationLsn !== undefined
    || input.resourcePolicyVersion !== undefined
  ) {
    return { kind: 'refused', reason: 'mixed-ledger-record-branch' }
  }

  const commonFields: Omit<AttentionLedgerRecordBase, 'recordId'> = {
    exposurePolicyVersion: input.exposurePolicyVersion,
    templateChannelPolicyVersion: input.templateChannelPolicyVersion,
    canonicalizationVersion: attentionCandidate.canonicalizationVersion,
    accessorContractVersion: attentionCandidate.accessorContractVersion,
    templateVersion: input.templateVersion,
    sequence: ledger.records.length,
    sourceId: attentionCandidate.sourceId,
    candidateId: attentionCandidate.candidateId,
    rankingSnapshotLsn: attentionCandidate.rankingSnapshotLsn,
    outcome: input.outcome,
    ...(carriesOutput && input.renderedOutputIdentity !== undefined
      ? { renderedOutputIdentity: input.renderedOutputIdentity }
      : {}),
  }
  const fields: AttentionLedgerRecordFields = isPatternRecord
    ? {
        ...commonFields,
        sourceKind: 'narrative_pattern_instance',
        patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
        presentationLsn: input.presentationLsn!,
        resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
      }
    : {
        ...commonFields,
        sourceKind: 'quest_candidate',
        ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION,
      }
  const recordId = ledgerRecordIdentity(fields)

  // The reused proof hash is documented as not collision-resistant, so a repeated
  // identity refuses rather than aliasing two distinct records onto one identity.
  // It is unreachable from the fixture set, because the append position is part of
  // the hashed fields and is strictly increasing; it is kept because the
  // alternative to refusing is a silently ambiguous audit sequence.
  if (ledger.records.some((existing) => existing.recordId === recordId)) {
    return { kind: 'refused', reason: 'duplicate-record-identity' }
  }

  const record: AttentionLedgerRecord = Object.freeze({ ...fields, recordId })

  return {
    kind: 'ok',
    ledger: Object.freeze({
      ledgerPolicyVersion: ledger.ledgerPolicyVersion,
      records: Object.freeze([...ledger.records, record]),
    }),
    record,
  }
}

export type AttentionPatternPresentationPolicyReason =
  | 'eligible'
  | 'retired-exposure'
  | 'retired-revalidation-failure'
  | 'retired-satisfied-age'
  | 'successful-cooldown'
  | 'revalidation-failure-cooldown'
  | 'density-window-full'
  | 'malformed-ledger-history'

export interface AttentionPatternPresentationPolicyDecision {
  readonly eligible: boolean
  readonly reason: AttentionPatternPresentationPolicyReason
  readonly successfulExposureCount: number
  readonly consecutiveRevalidationFailureCount: number
  readonly successfulPresentationsInWindow: number
}

/**
 * B5's only ledger-policy read.  It derives all cooldown, density, and
 * retirement decisions from immutable committed LSN coordinates, receiving its
 * numeric bounds through an explicit policy object rather than reading ambient
 * module state (RN019 §9.3's "a dependency a test cannot vary is a dependency
 * the suite cannot prove participates"). Ordering the relevant records by
 * `(presentationLsn, recordId)` makes reverse input history observationally
 * identical; no wall-clock or approximate scan is involved.
 *
 * The density window is the pattern-only, ledger-wide successful-presentation
 * count (RN019 §8.2): it is never restricted to one candidate id, and it never
 * substitutes a quest `rankingSnapshotLsn` for a missing pattern
 * `presentationLsn` — a quest record can never enter this window at all.
 */
export function evaluateAttentionPatternPresentationPolicy(input: {
  readonly ledger: AttentionLedger
  readonly candidateId: string
  readonly evaluationLsn: number
  readonly satisfiedCompletionLsn?: number
  readonly policy?: AttentionStageBResourcePolicy
}): AttentionPatternPresentationPolicyDecision {
  const policy = input.policy ?? attentionStageBResourcePolicy()
  const deny = (reason: AttentionPatternPresentationPolicyReason, successes: number, failures: number, window: number) =>
    Object.freeze({ eligible: false, reason, successfulExposureCount: successes, consecutiveRevalidationFailureCount: failures, successfulPresentationsInWindow: window })
  if (!isAttentionRankingSnapshotLsnInRange(input.evaluationLsn) || !isPresent(input.candidateId)) {
    return deny('malformed-ledger-history', 0, 0, 0)
  }
  if (new Set(input.ledger.records.map((record) => record.recordId)).size !== input.ledger.records.length) {
    return deny('malformed-ledger-history', 0, 0, 0)
  }
  if (!input.ledger.records.every((record) => isQuestLedgerRecord(record) || isPatternPresentationLedgerRecord(record))) {
    return deny('malformed-ledger-history', 0, 0, 0)
  }
  const allPatternRecords = input.ledger.records.filter(isPatternPresentationLedgerRecord)

  const relevant = allPatternRecords.filter((record) => record.candidateId === input.candidateId)
  const ordered = [...relevant].sort((left, right) => (
    left.presentationLsn! - right.presentationLsn!
    || (left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0)
  ))
  const successful = ordered.filter((record) => outcomeCarriesOutput(record.outcome))
  let consecutiveFailures = 0
  for (const record of ordered) {
    if (outcomeCarriesOutput(record.outcome)) consecutiveFailures = 0
    else if (record.outcome === 'revalidation-failed') consecutiveFailures += 1
  }
  // Global, pattern-only, ledger-wide density: not scoped to `candidateId`.
  const window = allPatternRecords.filter((record) => (
    outcomeCarriesOutput(record.outcome)
    && input.evaluationLsn >= record.presentationLsn!
    && input.evaluationLsn - record.presentationLsn! <= 15
  )).length
  if (input.satisfiedCompletionLsn !== undefined && input.evaluationLsn - input.satisfiedCompletionLsn >= policy.satisfiedPatternRetirementLsns) {
    return deny('retired-satisfied-age', successful.length, consecutiveFailures, window)
  }
  if (successful.length >= policy.maxSuccessfulExposuresPerCandidateId) {
    return deny('retired-exposure', successful.length, consecutiveFailures, window)
  }
  if (consecutiveFailures >= policy.consecutiveRevalidationFailuresBeforeRetirement) {
    return deny('retired-revalidation-failure', successful.length, consecutiveFailures, window)
  }
  const lastSuccessful = successful.at(-1)
  if (lastSuccessful !== undefined && input.evaluationLsn - lastSuccessful.presentationLsn! < policy.successfulPresentationCooldownLsns) {
    return deny('successful-cooldown', successful.length, consecutiveFailures, window)
  }
  const lastFailure = [...ordered].reverse().find((record) => record.outcome === 'revalidation-failed')
  if (lastFailure !== undefined && input.evaluationLsn - lastFailure.presentationLsn! < policy.revalidationFailureCooldownLsns) {
    return deny('revalidation-failure-cooldown', successful.length, consecutiveFailures, window)
  }
  if (window >= policy.successfulPresentationsInWindow) {
    return deny('density-window-full', successful.length, consecutiveFailures, window)
  }
  return Object.freeze({
    eligible: true,
    reason: 'eligible',
    successfulExposureCount: successful.length,
    consecutiveRevalidationFailureCount: consecutiveFailures,
    successfulPresentationsInWindow: window,
  })
}

/**
 * The one sanctioned read of ledger history: the closed, declared feature set for
 * one candidate identity (D13/D17; replay spec L1). Every value is a count or a
 * committed ranking coordinate — never a wall-clock instant (D15) — and no
 * threshold is applied to any of them here, because none is pinned.
 *
 * A `presentation-failed` record is deliberately counted as neither an exposure
 * nor a non-engagement: replay spec T6 requires a rendering failure to stay
 * distinct from a player's non-engagement, and D17 keeps non-engagement
 * ledger-only rather than treating it as world evidence.
 */
export function attentionLedgerFeatures(
  ledger: AttentionLedger,
  candidateId: string,
): AttentionLedgerFeatures {
  const forCandidate = ledger.records.filter((record) => (
    isQuestLedgerRecord(record) && record.candidateId === candidateId
  ))
  const presented = forCandidate.filter((record) => outcomeCarriesOutput(record.outcome))
  const lastPresented = presented[presented.length - 1]

  return Object.freeze({
    exposureCount: presented.length,
    repetitionCount: presented.length === 0 ? 0 : presented.length - 1,
    nonEngagementCount: forCandidate.filter((record) => record.outcome === 'non-engagement').length,
    lastPresentedRankingSnapshotLsn: lastPresented === undefined ? null : lastPresented.rankingSnapshotLsn,
  })
}
