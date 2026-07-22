import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION } from './attentionQuestCandidateContracts'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_ORDERING_VERSION,
  ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION,
  ATTENTION_RANKING_SNAPSHOT_LSN_MAX,
  ATTENTION_RANKING_SNAPSHOT_LSN_MIN,
} from './attentionCandidatePolicy'
import {
  deriveAttentionCandidateDerivationCacheKey,
  deriveAttentionCandidateRankingCacheKey,
} from './attentionCandidateCacheKey'
import type {
  AttentionCandidateDerivationCacheKeyInput,
  AttentionCandidateRankingCacheKeyInput,
} from './attentionCandidateCacheKey'

/**
 * A3 — the two separately-keyed cache identities.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D15 derivation and ranking caches are separately keyed; D6 identity is
 *    disjoint from ranking-only policy);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§22 "Cache and policy-mismatch fixtures" K1-K3);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6 view-cache/ranking-cache identity sets, §9 A3 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * These fixtures exercise key *derivation* only. No cache exists to test: there
 * is no store, lookup, eviction, or persistence in this slice, so "invalidation"
 * here means exactly what D15 needs it to mean — the key changes, so a later
 * cache keyed on it cannot return the stale value.
 */

/**
 * The later-slice coordinates are opaque required inputs. These fixture values
 * stand in for versions A4/A5 will pin; nothing in the module defaults them.
 */
const DERIVATION_INPUT: AttentionCandidateDerivationCacheKeyInput = {
  accessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
  canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  identitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  rankingSnapshotLsn: 41,
  resourcePolicyVersion: 'fixture-resource-policy-v1',
  openingProvenancePolicyVersion: 'fixture-opening-provenance-policy-v1',
}

const RANKING_INPUT: AttentionCandidateRankingCacheKeyInput = {
  ...DERIVATION_INPUT,
  orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION,
  rankingPolicyHash: 'fixture-ranking-policy-hash-v1',
  ledgerExposurePolicyVersion: 'fixture-ledger-exposure-policy-v1',
  templateChannelPolicyVersion: 'fixture-template-channel-policy-v1',
  relevantLedgerInputIdentity: 'fixture-ledger-input-identity-empty',
}

function derivationKey(overrides: Partial<AttentionCandidateDerivationCacheKeyInput> = {}): string {
  const result = deriveAttentionCandidateDerivationCacheKey({ ...DERIVATION_INPUT, ...overrides })
  if (result.kind !== 'ok') throw new Error('expected a derivation cache key, got ' + result.reason)
  return result.derivationCacheKey
}

function rankingKey(overrides: Partial<AttentionCandidateRankingCacheKeyInput> = {}): string {
  const result = deriveAttentionCandidateRankingCacheKey({ ...RANKING_INPUT, ...overrides })
  if (result.kind !== 'ok') throw new Error('expected a ranking cache key, got ' + result.reason)
  return result.rankingCacheKey
}

