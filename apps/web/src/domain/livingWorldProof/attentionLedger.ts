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
  ATTENTION_TEMPLATE_CHANNEL_POLICY_VERSION,
  ATTENTION_TEMPLATE_VERSION,
  isAttentionRankingSnapshotLsnInRange,
} from './attentionCandidatePolicy'
import type { AttentionCandidateSourceKind } from './attentionCandidatePolicy'
import type { AttentionCandidate } from './attentionCandidate'
import type { AttentionRevealResultTag } from './attentionRevealPackage'

/**
 * The closed outcome vocabulary: the three presentation results (plan §7) plus
 * player non-engagement, which D17 keeps ledger-only and which §26 T6 requires be
 * distinct from a rendering failure. Reusing `AttentionRevealResultTag` keeps one
 * presentation vocabulary rather than a second copy that could drift from it.
 */
export type AttentionLedgerOutcome = AttentionRevealResultTag | 'non-engagement'

/** The outcomes that count as an exposure — a reveal actually rendered. */
const PRESENTED_OUTCOMES: readonly AttentionLedgerOutcome[] = Object.freeze([
  'presentation-ready',
  'presentation-fallback',
])

/** The outcomes that carry rendered output, and therefore an output identity. */
function outcomeCarriesOutput(outcome: AttentionLedgerOutcome): boolean {
  return PRESENTED_OUTCOMES.includes(outcome)
}

/** One immutable ledger record. The field set is closed. */
export interface AttentionLedgerRecord {
  readonly ledgerPolicyVersion: string
  readonly exposurePolicyVersion: string
  readonly templateChannelPolicyVersion: string
  readonly canonicalizationVersion: string
  readonly accessorContractVersion: string
  readonly templateVersion: string
  readonly sequence: number
  readonly recordId: string
  readonly sourceKind: AttentionCandidateSourceKind
  readonly sourceId: string
  readonly candidateId: string
  readonly rankingSnapshotLsn: number
  readonly outcome: AttentionLedgerOutcome
  readonly renderedOutputIdentity?: string
}

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
])

function isPresent(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
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
function ledgerRecordIdentity(fields: Omit<AttentionLedgerRecord, 'recordId'>): string {
  return ATTENTION_LEDGER_POLICY_VERSION + ':' + mintHash(canonicalSerialize(fields))
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
  if (input.templateVersion !== ATTENTION_TEMPLATE_VERSION) {
    return { kind: 'refused', reason: 'unsupported-template-version' }
  }

  const attentionCandidate = input.attentionCandidate
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

  const fields: Omit<AttentionLedgerRecord, 'recordId'> = {
    ledgerPolicyVersion: ledger.ledgerPolicyVersion,
    exposurePolicyVersion: input.exposurePolicyVersion,
    templateChannelPolicyVersion: input.templateChannelPolicyVersion,
    canonicalizationVersion: attentionCandidate.canonicalizationVersion,
    accessorContractVersion: attentionCandidate.accessorContractVersion,
    templateVersion: input.templateVersion,
    sequence: ledger.records.length,
    sourceKind: attentionCandidate.sourceKind,
    sourceId: attentionCandidate.sourceId,
    candidateId: attentionCandidate.candidateId,
    rankingSnapshotLsn: attentionCandidate.rankingSnapshotLsn,
    outcome: input.outcome,
    ...(carriesOutput && input.renderedOutputIdentity !== undefined
      ? { renderedOutputIdentity: input.renderedOutputIdentity }
      : {}),
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
  const forCandidate = ledger.records.filter((record) => record.candidateId === candidateId)
  const presented = forCandidate.filter((record) => outcomeCarriesOutput(record.outcome))
  const lastPresented = presented[presented.length - 1]

  return Object.freeze({
    exposureCount: presented.length,
    repetitionCount: presented.length === 0 ? 0 : presented.length - 1,
    nonEngagementCount: forCandidate.filter((record) => record.outcome === 'non-engagement').length,
    lastPresentedRankingSnapshotLsn: lastPresented === undefined ? null : lastPresented.rankingSnapshotLsn,
  })
}
