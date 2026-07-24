/**
 * Stage A / A5 — the canonical `AttentionTrace`: the complete, deterministic,
 * byte-comparable record of one replay pass, and its canonical identity.
 * Proof-local to `domain/livingWorldProof`; not a production module,
 * reducer, event, persistence contract, or telemetry surface.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D19 P3 "the complete player-observable attention trace"; D11 the
 *    player-observable/engine-only partition; D15 two-clock revalidation);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§5 "Required trace output — the conceptual AttentionTrace"; §10 the
 *    A′-equivalence premise check; §13 full-pipeline determinism);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§8 "1. ATTENTIONTRACE"; §9 A5 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * **What this module is.** A pure builder over already-computed Stage A
 * pipeline output. It imports no A1 contracts, no A1 accessor, and no A2
 * boundary — every field it records was already produced, checked, and
 * frozen by an earlier slice; this module only assembles and canonically
 * identifies the result. It performs no admission, normalization, ordering,
 * rendering, or ledger-append decision of its own.
 *
 * **Field set is closed and versioned.** Every Stage A policy version this
 * replay ran under is recorded explicitly (never re-derived or defaulted),
 * so a trace is self-describing: replaying it later under a different
 * version is visibly a different trace, never a silent reinterpretation.
 *
 * **The player-observable subtrace (D11/P3).** It is the candidate-presence,
 * ordering, timing (LSN-based, never wall-clock-latency), and presented-output
 * projection of the full trace — exactly the P3 comparison surface, with
 * nothing internal-only mixed in. B4 adds real engine-only material to the
 * trusted trace — the `sourceKind` discriminator, the complete nine-key
 * ordering evidence, structural-retention decisions, and
 * `resource_limit_exceeded` diagnostics — and every one of those stays a
 * top-level trusted field. D11 classes `resource_limit_exceeded` engine-only,
 * so none of it may reach this projection, whose bytes remain exactly the
 * committed Stage A golden's.
 *
 * Determinism: the trace is a plain frozen value built from already-frozen
 * inputs; canonical identity reuses the proof rig's key-sorting
 * `canonicalSerialize`/`mintHash`, exactly as every earlier Stage A slice
 * does. No wall clock, RNG, random UUID, process counter, or object identity
 * participates.
 */
import { canonicalSerialize, mintHash } from './canonicalSerialization'
import type { AttentionRevealResultTag } from './attentionRevealPackage'

/**
 * **Two schemas, versioned separately (RN019 §9.6).** The trusted/internal trace
 * changes shape at B4 — its ordering evidence widens from the narrower Stage A
 * projection to the complete nine-key tuple, it gains a `sourceKind`
 * discriminator, and it gains structural-retention and resource diagnostics —
 * so it is bumped to v2 in the same slice that changes it. The
 * player-observable projection is versioned independently and frozen: its shape
 * *and bytes* remain byte-identical to the committed Stage A golden, so the two
 * can never drift silently again.
 *
 * A future trusted-trace shape change bumps only the trusted version; a change
 * to the observable projection is a Stage A compatibility break requiring its
 * own decision.
 */
export const ATTENTION_TRACE_SCHEMA_VERSION = 'attention-trace-schema-v2' as const

/** The frozen player-observable projection schema (RN019 §9.6). Its bytes do not move. */
export const ATTENTION_OBSERVABLE_TRACE_SCHEMA_VERSION = 'attention-observable-trace-schema-v1' as const

/** The closed ledger-outcome vocabulary the trace records, restated locally so this module needs no ledger import beyond the type it already re-exports the same values for. */
export type AttentionTraceLedgerOutcome = AttentionRevealResultTag | 'non-engagement'

/** The two candidate families, restated locally so this module needs no candidate import. */
export type AttentionTraceSourceKind = 'quest_candidate' | 'narrative_pattern_instance'

/**
 * The closed order/tie-break key vocabulary A3's ordering module defines,
 * restated locally exactly as `AttentionTraceLedgerOutcome` above restates
 * the ledger's own outcome vocabulary — so this module still needs no import
 * beyond `attentionRevealPackage` and `canonicalSerialization`. The **nine**
 * literals are structurally identical to `attentionCandidateOrdering.ts`'s own
 * `AttentionCandidateOrderingKey`, so a caller that already has one of those
 * values may assign it here directly, with no cast.
 */