describe('A3 / D15 — the two keys are versioned, distinct, and deterministic', () => {
  it('prefixes each key with its own schema version', () => {
    const derivation = deriveAttentionCandidateDerivationCacheKey(DERIVATION_INPUT)
    const ranking = deriveAttentionCandidateRankingCacheKey(RANKING_INPUT)

    expect(derivation).toMatchObject({
      kind: 'ok',
      cacheKeySchemaVersion: ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION,
    })
    expect(ranking).toMatchObject({
      kind: 'ok',
      cacheKeySchemaVersion: ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION,
    })
    expect(derivationKey()).toMatch(/^attention-candidate-derivation-cache-key-v1:fnv1a64-v1:[0-9a-f]{16}$/)
    expect(rankingKey()).toMatch(/^attention-candidate-ranking-cache-key-v1:fnv1a64-v1:[0-9a-f]{16}$/)
    expect(ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION)
      .not.toBe(ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION)
    expect(derivationKey()).not.toBe(rankingKey())
  })

  it('embeds the derivation key in the ranking result, so the two stay joined', () => {
    const ranking = deriveAttentionCandidateRankingCacheKey(RANKING_INPUT)
    if (ranking.kind !== 'ok') throw new Error('expected a ranking cache key')

    expect(ranking.derivationCacheKey).toBe(derivationKey())
  })

  it('produces byte-identical keys across repeated independent runs', () => {
    const derivationKeys = new Set<string>()
    const rankingKeys = new Set<string>()

    for (let run = 0; run < 5; run += 1) {
      derivationKeys.add(derivationKey())
      rankingKeys.add(rankingKey())
    }

    expect(derivationKeys.size).toBe(1)
    expect(rankingKeys.size).toBe(1)
  })

  it('ignores the order the input object literal was written in', () => {
    const reordered: AttentionCandidateDerivationCacheKeyInput = {
      openingProvenancePolicyVersion: DERIVATION_INPUT.openingProvenancePolicyVersion,
      resourcePolicyVersion: DERIVATION_INPUT.resourcePolicyVersion,
      rankingSnapshotLsn: DERIVATION_INPUT.rankingSnapshotLsn,
      identitySchemaVersion: DERIVATION_INPUT.identitySchemaVersion,
      canonicalizationVersion: DERIVATION_INPUT.canonicalizationVersion,
      accessorContractVersion: DERIVATION_INPUT.accessorContractVersion,
    }
    const reorderedRanking: AttentionCandidateRankingCacheKeyInput = {
      relevantLedgerInputIdentity: RANKING_INPUT.relevantLedgerInputIdentity,
      templateChannelPolicyVersion: RANKING_INPUT.templateChannelPolicyVersion,
      ledgerExposurePolicyVersion: RANKING_INPUT.ledgerExposurePolicyVersion,
      rankingPolicyHash: RANKING_INPUT.rankingPolicyHash,
      orderingVersion: RANKING_INPUT.orderingVersion,
      ...reordered,
    }

    expect(deriveAttentionCandidateDerivationCacheKey(reordered)).toEqual(
      deriveAttentionCandidateDerivationCacheKey(DERIVATION_INPUT),
    )
    expect(deriveAttentionCandidateRankingCacheKey(reorderedRanking)).toEqual(
      deriveAttentionCandidateRankingCacheKey(RANKING_INPUT),
    )
  })

  it('does not mutate the inputs it is given', () => {
    const derivationBytes = canonicalSerialize(DERIVATION_INPUT)
    const rankingBytes = canonicalSerialize(RANKING_INPUT)

    deriveAttentionCandidateDerivationCacheKey(DERIVATION_INPUT)
    deriveAttentionCandidateRankingCacheKey(RANKING_INPUT)

    expect(canonicalSerialize(DERIVATION_INPUT)).toBe(derivationBytes)
    expect(canonicalSerialize(RANKING_INPUT)).toBe(rankingBytes)
  })
})

describe('A3 / K1 — every derivation dependency invalidates both keys', () => {
  const derivationDependencies: [string, Partial<AttentionCandidateDerivationCacheKeyInput>][] = [
    ['accessor-contract version', { accessorContractVersion: 'attention-quest-candidate-accessor-v2' }],
    ['ranking snapshot coordinate', { rankingSnapshotLsn: 42 }],
    ['resource-policy version', { resourcePolicyVersion: 'fixture-resource-policy-v2' }],
    ['opening-provenance-policy version', { openingProvenancePolicyVersion: 'fixture-opening-provenance-policy-v2' }],
  ]

  it.each(derivationDependencies)('changing the %s invalidates the derivation key', (_label, override) => {
    expect(derivationKey(override)).not.toBe(derivationKey())
  })

  it.each(derivationDependencies)('changing the %s also invalidates the ranking key', (_label, override) => {
    expect(rankingKey(override)).not.toBe(rankingKey())
  })
})

