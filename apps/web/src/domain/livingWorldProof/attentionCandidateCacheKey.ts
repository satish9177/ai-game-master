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
 * Two key classes, exactly as plan §6 splits them:
 *
 *  - the **derivation** key covers everything a normalized candidate set
 *    depends on: accessor-contract version, canonicalization version,
 *    identity-schema version, the pinned ranking snapshot coordinate, the
 *    resource-policy version, and the opening-provenance-policy version;
 *  - the **ranking** key is the derivation key *plus* the ordering version, the
 *    ranking-policy hash, the ledger/exposure-policy version, the
 *    template/channel-policy version, and the canonical relevant-ledger-input
 *    identity.
 *
 * The ranking key embeds the derivation key as a component rather than
 * re-listing its parts. That is what makes "anything that invalidates derivation
 * also invalidates ranking" structural instead of a property a reviewer has to
 * re-derive from two parallel field lists — while the converse stays false by
 * construction, which is D15's "a re-weighting must not invalidate cached
 * candidate derivation" and D6's identity/ranking disjointness.
 *
 * **Coordinates owned by later slices are required opaque inputs, never
 * defaults.** The resource-policy, opening-provenance-policy, ranking-policy,
 * ledger/exposure-policy and template/channel-policy coordinates, and the
 * relevant-ledger-input identity, are pinned by slices that do not exist yet.
 * This module therefore takes each as an explicit required string and refuses
 * when one is absent, rather than substituting a placeholder — an invented
 * default would silently key every cached value to a policy nobody chose, which
 * is the exact failure D15's "Missing versions refuse" and the replay spec's K3
 * ("the harness refuses, it does not approximate") forbid. Implementing any of
 * those later capabilities is explicitly not part of this slice.
 *
 * The three versions Stage A itself owns — canonicalization, identity-schema,
 * ordering — are validated against their pins instead, because this rig cannot
 * honestly key a derivation to a canonicalization rule it does not implement.
 * The accessor-contract version is carried as an opaque required input: A1's
 * accessor already enforces which version it will serve, and the cache key's job
 * is to record *which* version produced the cached value so that a change to it
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
  isAttentionRankingSnapshotLsnInRange,
} from './attentionCandidatePolicy'

/** Plan §6: the complete view/derivation-cache identity input set. */
export interface AttentionCandidateDerivationCacheKeyInput {
  readonly accessorContractVersion: string
  readonly canonicalizationVersion: string
  readonly identitySchemaVersion: string
  readonly rankingSnapshotLsn: number
  readonly resourcePolicyVersion: string
  readonly openingProvenancePolicyVersion: string
}

/**
 * Plan §6: the derivation input set plus the ranking-only additions. Written
 * flat rather than as an extension of the derivation input, so the ranking key's
 * dependency list is legible in one place.
 */
export interface AttentionCandidateRankingCacheKeyInput {
  readonly accessorContractVersion: string
  readonly canonicalizationVersion: string
  readonly identitySchemaVersion: string
  readonly rankingSnapshotLsn: number
  readonly resourcePolicyVersion: string
  readonly openingProvenancePolicyVersion: string
  readonly orderingVersion: string
  readonly rankingPolicyHash: string
  readonly ledgerExposurePolicyVersion: string
  readonly templateChannelPolicyVersion: string
  readonly relevantLedgerInputIdentity: string
}

/** The closed typed refusal set. Every case refuses; none approximates. */
export type AttentionCandidateCacheKeyRefusal =
  | 'missing-accessor-contract-version'
  | 'missing-canonicalization-version'
  | 'unsupported-canonicalization-version'
  | 'missing-identity-schema-version'
  | 'unsupported-identity-schema-version'
  | 'missing-ranking-snapshot-lsn'
  | 'ranking-snapshot-lsn-out-of-range'
  | 'missing-resource-policy-version'
  | 'missing-opening-provenance-policy-version'
  | 'missing-ordering-version'
  | 'unsupported-ordering-version'
  | 'missing-ranking-policy-hash'
  | 'missing-ledger-exposure-policy-version'
  | 'missing-template-channel-policy-version'
  | 'missing-relevant-ledger-input-identity'

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
 * Derive the candidate-derivation cache key.
 *
 * Checks run in the declared field order and stop at the first failure, so the
 * reason a caller receives is stable rather than dependent on which check
 * happened to be cheapest.
 */