export type AttentionTraceOrderingKey =
  | 'eligibility'
  | 'proof-score'
  | 'source-kind'
  | 'semantic-version'
  | 'canonical-binding-tuple'
  | 'canonical-supporting-record-identity-tuple'
  | 'source-committed-lsn'
  | 'source-id'
  | 'candidate-id'

/** The nine ordering keys, in the exact sequence the comparator applies them. */
export const ATTENTION_TRACE_ORDERING_KEYS: readonly AttentionTraceOrderingKey[] = Object.freeze([
  'eligibility',
  'proof-score',
  'source-kind',
  'semantic-version',
  'canonical-binding-tuple',
  'canonical-supporting-record-identity-tuple',
  'source-committed-lsn',
  'source-id',
  'candidate-id',
])

/** One candidate's value at one ordering key. Trusted trace v2 records all nine per candidate. */
export interface AttentionTraceOrderingKeyValue {
  readonly key: AttentionTraceOrderingKey
  readonly value: string
}

/** Fields both trusted candidate-entry branches share (RN019 §9.6). */
export interface AttentionTraceCandidateEntryCommon {
  readonly sourceKind: AttentionTraceSourceKind
  readonly sourceId: string
  readonly candidateId: string
  readonly sourceCommittedLsn: number
  readonly orderingKeyValues: readonly AttentionTraceOrderingKeyValue[]
}

/** The quest branch. `openingProvenanceId` and `openedAtLsn` exist only here. */
export type AttentionTraceQuestCandidateEntry = AttentionTraceCandidateEntryCommon & {
  readonly sourceKind: 'quest_candidate'
  readonly openingProvenanceId: string
  readonly openedAtLsn: number
}

/**
 * The pattern branch. Its `sourceId` **is** the `patternInstanceId`; no pattern
 * value is ever written into a quest-named field such as `openingProvenanceId`,
 * and there is no family-specific sentinel in either direction.
 */
export type AttentionTracePatternCandidateEntry = AttentionTraceCandidateEntryCommon & {
  readonly sourceKind: 'narrative_pattern_instance'
  readonly patternInstanceId: string
  readonly patternSemanticVersion: number
  readonly canonicalBindingTuple: readonly (readonly [string, string])[]
  readonly canonicalSupportingRecordIdentityTuple:
    readonly (readonly [string, string, string, string, number])[]
  readonly lastProgressLsn: number
}

/** The `sourceKind`-discriminated trusted candidate entry (RN019 §9.6). */
export type AttentionTraceCandidateEntry =
  | AttentionTraceQuestCandidateEntry
  | AttentionTracePatternCandidateEntry

/** Own keys legal only on the quest branch. */
const QUEST_ONLY_ENTRY_KEYS: readonly string[] = Object.freeze([
  'openingProvenanceId',
  'openedAtLsn',
])

/** Own keys legal only on the pattern branch. */
const PATTERN_ONLY_ENTRY_KEYS: readonly string[] = Object.freeze([
  'patternInstanceId',
  'patternSemanticVersion',
  'canonicalBindingTuple',
  'canonicalSupportingRecordIdentityTuple',
  'lastProgressLsn',
])

/**
 * One engine-only resource-limit diagnostic, carried into trusted trace v2
 * (RN019 §8.3/§9.6). It is trusted-only, deterministic, non-authoritative, and
 * not identity-affecting: no value here reaches a pattern-instance ID or a
 * candidate ID, nothing is appended to or read back from the world log, and it
 * is not B5 presentation history — it describes this evaluation's structural
 * retention, not exposure, cooldown, or retirement.
 */
export interface AttentionTraceResourceLimitEntry {
  readonly boundId: string
  readonly patternType: string | null
  readonly configuredValue: number
  readonly observedValue: number
  readonly retainedIds: readonly string[]
  readonly droppedIds: readonly string[]
}

/**
 * The structural-retention and resource evidence trusted trace v2 carries. Every
 * identity collection is emitted in the canonical retention order the resource
 * policy applied, so the sets are replayable and byte-stable under reversed
 * input order. None of it appears in the player-observable projection.
 */
