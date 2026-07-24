/**
 * Stage A / A3 — the two deterministic cache-key derivations required by
 * ADR-0013 D15. Proof-local to `domain/livingWorldProof`; not a production
 * module, reducer, event, or persistence contract.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D15 "derivation and ranking caches are separately keyed"; D6 identity is
 *    disjoint from ranking-only policy);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§4 declared replay inputs, §22 "Cache and policy-mismatch fixtures"
 *    K1-K3);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6 "View-cache identity includes ... Ranking-cache identity additionally
 *    includes ... Missing versions refuse. A ranking-only policy change
 *    invalidates ranking, not candidate identity."; §9 A3 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * **This module derives keys and nothing else.** There is no cache here: no
 * store, no map, no entry, no lookup, no read-through, no write-through, no
 * eviction, no expiry, no warming, and no persistence. A key is a pure string
 * function of declared inputs, which is exactly what D15 needs in order for a
 * later, separately approved slice to be able to prove that a stale value is
 * never reused. Nothing in the Stage A path calls these functions in production.
 *
 * **Dependencies are explicit typed values, never ambient module constants read
 * behind the caller's back (RN019 §9.3).** A dependency a test cannot vary is a
 * dependency the suite cannot prove participates. Both canonical key functions
 * therefore *receive* their complete dependency bundle as a parameter and
 * serialize every field of it. A default bundle built from this rig's pinned
 * constants is available for ordinary call sites, but the key functions never
 * reach for a module-level constant themselves — so every one of the thirteen
 * derivation dependencies and every ranking-only dependency is independently
 * variable under test.
 *
 * Two key classes:
 *
 *  - the **derivation** key covers exactly the closed thirteen-field RN019 §9.3
 *    derivation dependency bundle, in its declared order;
 *  - the **ranking** key is exactly the complete derivation key embedded whole,
 *    plus the ordering version, the ranking-policy hash, and the B4-owned
 *    eligibility/resource state.
 *
 * The ranking key embeds the derivation key as a component rather than
 * re-listing its parts. That is what makes "anything that invalidates derivation
 * also invalidates ranking" structural instead of a property a reviewer has to
 * re-derive from two parallel field lists — while the converse stays false by
 * construction, which is D15's "a re-weighting must not invalidate cached
 * candidate derivation" and D6's identity/ranking disjointness.
 *
 * **No B5 dependency lives here.** At B4 the ranking bundle carries no exposure,
 * cooldown, retirement, ledger, presentation-history, relevant-ledger-input, or
 * template/package dependency. Those belong to B5 and are added when B5 owns the
 * behavior they key; adding one early would key every cached value to a policy
 * this slice does not implement.
 *
 * The versions this rig itself owns — canonicalization, quest and pattern
 * candidate identity schema, surface schema, sidecar contract, ordering — are
 * validated against their pins, because this rig cannot honestly key a
 * derivation to a rule it does not implement. Hashes and the pattern-instance
 * identity/monitor coordinates are carried as opaque required values: the module
 * that owns each already enforces what it will serve, and the cache key's job is
 * to record *which* value produced the cached result so that a change to it
 * invalidates the key whether or not this build still supports it.
 *
 * Determinism: the canonical input is rebuilt as a closed record with keys
 * written in canonical order and serialized by the proof rig's deep key-sorting
 * `canonicalSerialize`, so construction and property-insertion order cannot
 * reach the bytes. No RNG, wall clock, random UUID, process-local counter,
 * object identity, locale comparison, or map/set iteration order participates,
 * and no input object is mutated.
 */
import { canonicalSerialize, mintHash } from './canonicalSerialization'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_ORDERING_VERSION,
  ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION,
  ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
  ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
  ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  isAttentionRankingSnapshotLsnInRange,
} from './attentionCandidatePolicy'
import {
  ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
  ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
} from './attentionReadableBoundary'
import { ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION } from './attentionPatternEvidenceContracts'
import { ATTENTION_NARRATIVE_PATTERN_LIBRARY_HASH } from './attentionNarrativePatternLibrary'
import {
  ATTENTION_NARRATIVE_PATTERN_POLICY_HASH,
  ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
  attentionStageBResourcePolicy,
} from './attentionNarrativePatternResourcePolicy'

