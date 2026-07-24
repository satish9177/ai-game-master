import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_ORDERING_VERSION,
  ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION,
  ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
  ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
  ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
  ATTENTION_RANKING_SNAPSHOT_LSN_MAX,
  ATTENTION_RANKING_SNAPSHOT_LSN_MIN,
} from './attentionCandidatePolicy'
import {
  ATTENTION_CANDIDATE_DERIVATION_DEPENDENCY_FIELDS,
  attentionCandidateDerivationDependencyBundle,
  attentionCandidateRankingEligibilityResourceState,
  deriveAttentionCandidateDerivationCacheKey,
  deriveAttentionCandidateRankingCacheKey,
} from './attentionCandidateCacheKey'
import type {
  AttentionCandidateDerivationDependencyBundle,
  AttentionCandidateRankingDependencyBundle,
  AttentionCandidateRankingEligibilityResourceState,
} from './attentionCandidateCacheKey'
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
} from './attentionNarrativePatternResourcePolicy'
import { computeAttentionCandidateIdentity } from './attentionCandidateIdentity'

/**
 * A3 + B4 — the two separately-keyed cache identities, built from the explicit
 * RN019 §9.3 dependency bundles.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research`:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D15 derivation and ranking caches are separately keyed; D6 identity is
 *    disjoint from ranking-only policy);
 *  - `docs/research-notes/2026-07-23-019-narrative-pattern-instances-stage-b.md`
 *    (RN019 §9.3 the closed thirteen-field derivation bundle, and the ranking
 *    bundle's exactly three additional members);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§22 "Cache and policy-mismatch fixtures" K1-K3);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-23-attention-ledger-replay-stage-b-implementation-plan.md`
 *    (§4.5, §9 B4 obligations).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * These fixtures exercise key *derivation* only. No cache exists to test: there
 * is no store, lookup, eviction, or persistence in this slice, so "invalidation"
 * here means exactly what D15 needs it to mean — the key changes, so a later
 * cache keyed on it cannot return the stale value.
 *
 * **The load-bearing B4 correction.** Every dependency is passed in explicitly.
 * A dependency a test cannot vary is a dependency the suite cannot prove
 * participates, so each of the thirteen derivation fields and each ranking-only
 * member is varied on its own below.
 */

const SNAPSHOT_LSN = 41

function derivation(
  overrides: Partial<AttentionCandidateDerivationDependencyBundle> = {},
): AttentionCandidateDerivationDependencyBundle {
  return attentionCandidateDerivationDependencyBundle({ snapshotLsn: SNAPSHOT_LSN, ...overrides })
}

function ranking(
  overrides: Partial<AttentionCandidateRankingDependencyBundle> = {},
): AttentionCandidateRankingDependencyBundle {
  return {
    derivation: derivation(),
    orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION,
    rankingPolicyHash: 'fixture-ranking-policy-hash-v1',
    eligibilityResourceState: attentionCandidateRankingEligibilityResourceState(),
    ...overrides,
  }
}

function derivationKeyOrThrow(bundle: AttentionCandidateDerivationDependencyBundle): string {
  const result = deriveAttentionCandidateDerivationCacheKey(bundle)
  if (result.kind !== 'ok') throw new Error(`expected a derivation cache key, got ${result.reason}`)
  return result.derivationCacheKey
}

function rankingKeysOrThrow(bundle: AttentionCandidateRankingDependencyBundle): {
  readonly derivationCacheKey: string
  readonly rankingCacheKey: string
} {
  const result = deriveAttentionCandidateRankingCacheKey(bundle)
  if (result.kind !== 'ok') throw new Error(`expected a ranking cache key, got ${result.reason}`)
  return { derivationCacheKey: result.derivationCacheKey, rankingCacheKey: result.rankingCacheKey }
}

/**
 * The one candidate identity every cache variation must leave alone (D6): cache
 * and ranking policy are not identity inputs.
 */
const PINNED_CANDIDATE_IDENTITY = computeAttentionCandidateIdentity({
  sourceKind: 'quest_candidate',
  sourceId: 'quest-public-open',
  openingProvenanceId: 'consequence-public-37',
})

/**
 * The thirteen derivation dependencies, each with a distinct alternative value.
 * Kept as an explicit table so a field added to the bundle without a case here
 * fails the completeness assertion below rather than going unwitnessed.
 */