export interface AttentionTraceStructuralRetention {
  readonly retainedPatternInstanceIds: readonly string[]
  readonly droppedPatternInstanceIds: readonly string[]
  readonly mixedFamilyRetainedCandidateIds: readonly string[]
  readonly mixedFamilyDroppedCandidateIds: readonly string[]
  readonly resourceLimits: readonly AttentionTraceResourceLimitEntry[]
}

/** An empty structural-retention record, for a pass in which no bound bound. */
export function emptyAttentionTraceStructuralRetention(): AttentionTraceStructuralRetention {
  return Object.freeze({
    retainedPatternInstanceIds: Object.freeze([]),
    droppedPatternInstanceIds: Object.freeze([]),
    mixedFamilyRetainedCandidateIds: Object.freeze([]),
    mixedFamilyDroppedCandidateIds: Object.freeze([]),
    resourceLimits: Object.freeze([]),
  })
}

/**
 * Build one trusted resource-limit trace entry from a resource decision. A pure
 * copy: it reads the decision's already-frozen identity sets and neither mutates
 * nor re-orders them, so the canonical retention order the policy applied is the
 * order that reaches the trace.
 */
export function attentionTraceResourceLimitEntry(input: {
  readonly boundId: string
  readonly patternType?: string | null
  readonly configuredValue: number
  readonly observedValue: number
  readonly retainedIds: readonly string[]
  readonly droppedIds: readonly string[]
}): AttentionTraceResourceLimitEntry {
  return Object.freeze({
    boundId: input.boundId,
    patternType: input.patternType ?? null,
    configuredValue: input.configuredValue,
    observedValue: input.observedValue,
    retainedIds: Object.freeze([...input.retainedIds]),
    droppedIds: Object.freeze([...input.droppedIds]),
  })
}

/**
 * One adjacent-pair comparison from the ordered candidate sequence (D14).
 * Adjacent-pair coverage is what makes A3's own totality proof sound
 * (`attentionCandidateOrdering.ts`'s own doc comment): in a sorted sequence,
 * two entries compare equal somewhere if and only if some adjacent pair
 * does, so recording every adjacent pair records the complete tie-break
 * path, not a sample of it. `evaluatedKeys` is the prefix of the full
 * ordering-key sequence that was actually checked before `decidingKey`
 * stopped the comparison — never the complete nine-key table regardless of
 * where it decided, so a reader can see the short-circuit, not merely infer
 * it. Every value here is already legally-visible candidate ordering data
 * (eligibility, fixed score, source-kind rank, semantic version, canonical
 * tuples, the numeric committed LSN, source id, candidate id); no raw
 * `QuestCandidate` field or private provenance is reachable through it.
 */
export interface AttentionTraceOrderingComparisonEntry {
  readonly leftCandidateId: string
  readonly rightCandidateId: string
  readonly evaluatedKeys: readonly AttentionTraceOrderingKey[]
  readonly decidingKey: AttentionTraceOrderingKey
  readonly leftValue: string
  readonly rightValue: string
  readonly result: 'left-first' | 'right-first' | 'tie'
}

export interface AttentionTracePresentationEntry {
  readonly candidateId: string
  readonly resultTag: AttentionRevealResultTag
  readonly output?: string
  readonly outputIdentity?: string
  readonly ledgerOutcome: AttentionTraceLedgerOutcome
  readonly ledgerRecordId: string
}

export type AttentionTraceRevalidationOutcome = 'still-legal' | 'candidate-disappeared' | 'stale-snapshot'

export interface AttentionTraceRevalidationEntry {
  readonly candidateId: string
  readonly outcome: AttentionTraceRevalidationOutcome
}

/**
 * The A′-equivalence premise-check result, present only for paired-world (P3)
 * fixtures. From B4 the digests cover the complete v2 surface — all three
 * collections — and the opening-coordinate identity sets are compared
 * independently alongside the quest-view identity sets, so two worlds differing
 * only in a sidecar are not Stage B-readable-equivalent (RN019 §4.3, §10.3).
 */