/**
 * RN019 §9.3's closed derivation dependency bundle: exactly these thirteen
 * fields, in exactly this order. One typed, deeply immutable record; the
 * canonical derivation-key function receives it explicitly and serializes every
 * field.
 *
 * Why three separate identity-schema fields rather than one:
 * `questCandidateIdentitySchemaVersion` is present because quest candidate
 * derivation and cache validity depend on its canonical identity schema exactly
 * as the pattern branches depend on theirs; omitting it would leave one
 * family's identity-schema dependency untracked while the other two are
 * tracked. `patternInstanceIdentitySchemaVersion` and
 * `patternCandidateIdentitySchemaVersion` stay distinct because they identify
 * two different derived layers — the reconstructed instance and the normalized
 * candidate — and a change to one must not be conflated with a change to the
 * other. `attentionReadableSurfaceSchemaVersion` is present because the
 * canonical A-prime premise shape moves from v1 to v2 at B4, and a derivation
 * key that cannot see that change is not sound across it.
 */
export interface AttentionCandidateDerivationDependencyBundle {
  readonly questAccessorContractVersion: string
  readonly questOpeningCoordinateContractVersion: string
  readonly patternEvidenceAccessorContractVersion: string
  readonly attentionReadableSurfaceSchemaVersion: string
  readonly snapshotLsn: number
  readonly patternLibraryHash: string
  readonly patternPolicyHash: string
  readonly monitorRuleVersion: string
  readonly canonicalizationVersion: string
  readonly questCandidateIdentitySchemaVersion: string
  readonly patternInstanceIdentitySchemaVersion: string
  readonly patternCandidateIdentitySchemaVersion: string
  readonly resourcePolicyVersion: string
}

/** The thirteen derivation-bundle field names, in RN019 §9.3's declared order. */
export const ATTENTION_CANDIDATE_DERIVATION_DEPENDENCY_FIELDS: readonly string[] = Object.freeze([
  'questAccessorContractVersion',
  'questOpeningCoordinateContractVersion',
  'patternEvidenceAccessorContractVersion',
  'attentionReadableSurfaceSchemaVersion',
  'snapshotLsn',
  'patternLibraryHash',
  'patternPolicyHash',
  'monitorRuleVersion',
  'canonicalizationVersion',
  'questCandidateIdentitySchemaVersion',
  'patternInstanceIdentitySchemaVersion',
  'patternCandidateIdentitySchemaVersion',
  'resourcePolicyVersion',
])

/**
 * The B4-owned eligibility/resource state the ranking key depends on and the
 * derivation key deliberately does not. It is ranking-only policy: changing it
 * moves the ranking key while leaving the derivation key, the pattern-instance
 * identity, and every candidate identity exactly where they were (ADR-0013 D6).
 *
 * It carries no exposure, cooldown, retirement, ledger, presentation-history, or
 * template coordinate — those are B5's.
 */
export interface AttentionCandidateRankingEligibilityResourceState {
  readonly mixedFamilyCandidateCap: number
  readonly retentionClassOrder: readonly string[]
  readonly rankableClasses: readonly string[]
}

/** RN019 §9.3's ranking dependency bundle: the derivation bundle plus exactly three ranking-only members. */
export interface AttentionCandidateRankingDependencyBundle {
  readonly derivation: AttentionCandidateDerivationDependencyBundle
  readonly orderingVersion: string
  readonly rankingPolicyHash: string
  readonly eligibilityResourceState: AttentionCandidateRankingEligibilityResourceState
}

/**
 * A default derivation bundle built from this rig's pinned constants, for
 * ordinary call sites. It is a convenience for callers, never a fallback inside
 * the key functions: `snapshotLsn` has no pin and must always be supplied, and
 * every other field may be overridden so a test can vary exactly one dependency
 * at a time.
 */