const DERIVATION_VARIATIONS: readonly (readonly [
  keyof AttentionCandidateDerivationDependencyBundle,
  Partial<AttentionCandidateDerivationDependencyBundle>,
])[] = [
  ['questAccessorContractVersion', { questAccessorContractVersion: 'fixture-quest-accessor-v2' }],
  [
    'questOpeningCoordinateContractVersion',
    { questOpeningCoordinateContractVersion: 'attention-quest-opening-coordinate-v2' },
  ],
  [
    'patternEvidenceAccessorContractVersion',
    { patternEvidenceAccessorContractVersion: 'fixture-pattern-evidence-accessor-v2' },
  ],
  [
    'attentionReadableSurfaceSchemaVersion',
    { attentionReadableSurfaceSchemaVersion: 'attention-readable-surface-schema-v1' },
  ],
  ['snapshotLsn', { snapshotLsn: SNAPSHOT_LSN + 1 }],
  ['patternLibraryHash', { patternLibraryHash: 'fixture-pattern-library-hash-v2' }],
  ['patternPolicyHash', { patternPolicyHash: 'fixture-pattern-policy-hash-v2' }],
  ['monitorRuleVersion', { monitorRuleVersion: 'fixture-monitor-rule-v2' }],
  ['canonicalizationVersion', { canonicalizationVersion: 'attention-candidate-canonicalization-v2' }],
  [
    'questCandidateIdentitySchemaVersion',
    { questCandidateIdentitySchemaVersion: 'attention-candidate-identity-schema-v2' },
  ],
  [
    'patternInstanceIdentitySchemaVersion',
    { patternInstanceIdentitySchemaVersion: 'fixture-pattern-instance-identity-v2' },
  ],
  [
    'patternCandidateIdentitySchemaVersion',
    { patternCandidateIdentitySchemaVersion: 'attention-pattern-candidate-identity-schema-v2' },
  ],
  ['resourcePolicyVersion', { resourcePolicyVersion: 'fixture-resource-policy-v2' }],
]

/**
 * The derivation fields this build validates against a pin. Varying one of them
 * is *refused* rather than keyed — the stronger K3 outcome, asserted separately
 * below, because this rig cannot honestly key a derivation to a canonical,
 * identity, surface, or sidecar rule it does not implement.
 */
const PINNED_DERIVATION_FIELDS: readonly (keyof AttentionCandidateDerivationDependencyBundle)[] = [
  'questOpeningCoordinateContractVersion',
  'attentionReadableSurfaceSchemaVersion',
  'canonicalizationVersion',
  'questCandidateIdentitySchemaVersion',
  'patternCandidateIdentitySchemaVersion',
]