export interface AttentionTraceP3PremiseCheck {
  readonly leftAPrimeDigest: string
  readonly rightAPrimeDigest: string
  readonly leftViewIdentities: readonly string[]
  readonly rightViewIdentities: readonly string[]
  readonly leftOpeningCoordinateIdentities: readonly string[]
  readonly rightOpeningCoordinateIdentities: readonly string[]
  readonly equivalent: boolean
}

export interface AttentionTraceInput {
  readonly replayCaseId: string
  readonly accessorContractVersion: string
  readonly canonicalizationVersion: string
  readonly identitySchemaVersion: string
  readonly orderingVersion: string
  readonly derivationCacheKeySchemaVersion: string
  readonly rankingCacheKeySchemaVersion: string
  readonly templateVersion: string
  readonly templateChannelPolicyVersion: string
  readonly exposurePolicyVersion: string
  readonly ledgerPolicyVersion: string
  readonly rankingSnapshotLsn: number
  readonly revalidationSnapshotLsn: number
  readonly admittedQuestCandidateSourceIds: readonly string[]
  readonly orderedAttentionCandidates: readonly AttentionTraceCandidateEntry[]
  /**
   * The complete adjacent-pair order/tie-break path over
   * `orderedAttentionCandidates`, at ranking time (D12 step 8, before
   * revalidation) — not restricted to the placement decision, spelled out
   * below. Empty when fewer than two candidates were ordered (a single
   * candidate or none has no adjacent pair to record; not a refusal).
   *
   * **Placement decision.** This field is deliberately a top-level trace
   * field, not part of `playerObservable` below. D19 P3's closed
   * observable-comparison list (replay spec §10) names "ordering" — the
   * resulting sequence, already carried by `orderedCandidateIds` inside
   * `playerObservable` — but never names the tie-break *mechanism* (which
   * key decided each adjacent comparison) as part of the player-observable
   * surface; D11's closed engine-only-diagnostic vocabulary does not name it
   * either. It is therefore full-trace evidence (D20 item 5's whole-trace
   * determinism obligation, and D14's own "record the full tie-break path in
   * the trace" requirement, replay spec §13.1(d)), compared as part of the
   * complete canonical trace bytes, but not part of the narrower P3
   * observable-subtrace comparison surface.
   */
  readonly orderingTrace: readonly AttentionTraceOrderingComparisonEntry[]
  /**
   * B4 / RN019 §9.6 — the structural-retention and resource-limit evidence for
   * this pass. Trusted-only: it is a top-level trace field and never enters
   * `playerObservable` below, because D11 classes `resource_limit_exceeded` as
   * engine-only.
   */
  readonly structuralRetention: AttentionTraceStructuralRetention
  readonly presentations: readonly AttentionTracePresentationEntry[]
  readonly revalidations: readonly AttentionTraceRevalidationEntry[]
  readonly authoritativeLogDigestBefore: string
  readonly authoritativeLogDigestAfter: string
  readonly p3PremiseCheck?: AttentionTraceP3PremiseCheck
}

/**
 * The player-observable comparison surface (D11/P3): presence, ordering,
 * timing, visible output — never an internal-only diagnostic.
 *
 * **Frozen at `attention-observable-trace-schema-v1`.** Its field set and its
 * canonical bytes are exactly the committed Stage A projection's: no
 * pattern-only field, no resource diagnostic, no trusted ordering table, and no
 * schema-version field of its own (the pin is carried as a top-level trusted
 * trace field, precisely so adding it cannot move these bytes).
 */
export interface AttentionTracePlayerObservableSubtrace {
  readonly rankingSnapshotLsn: number
  readonly revalidationSnapshotLsn: number
  readonly orderedCandidateIds: readonly string[]
  readonly presentations: readonly {
    readonly candidateId: string
    readonly resultTag: AttentionRevealResultTag
    readonly output?: string
  }[]
  readonly revalidations: readonly AttentionTraceRevalidationEntry[]
}

/**
 * An intersection, not `interface ... extends`: the latter syntax is exactly
 * the "shared base interfaces / aliasing" bypass vector `attentionLedger
 * StaticClosure.test.ts` closes for every Stage A module (D19 P1), and its
 * scan cannot distinguish an extension of an authoritative interface from an
 * extension of this module's own proof-local one — so this module simply
 * never uses the syntax at all.
 */