export function attentionCandidateDerivationDependencyBundle(
  input: { readonly snapshotLsn: number } & Partial<AttentionCandidateDerivationDependencyBundle>,
): AttentionCandidateDerivationDependencyBundle {
  return Object.freeze({
    questAccessorContractVersion:
      input.questAccessorContractVersion ?? ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    questOpeningCoordinateContractVersion:
      input.questOpeningCoordinateContractVersion ?? ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
    patternEvidenceAccessorContractVersion:
      input.patternEvidenceAccessorContractVersion ?? ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
    attentionReadableSurfaceSchemaVersion:
      input.attentionReadableSurfaceSchemaVersion ?? ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
    snapshotLsn: input.snapshotLsn,
    patternLibraryHash: input.patternLibraryHash ?? ATTENTION_NARRATIVE_PATTERN_LIBRARY_HASH,
    patternPolicyHash: input.patternPolicyHash ?? ATTENTION_NARRATIVE_PATTERN_POLICY_HASH,
    monitorRuleVersion: input.monitorRuleVersion ?? ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
    canonicalizationVersion:
      input.canonicalizationVersion ?? ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    questCandidateIdentitySchemaVersion:
      input.questCandidateIdentitySchemaVersion ?? ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    patternInstanceIdentitySchemaVersion:
      input.patternInstanceIdentitySchemaVersion ?? ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
    patternCandidateIdentitySchemaVersion:
      input.patternCandidateIdentitySchemaVersion ?? ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    resourcePolicyVersion: input.resourcePolicyVersion ?? ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
  })
}

/** The default B4 eligibility/resource state, read from the pinned resource policy. */
export function attentionCandidateRankingEligibilityResourceState(
  overrides: Partial<AttentionCandidateRankingEligibilityResourceState> = {},
): AttentionCandidateRankingEligibilityResourceState {
  const policy = attentionStageBResourcePolicy()
  return Object.freeze({
    mixedFamilyCandidateCap:
      overrides.mixedFamilyCandidateCap ?? policy.mixedFamilyCandidatesAfterOrdering,
    retentionClassOrder: Object.freeze([...(overrides.retentionClassOrder ?? policy.retentionClassOrder)]),
    rankableClasses: Object.freeze([
      ...(overrides.rankableClasses ?? ['satisfied', 'active', 'stalled']),
    ]),
  })
}

/**
 * A5 addition — the trace cache key (ADR-0013 D15 two-clock revalidation;
 * plan §8 "cache-key invalidation and revalidation evidence"). It folds the
 * already-derived ranking cache key in whole, exactly as the ranking key
 * folds the derivation key in whole, so anything that invalidates ranking
 * (and by embedding, derivation) also invalidates the trace key — structural,
 * not a fact a reviewer must re-derive from two parallel field lists. The
 * two additions the trace key alone owns are the presentation-time
 * revalidation snapshot LSN (D15's second clock; distinct from the ranking
 * snapshot LSN already inside the folded ranking key) and the replay case
 * ID, so two distinct replay cases run under byte-identical policy can never
 * collide on one trace key.
 *
 * This is the exact, narrow edit the controlling A5 plan section (§9)
 * authorizes: "`attentionCandidateCacheKey.ts` only for an already-pinned
 * trace key." No new policy value is invented; the schema version pinned
 * here is declared once, in this edit, following the same versioned-key
 * discipline `deriveAttentionCandidateDerivationCacheKey` and
 * `deriveAttentionCandidateRankingCacheKey` already establish.
 */
export const ATTENTION_TRACE_CACHE_KEY_SCHEMA_VERSION = 'attention-trace-cache-key-v1' as const