export function deriveAttentionCandidateDerivationCacheKey(
  input: AttentionCandidateDerivationCacheKeyInput,
): AttentionCandidateDerivationCacheKeyResult {
  if (!isPresent(input.accessorContractVersion)) {
    return { kind: 'refused', reason: 'missing-accessor-contract-version' }
  }
  if (!isPresent(input.canonicalizationVersion)) {
    return { kind: 'refused', reason: 'missing-canonicalization-version' }
  }
  if (input.canonicalizationVersion !== ATTENTION_CANDIDATE_CANONICALIZATION_VERSION) {
    return { kind: 'refused', reason: 'unsupported-canonicalization-version' }
  }
  if (!isPresent(input.identitySchemaVersion)) {
    return { kind: 'refused', reason: 'missing-identity-schema-version' }
  }
  if (input.identitySchemaVersion !== ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION) {
    return { kind: 'refused', reason: 'unsupported-identity-schema-version' }
  }
  if (typeof input.rankingSnapshotLsn !== 'number') {
    return { kind: 'refused', reason: 'missing-ranking-snapshot-lsn' }
  }
  if (!isAttentionRankingSnapshotLsnInRange(input.rankingSnapshotLsn)) {
    return { kind: 'refused', reason: 'ranking-snapshot-lsn-out-of-range' }
  }
  if (!isPresent(input.resourcePolicyVersion)) {
    return { kind: 'refused', reason: 'missing-resource-policy-version' }
  }
  if (!isPresent(input.openingProvenancePolicyVersion)) {
    return { kind: 'refused', reason: 'missing-opening-provenance-policy-version' }
  }

  const canonicalInput = {
    accessorContractVersion: input.accessorContractVersion,
    canonicalizationVersion: input.canonicalizationVersion,
    identitySchemaVersion: input.identitySchemaVersion,
    openingProvenancePolicyVersion: input.openingProvenancePolicyVersion,
    rankingSnapshotLsn: input.rankingSnapshotLsn,
    resourcePolicyVersion: input.resourcePolicyVersion,
  }

  return {
    kind: 'ok',
    cacheKeySchemaVersion: ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION,
    derivationCacheKey: ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION
      + ':' + mintHash(canonicalSerialize(canonicalInput)),
  }
}

/**
 * Derive the ranking cache key.
 *
 * The derivation key is computed first and folded in whole, so every derivation
 * dependency reaches this key without being restated — and a ranking-only change
 * provably cannot reach the derivation key, because it is not one of its inputs.
 */
export function deriveAttentionCandidateRankingCacheKey(
  input: AttentionCandidateRankingCacheKeyInput,
): AttentionCandidateRankingCacheKeyResult {
  const derivation = deriveAttentionCandidateDerivationCacheKey(input)
  if (derivation.kind !== 'ok') {
    return { kind: 'refused', reason: derivation.reason }
  }

  if (!isPresent(input.orderingVersion)) {
    return { kind: 'refused', reason: 'missing-ordering-version' }
  }
  if (input.orderingVersion !== ATTENTION_CANDIDATE_ORDERING_VERSION) {
    return { kind: 'refused', reason: 'unsupported-ordering-version' }
  }
  if (!isPresent(input.rankingPolicyHash)) {
    return { kind: 'refused', reason: 'missing-ranking-policy-hash' }
  }
  if (!isPresent(input.ledgerExposurePolicyVersion)) {
    return { kind: 'refused', reason: 'missing-ledger-exposure-policy-version' }
  }
  if (!isPresent(input.templateChannelPolicyVersion)) {
    return { kind: 'refused', reason: 'missing-template-channel-policy-version' }
  }
  if (!isPresent(input.relevantLedgerInputIdentity)) {
    return { kind: 'refused', reason: 'missing-relevant-ledger-input-identity' }
  }

  const canonicalInput = {
    derivationCacheKey: derivation.derivationCacheKey,
    ledgerExposurePolicyVersion: input.ledgerExposurePolicyVersion,
    orderingVersion: input.orderingVersion,
    rankingPolicyHash: input.rankingPolicyHash,
    relevantLedgerInputIdentity: input.relevantLedgerInputIdentity,
    templateChannelPolicyVersion: input.templateChannelPolicyVersion,
  }

  return {
    kind: 'ok',
    cacheKeySchemaVersion: ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION,
    derivationCacheKey: derivation.derivationCacheKey,
    rankingCacheKey: ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION
      + ':' + mintHash(canonicalSerialize(canonicalInput)),
  }
}