export type AttentionTrace = AttentionTraceInput & {
  readonly schemaVersion: string
  readonly observableTraceSchemaVersion: string
  readonly traceIdentity: string
  readonly playerObservable: AttentionTracePlayerObservableSubtrace
}

export type AttentionTraceRefusal =
  | 'missing-replay-case-id'
  | 'missing-accessor-contract-version'
  | 'missing-canonicalization-version'
  | 'missing-identity-schema-version'
  | 'missing-ordering-version'
  | 'missing-derivation-cache-key-schema-version'
  | 'missing-ranking-cache-key-schema-version'
  | 'missing-template-version'
  | 'missing-template-channel-policy-version'
  | 'missing-exposure-policy-version'
  | 'missing-ledger-policy-version'
  | 'missing-ranking-snapshot-lsn'
  | 'missing-revalidation-snapshot-lsn'
  | 'missing-authoritative-log-digest-before'
  | 'missing-authoritative-log-digest-after'
  | 'missing-structural-retention'
  | 'mixed-trace-candidate-entry'

export type AttentionTraceResult =
  | { readonly kind: 'ok'; readonly trace: AttentionTrace }
  | { readonly kind: 'refused'; readonly reason: AttentionTraceRefusal }

function isPresent(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/**
 * The discriminated-entry guard (RN019 §9.6). A structurally mixed entry — a
 * quest branch carrying pattern fields, or a pattern branch carrying quest
 * fields — refuses, as does an entry missing a field its own branch requires.
 * There is no quest-named sentinel for pattern candidates and no pattern-named
 * sentinel for quest candidates in either direction.
 */
function isWellFormedCandidateEntry(entry: AttentionTraceCandidateEntry): boolean {
  if (typeof entry !== 'object' || entry === null) return false
  if (!isPresent(entry.sourceId) || !isPresent(entry.candidateId)) return false
  if (!Number.isSafeInteger(entry.sourceCommittedLsn) || entry.sourceCommittedLsn < 0) return false
  if (!Array.isArray(entry.orderingKeyValues)) return false
  if (entry.orderingKeyValues.length !== ATTENTION_TRACE_ORDERING_KEYS.length) return false
  if (entry.orderingKeyValues.some((value, index) => value.key !== ATTENTION_TRACE_ORDERING_KEYS[index])) {
    return false
  }

  if (entry.sourceKind === 'quest_candidate') {
    if (PATTERN_ONLY_ENTRY_KEYS.some((key) => hasOwn(entry, key))) return false
    if (QUEST_ONLY_ENTRY_KEYS.some((key) => !hasOwn(entry, key))) return false
    if (!isPresent(entry.openingProvenanceId)) return false
    return Number.isSafeInteger(entry.openedAtLsn) && entry.openedAtLsn >= 0
  }
  if (entry.sourceKind === 'narrative_pattern_instance') {
    if (QUEST_ONLY_ENTRY_KEYS.some((key) => hasOwn(entry, key))) return false
    if (PATTERN_ONLY_ENTRY_KEYS.some((key) => !hasOwn(entry, key))) return false
    if (!isPresent(entry.patternInstanceId)) return false
    if (entry.patternInstanceId !== entry.sourceId) return false
    if (!Number.isSafeInteger(entry.patternSemanticVersion)) return false
    if (!Array.isArray(entry.canonicalBindingTuple)) return false
    if (!Array.isArray(entry.canonicalSupportingRecordIdentityTuple)) return false
    return Number.isSafeInteger(entry.lastProgressLsn) && entry.lastProgressLsn >= 0
  }
  // An entry whose `sourceKind` is neither family is ambiguous by construction.
  return false
}

function playerObservableSubtrace(input: AttentionTraceInput): AttentionTracePlayerObservableSubtrace {
  return Object.freeze({
    rankingSnapshotLsn: input.rankingSnapshotLsn,
    revalidationSnapshotLsn: input.revalidationSnapshotLsn,
    orderedCandidateIds: Object.freeze(input.orderedAttentionCandidates.map((entry) => entry.candidateId)),
    presentations: Object.freeze(input.presentations.map((entry) => Object.freeze({
      candidateId: entry.candidateId,
      resultTag: entry.resultTag,
      ...(entry.output === undefined ? {} : { output: entry.output }),
    }))),
    revalidations: Object.freeze([...input.revalidations]),
  })
}

/**
 * Build the complete `AttentionTrace` for one replay pass. Every version
 * coordinate is checked present, in declared order, and none is defaulted —
 * a caller that cannot name what it ran under has not produced a trace at
 * all (ADR-0013 D15 "Missing versions refuse"; replay spec §22 K3).
 */
export function buildAttentionTrace(input: AttentionTraceInput): AttentionTraceResult {
  if (!isPresent(input.replayCaseId)) return { kind: 'refused', reason: 'missing-replay-case-id' }
  if (!isPresent(input.accessorContractVersion)) return { kind: 'refused', reason: 'missing-accessor-contract-version' }
  if (!isPresent(input.canonicalizationVersion)) return { kind: 'refused', reason: 'missing-canonicalization-version' }
  if (!isPresent(input.identitySchemaVersion)) return { kind: 'refused', reason: 'missing-identity-schema-version' }
  if (!isPresent(input.orderingVersion)) return { kind: 'refused', reason: 'missing-ordering-version' }
  if (!isPresent(input.derivationCacheKeySchemaVersion)) {
    return { kind: 'refused', reason: 'missing-derivation-cache-key-schema-version' }
  }
  if (!isPresent(input.rankingCacheKeySchemaVersion)) {
    return { kind: 'refused', reason: 'missing-ranking-cache-key-schema-version' }
  }
  if (!isPresent(input.templateVersion)) return { kind: 'refused', reason: 'missing-template-version' }
  if (!isPresent(input.templateChannelPolicyVersion)) {
    return { kind: 'refused', reason: 'missing-template-channel-policy-version' }
  }
  if (!isPresent(input.exposurePolicyVersion)) return { kind: 'refused', reason: 'missing-exposure-policy-version' }
  if (!isPresent(input.ledgerPolicyVersion)) return { kind: 'refused', reason: 'missing-ledger-policy-version' }
  if (typeof input.rankingSnapshotLsn !== 'number') return { kind: 'refused', reason: 'missing-ranking-snapshot-lsn' }
  if (typeof input.revalidationSnapshotLsn !== 'number') {
    return { kind: 'refused', reason: 'missing-revalidation-snapshot-lsn' }
  }
  if (!isPresent(input.authoritativeLogDigestBefore)) {
    return { kind: 'refused', reason: 'missing-authoritative-log-digest-before' }
  }
  if (!isPresent(input.authoritativeLogDigestAfter)) {
    return { kind: 'refused', reason: 'missing-authoritative-log-digest-after' }
  }
  if (input.structuralRetention === undefined || input.structuralRetention === null) {
    return { kind: 'refused', reason: 'missing-structural-retention' }
  }
  if (!input.orderedAttentionCandidates.every(isWellFormedCandidateEntry)) {
    return { kind: 'refused', reason: 'mixed-trace-candidate-entry' }
  }

  const withoutIdentity = {
    ...input,
    schemaVersion: ATTENTION_TRACE_SCHEMA_VERSION,
    observableTraceSchemaVersion: ATTENTION_OBSERVABLE_TRACE_SCHEMA_VERSION,
    playerObservable: playerObservableSubtrace(input),
  }

  const traceIdentity = ATTENTION_TRACE_SCHEMA_VERSION + ':' + mintHash(canonicalSerialize(withoutIdentity))

  return {
    kind: 'ok',
    trace: Object.freeze({ ...withoutIdentity, traceIdentity }),
  }
}

/** The complete canonical bytes of a built trusted trace — exported for byte-comparison evidence. */
export function canonicalAttentionTraceBytes(trace: AttentionTrace): string {
  return canonicalSerialize(trace)
}

/**
 * The canonical bytes of the player-observable projection alone, under its own
 * frozen `attention-observable-trace-schema-v1` — the exact surface the Stage A
 * golden pins and the P3 comparison compares.
 */
export function canonicalAttentionObservableTraceBytes(trace: AttentionTrace): string {
  return canonicalSerialize(trace.playerObservable)
}