/** The closed typed refusal set. Every case refuses; none approximates. */
export type AttentionCandidateCacheKeyRefusal =
  | 'missing-quest-accessor-contract-version'
  | 'missing-quest-opening-coordinate-contract-version'
  | 'unsupported-quest-opening-coordinate-contract-version'
  | 'missing-pattern-evidence-accessor-contract-version'
  | 'missing-attention-readable-surface-schema-version'
  | 'unsupported-attention-readable-surface-schema-version'
  | 'missing-snapshot-lsn'
  | 'snapshot-lsn-out-of-range'
  | 'missing-pattern-library-hash'
  | 'missing-pattern-policy-hash'
  | 'missing-monitor-rule-version'
  | 'missing-canonicalization-version'
  | 'unsupported-canonicalization-version'
  | 'missing-quest-candidate-identity-schema-version'
  | 'unsupported-quest-candidate-identity-schema-version'
  | 'missing-pattern-instance-identity-schema-version'
  | 'missing-pattern-candidate-identity-schema-version'
  | 'unsupported-pattern-candidate-identity-schema-version'
  | 'missing-resource-policy-version'
  | 'missing-ordering-version'
  | 'unsupported-ordering-version'
  | 'missing-ranking-policy-hash'
  | 'missing-eligibility-resource-state'

export type AttentionCandidateDerivationCacheKeyResult =
  | {
      readonly kind: 'ok'
      readonly cacheKeySchemaVersion: string
      readonly derivationCacheKey: string
    }
  | { readonly kind: 'refused'; readonly reason: AttentionCandidateCacheKeyRefusal }

export type AttentionCandidateRankingCacheKeyResult =
  | {
      readonly kind: 'ok'
      readonly cacheKeySchemaVersion: string
      readonly derivationCacheKey: string
      readonly rankingCacheKey: string
    }
  | { readonly kind: 'refused'; readonly reason: AttentionCandidateCacheKeyRefusal }