describe('A3 / K2 — a ranking-only change invalidates ranking, never derivation or identity', () => {
  const rankingOnlyDependencies: [string, Partial<AttentionCandidateRankingCacheKeyInput>][] = [
    ['ranking-policy hash', { rankingPolicyHash: 'fixture-ranking-policy-hash-v2' }],
    ['ledger/exposure-policy version', { ledgerExposurePolicyVersion: 'fixture-ledger-exposure-policy-v2' }],
    ['template/channel-policy version', { templateChannelPolicyVersion: 'fixture-template-channel-policy-v2' }],
    ['relevant-ledger-input identity', { relevantLedgerInputIdentity: 'fixture-ledger-input-identity-one-append' }],
  ]

  it.each(rankingOnlyDependencies)('changing the %s invalidates the ranking key', (_label, override) => {
    expect(rankingKey(override)).not.toBe(rankingKey())
  })

  it.each(rankingOnlyDependencies)('changing the %s leaves the derivation key untouched', (_label, override) => {
    const ranking = deriveAttentionCandidateRankingCacheKey({ ...RANKING_INPUT, ...override })
    if (ranking.kind !== 'ok') throw new Error('expected a ranking cache key')

    expect(ranking.derivationCacheKey).toBe(derivationKey())
  })

  it('keeps ranking-only coordinates out of the derivation key material entirely', () => {
    // The derivation input type has no field for any of them; this asserts the
    // consequence, so a later widening of that type is caught here too.
    expect(Object.keys(DERIVATION_INPUT).sort()).toEqual([
      'accessorContractVersion',
      'canonicalizationVersion',
      'identitySchemaVersion',
      'openingProvenancePolicyVersion',
      'rankingSnapshotLsn',
      'resourcePolicyVersion',
    ])
  })
})

describe('A3 / K3 — missing or unsupported key material refuses, never approximates', () => {
  const missingCases: [string, Partial<AttentionCandidateRankingCacheKeyInput>, string][] = [
    ['accessor-contract version', { accessorContractVersion: '' }, 'missing-accessor-contract-version'],
    ['canonicalization version', { canonicalizationVersion: '   ' }, 'missing-canonicalization-version'],
    ['identity-schema version', { identitySchemaVersion: '' }, 'missing-identity-schema-version'],
    ['resource-policy version', { resourcePolicyVersion: '' }, 'missing-resource-policy-version'],
    ['opening-provenance-policy version', { openingProvenancePolicyVersion: '  ' }, 'missing-opening-provenance-policy-version'],
    ['ordering version', { orderingVersion: '' }, 'missing-ordering-version'],
    ['ranking-policy hash', { rankingPolicyHash: '' }, 'missing-ranking-policy-hash'],
    ['ledger/exposure-policy version', { ledgerExposurePolicyVersion: '' }, 'missing-ledger-exposure-policy-version'],
    ['template/channel-policy version', { templateChannelPolicyVersion: '' }, 'missing-template-channel-policy-version'],
    ['relevant-ledger-input identity', { relevantLedgerInputIdentity: '' }, 'missing-relevant-ledger-input-identity'],
  ]

  it.each(missingCases)('refuses when the %s is absent', (_label, override, reason) => {
    expect(deriveAttentionCandidateRankingCacheKey({ ...RANKING_INPUT, ...override }))
      .toEqual({ kind: 'refused', reason })
  })

  const unsupportedCases: [string, Partial<AttentionCandidateRankingCacheKeyInput>, string][] = [
    ['canonicalization version', { canonicalizationVersion: 'attention-candidate-canonicalization-v2' }, 'unsupported-canonicalization-version'],
    ['identity-schema version', { identitySchemaVersion: 'attention-candidate-identity-schema-v2' }, 'unsupported-identity-schema-version'],
    ['ordering version', { orderingVersion: 'attention-candidate-ordering-v2' }, 'unsupported-ordering-version'],
  ]

  it.each(unsupportedCases)('refuses a %s this build does not implement', (_label, override, reason) => {
    expect(deriveAttentionCandidateRankingCacheKey({ ...RANKING_INPUT, ...override }))
      .toEqual({ kind: 'refused', reason })
  })

  it('refuses the whole ranking key when a derivation dependency is missing', () => {
    // A ranking key must never be mintable over an unkeyable derivation.
    expect(deriveAttentionCandidateRankingCacheKey({ ...RANKING_INPUT, resourcePolicyVersion: '' }))
      .toEqual({ kind: 'refused', reason: 'missing-resource-policy-version' })
  })

  it('refuses deterministically, with the same reason on every run', () => {
    const reasons = new Set<string>()

    for (let run = 0; run < 5; run += 1) {
      const result = deriveAttentionCandidateRankingCacheKey({ ...RANKING_INPUT, rankingPolicyHash: '' })
      reasons.add(result.kind === 'refused' ? result.reason : 'unexpected-ok')
    }

    expect([...reasons]).toEqual(['missing-ranking-policy-hash'])
  })
})