describe('B4 / RN019 §9.3 — the derivation bundle is the closed thirteen-field set', () => {
  it('declares exactly the thirteen fields, in RN019\'s declared order', () => {
    expect(ATTENTION_CANDIDATE_DERIVATION_DEPENDENCY_FIELDS).toEqual([
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
    expect(ATTENTION_CANDIDATE_DERIVATION_DEPENDENCY_FIELDS).toHaveLength(13)
  })

  it('builds a default bundle from the pinned constants, with no field left ambient', () => {
    expect(derivation()).toEqual({
      questAccessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      questOpeningCoordinateContractVersion: ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
      patternEvidenceAccessorContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
      attentionReadableSurfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
      snapshotLsn: SNAPSHOT_LSN,
      patternLibraryHash: ATTENTION_NARRATIVE_PATTERN_LIBRARY_HASH,
      patternPolicyHash: ATTENTION_NARRATIVE_PATTERN_POLICY_HASH,
      monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
      canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
      questCandidateIdentitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
      patternInstanceIdentitySchemaVersion: ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
      patternCandidateIdentitySchemaVersion: ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
      resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
    })
    expect(Object.isFrozen(derivation())).toBe(true)
  })

  it('bumps the derivation and ranking key schemas to their explicit v2 strings', () => {
    expect(ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION)
      .toBe('attention-candidate-derivation-cache-key-v2')
    expect(ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION)
      .toBe('attention-candidate-ranking-cache-key-v2')
  })

  it('has a variation case for every declared field, so none is unwitnessed', () => {
    expect(DERIVATION_VARIATIONS.map(([field]) => field).sort())
      .toEqual([...ATTENTION_CANDIDATE_DERIVATION_DEPENDENCY_FIELDS].sort())
  })
})

describe('B4 / K1 — every derivation dependency independently moves both keys', () => {
  const baselineDerivation = derivationKeyOrThrow(derivation())
  const baselineRanking = rankingKeysOrThrow(ranking())

  it.each(DERIVATION_VARIATIONS.filter(([field]) => !PINNED_DERIVATION_FIELDS.includes(field)))(
    'varying %s alone changes the derivation key and, by embedding, the ranking key',
    (_field, override) => {
      const variedDerivation = derivationKeyOrThrow(derivation(override))
      const variedRanking = rankingKeysOrThrow(ranking({ derivation: derivation(override) }))

      expect(variedDerivation).not.toBe(baselineDerivation)
      expect(variedRanking.derivationCacheKey).toBe(variedDerivation)
      expect(variedRanking.rankingCacheKey).not.toBe(baselineRanking.rankingCacheKey)
    },
  )

  it.each(DERIVATION_VARIATIONS.filter(([field]) => PINNED_DERIVATION_FIELDS.includes(field)))(
    'varying the pinned %s refuses rather than keying to a rule this build does not implement',
    (_field, override) => {
      expect(deriveAttentionCandidateDerivationCacheKey(derivation(override)).kind).toBe('refused')
      expect(deriveAttentionCandidateRankingCacheKey(ranking({ derivation: derivation(override) })).kind)
        .toBe('refused')
    },
  )

  it('leaves source and candidate identity untouched by every derivation variation', () => {
    for (const [, override] of DERIVATION_VARIATIONS) {
      // Building the bundle cannot reach identity: the identity function is not
      // given a bundle at all, and its canonical input names no cache field.
      void derivation(override)
      expect(computeAttentionCandidateIdentity({
        sourceKind: 'quest_candidate',
        sourceId: 'quest-public-open',
        openingProvenanceId: 'consequence-public-37',
      })).toBe(PINNED_CANDIDATE_IDENTITY)
    }
  })
})

describe('B4 / K2 — every ranking-only dependency moves only the ranking key', () => {
  const baseline = rankingKeysOrThrow(ranking())

  const RANKING_ONLY_VARIATIONS: readonly (readonly [
    string,
    Partial<AttentionCandidateRankingDependencyBundle>,
  ])[] = [
    ['rankingPolicyHash', { rankingPolicyHash: 'fixture-ranking-policy-hash-v2' }],
    [
      'eligibilityResourceState.mixedFamilyCandidateCap',
      {
        eligibilityResourceState: attentionCandidateRankingEligibilityResourceState({
          mixedFamilyCandidateCap: 3,
        }),
      },
    ],
    [
      'eligibilityResourceState.retentionClassOrder',
      {
        eligibilityResourceState: attentionCandidateRankingEligibilityResourceState({
          retentionClassOrder: ['active', 'satisfied', 'stalled', 'violated', 'expired', 'abandoned'],
        }),
      },
    ],
    [
      'eligibilityResourceState.rankableClasses',
      {
        eligibilityResourceState: attentionCandidateRankingEligibilityResourceState({
          rankableClasses: ['satisfied', 'active'],
        }),
      },
    ],
  ]

  it.each(RANKING_ONLY_VARIATIONS)(
    'varying %s changes the ranking key but never the derivation key',
    (_label, override) => {
      const varied = rankingKeysOrThrow(ranking(override))

      expect(varied.rankingCacheKey).not.toBe(baseline.rankingCacheKey)
      expect(varied.derivationCacheKey).toBe(baseline.derivationCacheKey)
    },
  )

  it('keeps every ranking-only coordinate out of the derivation key material entirely', () => {
    // The derivation key is a pure function of the derivation bundle: it is not
    // even given the ranking bundle, so a ranking-only change structurally
    // cannot reach it.
    expect(deriveAttentionCandidateDerivationCacheKey.length).toBe(1)
    for (const [, override] of RANKING_ONLY_VARIATIONS) {
      expect(rankingKeysOrThrow(ranking(override)).derivationCacheKey)
        .toBe(derivationKeyOrThrow(derivation()))
    }
  })

  it('carries no B5-only exposure, cooldown, retirement, ledger, or template dependency', () => {
    const bundle = ranking()

    expect(Object.keys(bundle).sort())
      .toEqual(['derivation', 'eligibilityResourceState', 'orderingVersion', 'rankingPolicyHash'])
    const bytes = canonicalSerialize(bundle).toLowerCase()
    for (const forbidden of [
      'exposure',
      'cooldown',
      'retirement',
      'ledger',
      'template',
      'presentation',
      'relevantledgerinputidentity',
    ]) {
      expect({ forbidden, present: bytes.includes(forbidden) }).toEqual({ forbidden, present: false })
    }
  })

  it('refuses an unsupported ordering version rather than reinterpreting a v1 key as v2', () => {
    expect(deriveAttentionCandidateRankingCacheKey(ranking({ orderingVersion: 'attention-candidate-ordering-v1' })))
      .toEqual({ kind: 'refused', reason: 'unsupported-ordering-version' })
    expect(ATTENTION_CANDIDATE_ORDERING_VERSION).toBe('attention-candidate-ordering-v2')
  })
})

describe('B4 / K3 — missing or unsupported bundle material refuses, never approximates', () => {
  const MISSING_CASES: readonly (readonly [
    Partial<AttentionCandidateDerivationDependencyBundle>,
    string,
  ])[] = [
    [{ questAccessorContractVersion: '' }, 'missing-quest-accessor-contract-version'],
    [{ questOpeningCoordinateContractVersion: '' }, 'missing-quest-opening-coordinate-contract-version'],
    [{ patternEvidenceAccessorContractVersion: '' }, 'missing-pattern-evidence-accessor-contract-version'],
    [{ attentionReadableSurfaceSchemaVersion: '' }, 'missing-attention-readable-surface-schema-version'],
    [{ patternLibraryHash: '' }, 'missing-pattern-library-hash'],
    [{ patternPolicyHash: '' }, 'missing-pattern-policy-hash'],
    [{ monitorRuleVersion: '' }, 'missing-monitor-rule-version'],
    [{ canonicalizationVersion: '' }, 'missing-canonicalization-version'],
    [{ questCandidateIdentitySchemaVersion: '' }, 'missing-quest-candidate-identity-schema-version'],
    [{ patternInstanceIdentitySchemaVersion: '' }, 'missing-pattern-instance-identity-schema-version'],
    [{ patternCandidateIdentitySchemaVersion: '' }, 'missing-pattern-candidate-identity-schema-version'],
    [{ resourcePolicyVersion: '' }, 'missing-resource-policy-version'],
  ]

  it.each(MISSING_CASES)('refuses the missing field in %o with its own typed reason', (override, reason) => {
    expect(deriveAttentionCandidateDerivationCacheKey(derivation(override)))
      .toEqual({ kind: 'refused', reason })
  })

  it('refuses a missing snapshot coordinate and an unsafe one, without clamping or repairing', () => {
    expect(deriveAttentionCandidateDerivationCacheKey(
      derivation({ snapshotLsn: undefined as unknown as number }),
    )).toEqual({ kind: 'refused', reason: 'missing-snapshot-lsn' })

    for (const unsafe of [-1, 1.5, 1e21, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(deriveAttentionCandidateDerivationCacheKey(derivation({ snapshotLsn: unsafe })))
        .toEqual({ kind: 'refused', reason: 'snapshot-lsn-out-of-range' })
    }
  })

  it('accepts both pinned snapshot boundary values and does not conflate them', () => {
    const atMin = derivationKeyOrThrow(derivation({ snapshotLsn: ATTENTION_RANKING_SNAPSHOT_LSN_MIN }))
    const atMax = derivationKeyOrThrow(derivation({ snapshotLsn: ATTENTION_RANKING_SNAPSHOT_LSN_MAX }))

    expect(atMin).not.toBe(atMax)
  })

  it('refuses a missing ranking-policy hash and a missing eligibility/resource state', () => {
    expect(deriveAttentionCandidateRankingCacheKey(ranking({ rankingPolicyHash: '' })))
      .toEqual({ kind: 'refused', reason: 'missing-ranking-policy-hash' })
    expect(deriveAttentionCandidateRankingCacheKey(ranking({
      eligibilityResourceState: undefined as unknown as AttentionCandidateRankingEligibilityResourceState,
    }))).toEqual({ kind: 'refused', reason: 'missing-eligibility-resource-state' })
  })

  it('refuses deterministically, with the same reason on every run', () => {
    const reasons = new Set<string>()
    for (let run = 0; run < 5; run += 1) {
      const result = deriveAttentionCandidateDerivationCacheKey(derivation({ resourcePolicyVersion: '' }))
      reasons.add(result.kind === 'refused' ? result.reason : 'ok')
    }

    expect([...reasons]).toEqual(['missing-resource-policy-version'])
  })
})

describe('A3 / D15 — the two keys are versioned, distinct, deterministic, and whole-match only', () => {
  it('prefixes each key with its own schema version', () => {
    const keys = rankingKeysOrThrow(ranking())

    expect(keys.derivationCacheKey.startsWith(`${ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION}:`))
      .toBe(true)
    expect(keys.rankingCacheKey.startsWith(`${ATTENTION_CANDIDATE_RANKING_CACHE_KEY_SCHEMA_VERSION}:`))
      .toBe(true)
    expect(keys.derivationCacheKey).not.toBe(keys.rankingCacheKey)
  })

  it('is insertion-order independent: bundle literal property order cannot reach the bytes', () => {
    const forward: AttentionCandidateDerivationDependencyBundle = {
      questAccessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
      questOpeningCoordinateContractVersion: ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
      patternEvidenceAccessorContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
      attentionReadableSurfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
      snapshotLsn: SNAPSHOT_LSN,
      patternLibraryHash: ATTENTION_NARRATIVE_PATTERN_LIBRARY_HASH,
      patternPolicyHash: ATTENTION_NARRATIVE_PATTERN_POLICY_HASH,
      monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
      canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
      questCandidateIdentitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
      patternInstanceIdentitySchemaVersion: ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
      patternCandidateIdentitySchemaVersion: ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
      resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
    }
    const reversed: AttentionCandidateDerivationDependencyBundle = {
      resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
      patternCandidateIdentitySchemaVersion: ATTENTION_PATTERN_CANDIDATE_IDENTITY_SCHEMA_VERSION,
      patternInstanceIdentitySchemaVersion: ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
      questCandidateIdentitySchemaVersion: ATTENTION_CANDIDATE_IDENTITY_SCHEMA_VERSION,
      canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
      monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
      patternPolicyHash: ATTENTION_NARRATIVE_PATTERN_POLICY_HASH,
      patternLibraryHash: ATTENTION_NARRATIVE_PATTERN_LIBRARY_HASH,
      snapshotLsn: SNAPSHOT_LSN,
      attentionReadableSurfaceSchemaVersion: ATTENTION_READABLE_SURFACE_SCHEMA_VERSION,
      patternEvidenceAccessorContractVersion: ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION,
      questOpeningCoordinateContractVersion: ATTENTION_QUEST_OPENING_COORDINATE_CONTRACT_VERSION,
      questAccessorContractVersion: ATTENTION_QUEST_CANDIDATE_ACCESSOR_VERSION,
    }

    expect(derivationKeyOrThrow(reversed)).toBe(derivationKeyOrThrow(forward))
  })

  it('produces byte-identical keys across repeated independent runs', () => {
    const derivationKeys = new Set<string>()
    const rankingKeys = new Set<string>()
    for (let run = 0; run < 5; run += 1) {
      const keys = rankingKeysOrThrow(ranking())
      derivationKeys.add(keys.derivationCacheKey)
      rankingKeys.add(keys.rankingCacheKey)
    }

    expect(derivationKeys.size).toBe(1)
    expect(rankingKeys.size).toBe(1)
  })

  it('matches whole or misses: no partial, approximate, or prefix-matched reuse exists', () => {
    const baseline = derivationKeyOrThrow(derivation())
    const varied = derivationKeyOrThrow(derivation({ snapshotLsn: SNAPSHOT_LSN + 1 }))

    // Both carry the schema prefix and nothing else in common — a prefix match
    // is never a key match, and no API here exposes a partial lookup to try one.
    expect(varied.startsWith(ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION)).toBe(true)
    expect(baseline.startsWith(ATTENTION_CANDIDATE_DERIVATION_CACHE_KEY_SCHEMA_VERSION)).toBe(true)
    expect(varied).not.toBe(baseline)
    expect(varied.startsWith(baseline)).toBe(false)
    expect(baseline.startsWith(varied)).toBe(false)
  })

  it('mutates no input bundle', () => {
    const bundle = derivation()
    const before = canonicalSerialize(bundle)

    derivationKeyOrThrow(bundle)
    rankingKeysOrThrow(ranking({ derivation: bundle }))

    expect(canonicalSerialize(bundle)).toBe(before)
  })
})