function isPresent(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Derive the candidate-derivation cache key from the explicit thirteen-field
 * bundle. Every field is serialized into the canonical key bytes; none is read
 * from module ambient state.
 *
 * Checks run in the bundle's declared field order and stop at the first failure,
 * so the reason a caller receives is stable rather than dependent on which check
 * happened to be cheapest.
 */
export function deriveAttentionCandidateDerivationCacheKey(
  bundle: AttentionCandidateDerivationDependencyBundle,
): AttentionCandidateDerivationCacheKeyResult {
  if (!isPresent(bundle.questAccessorContractVersion)) {
    return { kind: 'refused', reason: 'missing-quest-accessor-contract-version' }
  }
  if (!isPresent(bundle.questOpeningCoordinateContractVersion)) {
    return { kind: 'refused', reason: 'missing-quest-opening-coordinate-contract-version' }
  }
  if (bundle.questOpeningCoordinateContractVersion !== ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION) {
    return { kind: 'refused', reason: 'unsupported-quest-opening-coordinate-contract-version' }
  }
  if (!isPresent(bundle.patternEvidenceAccessorContractVersion)) {
    return { kind: 'refused', reason: 'missing-pattern-evidence-accessor-contract-version' }
  }
  if (!isPresent(bundle.attentionReadableSurfaceSchemaVersion)) {
    return { kind: 'refused', reason: 'missing-attention-readable-surface-schema-version' }
  }
  if (bundle.attentionReadableSurfaceSchemaVersion !== ATTENTION_READABLE_SURFACE_SCHEMA_VERSION) {
    return { kind: 'refused', reason: 'unsupported-attention-readable-surface-schema-version' }
  }
  if (typeof bundle.snapshotLsn !== 'number') {
    return { kind: 'refused', reason: 'missing-snapshot-lsn' }
  }
  if (!isAttentionRankingSnapshotLsnInRange(bundle.snapshotLsn)) {
    return { kind: 'refused', reason: 'snapshot-lsn-out-of-range' }
  }
  if (!isPresent(bundle.patternLibraryHash)) {
    return { kind: 'refused', reason: 'missing-pattern-library-hash' }
  }
  if (!isPresent(bundle.patternPolicyHash)) {
    return { kind: 'refused', reason: 'missing-pattern-policy-hash' }
  }
  if (!isPresent(bundle.monitorRuleVersion)) {
    return { kind: 'refused', reason: 'missing-monitor-rule-version' }
  }
  if (!isPresent(bundle.canonicalizationVersion)) {
    return { kind: 'refused', reason: 'missing-canonicalization-version' }
  }
  if (bundle.canonicalizationVersion !== ATTENTION_CANDIDATE_CANONICALIZATION_VERSION) {
    return { kind: 'refused', reason: 'unsupported-canonicalization-version' }
  }
  if (!isPresent(bundle.questCandidateIdentitySchemaVersion)) {
    return { kind: 'refused', reason: 'missing-quest-candidate-identity-schema-version' }
  }
  if (bundle.questCandidateIdentitySchemaVersion !== ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION) {
    return { kind: 'refused', reason: 'unsupported-quest-candidate-identity-schema-version' }
  }
  if (!isPresent(bundle.patternInstanceIdentitySchemaVersion)) {
    return { kind: 'refused', reason: 'missing-pattern-instance-identity-schema-version' }
  }
  if (!isPresent(bundle.patternCandidateIdentitySchemaVersion)) {
    return { kind: 'refused', reason: 'missing-pattern-candidate-identity-schema-version' }
  }
  if (bundle.patternCandidateIdentitySchemaVersion !== ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION) {
    return { kind: 'refused', reason: 'unsupported-pattern-candidate-identity-schema-version' }
  }
  if (!isPresent(bundle.resourcePolicyVersion)) {
    return { kind: 'refused', reason: 'missing-resource-policy-version' }
  }

  // Rebuilt as a closed record from the bundle's own values, so the literal's
  // property order — and the caller's — cannot reach the bytes.
  const canonicalInput = {
    attentionReadableSurfaceSchemaVersion: bundle.attentionReadableSurfaceSchemaVersion,
    canonicalizationVersion: bundle.canonicalizationVersion,
    monitorRuleVersion: bundle.monitorRuleVersion,
    patternCandidateIdentitySchemaVersion: bundle.patternCandidateIdentitySchemaVersion,
    patternEvidenceAccessorContractVersion: bundle.patternEvidenceAccessorContractVersion,
    patternInstanceIdentitySchemaVersion: bundle.patternInstanceIdentitySchemaVersion,
    patternLibraryHash: bundle.patternLibraryHash,
    patternPolicyHash: bundle.patternPolicyHash,
    questAccessorContractVersion: bundle.questAccessorContractVersion,
    questCandidateIdentitySchemaVersion: bundle.questCandidateIdentitySchemaVersion,
    questOpeningCoordinateContractVersion: bundle.questOpeningCoordinateContractVersion,
    resourcePolicyVersion: bundle.resourcePolicyVersion,
    snapshotLsn: bundle.snapshotLsn,
  }

  return {
    kind: 'ok',
    cacheKeySchemaVersion: ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION,
    derivationCacheKey: ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION
      + ':' + mintHash(canonicalSerialize(canonicalInput)),
  }
}

function isEligibilityResourceState(
  value: AttentionCandidateRankingEligibilityResourceState | undefined,
): value is AttentionCandidateRankingEligibilityResourceState {
  if (value === undefined || value === null) return false
  if (!Number.isSafeInteger(value.mixedFamilyCandidateCap) || value.mixedFamilyCandidateCap < 0) return false
  if (!Array.isArray(value.retentionClassOrder) || value.retentionClassOrder.length === 0) return false
  if (!Array.isArray(value.rankableClasses) || value.rankableClasses.length === 0) return false
  return true
}

/**
 * Derive the ranking cache key from the explicit ranking bundle.
 *
 * The derivation key is computed first from the embedded derivation bundle and
 * folded in whole, so every one of the thirteen derivation dependencies reaches
 * this key without being restated — and a ranking-only change provably cannot
 * reach the derivation key, because none of the three ranking-only members is
 * one of its inputs.
 */
export function deriveAttentionCandidateRankingCacheKey(
  bundle: AttentionCandidateRankingDependencyBundle,
): AttentionCandidateRankingCacheKeyResult {
  const derivation = deriveAttentionCandidateDerivationCacheKey(bundle.derivation)
  if (derivation.kind !== 'ok') {
    return { kind: 'refused', reason: derivation.reason }
  }

  if (!isPresent(bundle.orderingVersion)) {
    return { kind: 'refused', reason: 'missing-ordering-version' }
  }
  if (bundle.orderingVersion !== ATTENTION_CANDIDATE_ORDERING_VERSION) {
    return { kind: 'refused', reason: 'unsupported-ordering-version' }
  }
  if (!isPresent(bundle.rankingPolicyHash)) {
    return { kind: 'refused', reason: 'missing-ranking-policy-hash' }
  }
  if (!isEligibilityResourceState(bundle.eligibilityResourceState)) {
    return { kind: 'refused', reason: 'missing-eligibility-resource-state' }
  }

  const canonicalInput = {
    derivationCacheKey: derivation.derivationCacheKey,
    eligibilityResourceState: {
      mixedFamilyCandidateCap: bundle.eligibilityResourceState.mixedFamilyCandidateCap,
      rankableClasses: [...bundle.eligibilityResourceState.rankableClasses],
      retentionClassOrder: [...bundle.eligibilityResourceState.retentionClassOrder],
    },
    orderingVersion: bundle.orderingVersion,
    rankingPolicyHash: bundle.rankingPolicyHash,
  }

  return {
    kind: 'ok',
    cacheKeySchemaVersion: ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION,
    derivationCacheKey: derivation.derivationCacheKey,
    rankingCacheKey: ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION
      + ':' + mintHash(canonicalSerialize(canonicalInput)),
  }
}

/** A5: the trace-key identity input — the folded ranking key plus the two-clock and replay-case coordinates. */
export interface AttentionTraceCacheKeyInput {
  readonly rankingCacheKey: string
  readonly revalidationSnapshotLsn: number
  readonly replayCaseId: string
}

export type AttentionTraceCacheKeyRefusal =
  | 'missing-ranking-cache-key'
  | 'missing-revalidation-snapshot-lsn'
  | 'revalidation-snapshot-lsn-out-of-range'
  | 'missing-replay-case-id'

export type AttentionTraceCacheKeyResult =
  | { readonly kind: 'ok'; readonly cacheKeySchemaVersion: string; readonly traceCacheKey: string }
  | { readonly kind: 'refused'; readonly reason: AttentionTraceCacheKeyRefusal }

/**
 * Derive the trace cache key. Checks run in declared field order, exactly as
 * the two functions above do, so the refusal reason is stable rather than
 * dependent on which check happened to be cheapest.
 */
export function deriveAttentionTraceCacheKey(input: AttentionTraceCacheKeyInput): AttentionTraceCacheKeyResult {
  if (!isPresent(input.rankingCacheKey)) {
    return { kind: 'refused', reason: 'missing-ranking-cache-key' }
  }
  if (typeof input.revalidationSnapshotLsn !== 'number') {
    return { kind: 'refused', reason: 'missing-revalidation-snapshot-lsn' }
  }
  if (!isAttentionRankingSnapshotLsnInRange(input.revalidationSnapshotLsn)) {
    return { kind: 'refused', reason: 'revalidation-snapshot-lsn-out-of-range' }
  }
  if (!isPresent(input.replayCaseId)) {
    return { kind: 'refused', reason: 'missing-replay-case-id' }
  }

  const canonicalInput = {
    rankingCacheKey: input.rankingCacheKey,
    replayCaseId: input.replayCaseId,
    revalidationSnapshotLsn: input.revalidationSnapshotLsn,
  }

  return {
    kind: 'ok',
    cacheKeySchemaVersion: ATTENTION_TRACE_CACHE_KEY_SCHEMA_VERSION,
    traceCacheKey: ATTENTION_TRACE_CACHE_KEY_SCHEMA_VERSION + ':' + mintHash(canonicalSerialize(canonicalInput)),
  }
}