describe('A3 — the ranking snapshot coordinate is a checked bounded integer', () => {
  it('accepts the pinned minimum', () => {
    expect(deriveAttentionCandidateDerivationCacheKey({
      ...DERIVATION_INPUT,
      rankingSnapshotLsn: ATTENTION_RANKING_SNAPSHOT_LSN_MIN,
    }).kind).toBe('ok')
    expect(ATTENTION_RANKING_SNAPSHOT_LSN_MIN).toBe(0)
  })

  it('accepts the pinned maximum', () => {
    expect(deriveAttentionCandidateDerivationCacheKey({
      ...DERIVATION_INPUT,
      rankingSnapshotLsn: ATTENTION_RANKING_SNAPSHOT_LSN_MAX,
    }).kind).toBe('ok')
    expect(ATTENTION_RANKING_SNAPSHOT_LSN_MAX).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('accepts an ordinary in-range coordinate', () => {
    expect(deriveAttentionCandidateDerivationCacheKey({ ...DERIVATION_INPUT, rankingSnapshotLsn: 41 }).kind).toBe('ok')
  })

  const outOfRangeCases: [string, number][] = [
    ['below the minimum', -1],
    ['far below the minimum', -41],
    ['above the maximum', Number.MAX_SAFE_INTEGER + 2],
    ['fractional', 41.5],
    ['NaN', Number.NaN],
    ['positive Infinity', Number.POSITIVE_INFINITY],
    ['negative Infinity', Number.NEGATIVE_INFINITY],
  ]

  it.each(outOfRangeCases)('refuses a coordinate that is %s, without clamping or repairing it', (_label, value) => {
    expect(deriveAttentionCandidateDerivationCacheKey({ ...DERIVATION_INPUT, rankingSnapshotLsn: value }))
      .toEqual({ kind: 'refused', reason: 'ranking-snapshot-lsn-out-of-range' })
    expect(deriveAttentionCandidateRankingCacheKey({ ...RANKING_INPUT, rankingSnapshotLsn: value }))
      .toEqual({ kind: 'refused', reason: 'ranking-snapshot-lsn-out-of-range' })
  })

  it('leaves the input bytes unchanged after a refusal', () => {
    const rejected = { ...DERIVATION_INPUT, rankingSnapshotLsn: 41.5 }
    const before = canonicalSerialize(rejected)

    expect(deriveAttentionCandidateDerivationCacheKey(rejected).kind).toBe('refused')
    expect(canonicalSerialize(rejected)).toBe(before)
    expect(rejected.rankingSnapshotLsn).toBe(41.5)
  })

  it('does not treat the two boundary values as the same key', () => {
    expect(derivationKey({ rankingSnapshotLsn: ATTENTION_RANKING_SNAPSHOT_LSN_MIN }))
      .not.toBe(derivationKey({ rankingSnapshotLsn: ATTENTION_RANKING_SNAPSHOT_LSN_MAX }))
  })
})
