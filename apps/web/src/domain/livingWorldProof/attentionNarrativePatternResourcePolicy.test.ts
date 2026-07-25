import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  ATTENTION_NARRATIVE_PATTERN_POLICY_HASH,
  ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
  NARRATIVE_PATTERN_RANKABLE_CLASSES,
  NARRATIVE_PATTERN_RETENTION_CLASS_ORDER,
  applyMixedFamilyCandidateCap,
  applyNarrativePatternStructuralRetention,
  attentionStageBResourcePolicy,
  buildAttentionStageBResourcePolicy,
  isNarrativePatternInstanceRankable,
} from './attentionNarrativePatternResourcePolicy'
import type {
  AttentionStageBResourcePolicy,
  NarrativePatternRetentionClass,
} from './attentionNarrativePatternResourcePolicy'
import { ATTENTION_NARRATIVE_PATTERN_CONFLICT_FORK_CHILD_CAP } from './attentionNarrativePatternMonitor'
import { ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT } from './attentionPatternEvidenceContracts'
import type { NarrativePatternInstance } from './attentionNarrativePatternContracts'
import type { NarrativePatternType } from './attentionNarrativePatternIdentity'

/**
 * Stage B / B4 — the immutable proof-rig resource policy and deterministic
 * structural retention (RN019 §8; plan §4.4). Retention is a pure projection
 * over already-derived instances, so these fixtures build minimal
 * instance-shaped values carrying only the fields retention reads (class, type,
 * canonical tuples, id). They exercise the caps, the class order, terminal
 * non-rankability, and deterministic retained/dropped identities in isolation.
 *
 * B5 (plan §10) extends the same file with the exact policy *contract* evidence
 * for the five RN019 §8.4 exposure/cooldown/retirement fields the B5
 * implementation adds to `AttentionStageBResourcePolicy`. Those additions are a
 * shape/hash regression only: every expected field name and value below is an
 * independent literal, never read back from the module under test, and every
 * committed B4 structural-bound case above and below is preserved unchanged in
 * meaning. Executable behavioral coverage of the five B5 bounds (cooldown and
 * density boundary LSNs, exposure and failure retirement, retirement
 * permanence) stays where the §4.4 bound matrix assigns it —
 * `attentionResourceLimits.test.ts`, `attentionLedger.test.ts`, and
 * `attentionNarrativePatternRevalidation.test.ts` — so nothing here duplicates
 * a runtime-bound fixture.
 */

const POLICY = attentionStageBResourcePolicy()

/**
 * The complete pinned field-name set, written out as independent literals so an
 * accidentally omitted or extra field on either the B4 thirteen or the B5 five
 * fails rather than silently agreeing with whatever the implementation exports.
 */
const POLICY_FIELD_NAMES: readonly string[] = [
  'resourcePolicyVersion',
  'newestAdmittedEvidenceViews',
  'reconstructedInstancesPerPatternType',
  'activeStalledPartialsPerPatternType',
  'reconstructedInstancesGlobal',
  'conflictChildrenPerParent',
  'evidenceItemsPerInstance',
  'patternSteps',
  'mixedFamilyCandidatesAfterOrdering',
  'revealPackageAssertions',
  'presentationsPerEvaluation',
  'successfulPresentationsInWindow',
  'successfulPresentationCooldownLsns',
  'maxSuccessfulExposuresPerCandidateId',
  'revalidationFailureCooldownLsns',
  'consecutiveRevalidationFailuresBeforeRetirement',
  'satisfiedPatternRetirementLsns',
  'retentionClassOrder',
]

const POLICY_FIELD_COUNT = 18

type NumericPolicyField = keyof Omit<
  AttentionStageBResourcePolicy,
  'resourcePolicyVersion' | 'retentionClassOrder'
>

/**
 * Every numeric policy field with a value that differs from its pinned default.
 * Both the field names and the replacement values are literals here: the point
 * of the case is that a semantic edit to any one bound cannot keep the old
 * `patternPolicyHash`, so generating either side from the module would prove
 * nothing.
 */
const NUMERIC_POLICY_FIELD_VARIATIONS: readonly (readonly [NumericPolicyField, number])[] = [
  ['newestAdmittedEvidenceViews', 31],
  ['reconstructedInstancesPerPatternType', 5],
  ['activeStalledPartialsPerPatternType', 3],
  ['reconstructedInstancesGlobal', 11],
  ['conflictChildrenPerParent', 1],
  ['evidenceItemsPerInstance', 2],
  ['patternSteps', 2],
  ['mixedFamilyCandidatesAfterOrdering', 3],
  ['revealPackageAssertions', 3],
  ['presentationsPerEvaluation', 0],
  ['successfulPresentationsInWindow', 3],
  ['successfulPresentationCooldownLsns', 5],
  ['maxSuccessfulExposuresPerCandidateId', 3],
  ['revalidationFailureCooldownLsns', 3],
  ['consecutiveRevalidationFailuresBeforeRetirement', 3],
  ['satisfiedPatternRetirementLsns', 9],
]

function overriddenPolicy(field: NumericPolicyField, value: number) {
  return buildAttentionStageBResourcePolicy(
    { [field]: value } as Partial<Record<NumericPolicyField, number>>,
  )
}

function fakeInstance(
  patternType: NarrativePatternType,
  cls: NarrativePatternRetentionClass,
  id: string,
): NarrativePatternInstance {
  const common = {
    sourceKind: 'narrative_pattern_instance' as const,
    sourceAuthority: 'derived' as const,
    patternInstanceId: id,
    patternType,
    patternSemanticVersion: 1,
    patternContentHash: `content-${patternType}`,
    monitorRuleVersion: 'attention-narrative-pattern-monitor-v1',
    evidenceViewContractVersion: 'attention-pattern-evidence-accessor-v1',
    canonicalizationVersion: 'attention-candidate-canonicalization-v1',
    identitySchemaVersion: 'attention-narrative-pattern-identity-schema-v1',
    evaluationSnapshotLsn: 100,
    bindingMap: [
      { role: 'initiator', entityId: `${id}-a` },
      { role: 'counterparty', entityId: `${id}-b` },
    ],
    evidenceSequence: [],
    supportingRecordIdentityTuple: [
      {
        semanticRole: 'aid-start',
        recordKind: 'observable_action',
        recordId: `${id}-rec`,
        visibilityProvenanceId: `${id}-prov`,
        commitLsn: 10,
      },
    ],
    creationProvenance: {
      startRecordId: `${id}-rec`,
      startCommitLsn: 10,
      patternSemanticVersion: 1,
      monitorRuleVersion: 'attention-narrative-pattern-monitor-v1',
    },
    firstRelevantWorldTime: 1000,
    lastProgressWorldTime: 1010,
    lastProgressLsn: 10,
    progressStep: 1,
    totalSteps: 2,
    directEvidenceAssertionInputs: [],
  }
  const instance = cls === 'satisfied' || cls === 'violated'
    ? { ...common, monitorVerdict: cls }
    : { ...common, monitorVerdict: 'inconclusive' as const, narrativeAnnotation: cls }
  return instance as unknown as NarrativePatternInstance
}

function idsOf(instances: readonly NarrativePatternInstance[]): readonly string[] {
  return instances.map((instance) => instance.patternInstanceId)
}

describe('B4 — the resource policy pins every RN019 §8 value and agrees with authored bounds', () => {
  it('pins the version and every proof-rig constant', () => {
    // The complete object, matched exactly. B5 added the last five numeric
    // fields; the thirteen above them are the committed B4 values, retained
    // byte-for-byte. A partial or subset match here would let a field silently
    // appear, disappear, or drift, which is exactly what this pin exists to
    // prevent (plan §10).
    expect(POLICY).toEqual({
      resourcePolicyVersion: 'attention-stage-b-resource-policy-v1',
      newestAdmittedEvidenceViews: 32,
      reconstructedInstancesPerPatternType: 6,
      activeStalledPartialsPerPatternType: 4,
      reconstructedInstancesGlobal: 12,
      conflictChildrenPerParent: 2,
      evidenceItemsPerInstance: 3,
      patternSteps: 3,
      mixedFamilyCandidatesAfterOrdering: 4,
      revealPackageAssertions: 4,
      presentationsPerEvaluation: 1,
      successfulPresentationsInWindow: 4,
      successfulPresentationCooldownLsns: 4,
      maxSuccessfulExposuresPerCandidateId: 2,
      revalidationFailureCooldownLsns: 2,
      consecutiveRevalidationFailuresBeforeRetirement: 2,
      satisfiedPatternRetirementLsns: 8,
      retentionClassOrder: [
        'satisfied',
        'active',
        'stalled',
        'violated',
        'expired',
        'abandoned',
      ],
    })
    expect(ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION).toBe('attention-stage-b-resource-policy-v1')
  })

  it('B5 — pins the five RN019 §8.4 exposure/cooldown/retirement values independently', () => {
    // Each value is asserted on its own as well as inside the exact object
    // above, so a mis-paired field/value cannot pass by coincidence.
    expect(POLICY.successfulPresentationCooldownLsns).toBe(4)
    expect(POLICY.maxSuccessfulExposuresPerCandidateId).toBe(2)
    expect(POLICY.revalidationFailureCooldownLsns).toBe(2)
    expect(POLICY.consecutiveRevalidationFailuresBeforeRetirement).toBe(2)
    expect(POLICY.satisfiedPatternRetirementLsns).toBe(8)
  })

  it('B5 — retains all thirteen committed B4 values unmoved by the field addition', () => {
    expect(POLICY.newestAdmittedEvidenceViews).toBe(32)
    expect(POLICY.reconstructedInstancesPerPatternType).toBe(6)
    expect(POLICY.activeStalledPartialsPerPatternType).toBe(4)
    expect(POLICY.reconstructedInstancesGlobal).toBe(12)
    expect(POLICY.conflictChildrenPerParent).toBe(2)
    expect(POLICY.evidenceItemsPerInstance).toBe(3)
    expect(POLICY.patternSteps).toBe(3)
    expect(POLICY.mixedFamilyCandidatesAfterOrdering).toBe(4)
    expect(POLICY.revealPackageAssertions).toBe(4)
    expect(POLICY.presentationsPerEvaluation).toBe(1)
    expect(POLICY.successfulPresentationsInWindow).toBe(4)
    expect(POLICY.resourcePolicyVersion).toBe('attention-stage-b-resource-policy-v1')
    expect(POLICY.retentionClassOrder).toEqual([
      'satisfied',
      'active',
      'stalled',
      'violated',
      'expired',
      'abandoned',
    ])
  })

  it('B5 — declares exactly the eighteen pinned field names and no others', () => {
    expect([...Object.keys(POLICY)].sort()).toEqual([...POLICY_FIELD_NAMES].sort())
    expect(Object.keys(POLICY)).toHaveLength(POLICY_FIELD_COUNT)
    expect(POLICY_FIELD_NAMES).toHaveLength(POLICY_FIELD_COUNT)
    // The name list is itself duplicate-free, so eighteen names really are
    // eighteen distinct fields.
    expect(new Set(POLICY_FIELD_NAMES).size).toBe(POLICY_FIELD_COUNT)
  })

  it('agrees with the authored B3 fork cap and the B1 admission window', () => {
    expect(POLICY.conflictChildrenPerParent).toBe(ATTENTION_NARRATIVE_PATTERN_CONFLICT_FORK_CHILD_CAP)
    expect(POLICY.newestAdmittedEvidenceViews).toBe(ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT)
  })

  it('is deeply immutable and hashes to a stable pattern-policy hash', () => {
    expect(Object.isFrozen(POLICY)).toBe(true)
    expect(Object.isFrozen(POLICY.retentionClassOrder)).toBe(true)
    expect(() => {
      ;(POLICY as { reconstructedInstancesGlobal: number }).reconstructedInstancesGlobal = 99
    }).toThrow()
    expect(ATTENTION_NARRATIVE_PATTERN_POLICY_HASH).toMatch(/^fnv1a64-v1:[0-9a-f]{16}$/)
  })

  it('B5 — deep immutability reaches the added fields and the nested retention-class ordering', () => {
    expect(() => {
      ;(POLICY as { satisfiedPatternRetirementLsns: number }).satisfiedPatternRetirementLsns = 99
    }).toThrow()
    expect(() => {
      ;(POLICY as { maxSuccessfulExposuresPerCandidateId: number })
        .maxSuccessfulExposuresPerCandidateId = 99
    }).toThrow()
    // The nested ordering cannot be reordered, extended, or truncated either:
    // it participates in the policy bytes, so a mutable copy would let the hash
    // and the real order disagree.
    expect(() => {
      ;(POLICY.retentionClassOrder as NarrativePatternRetentionClass[]).push('satisfied')
    }).toThrow()
    expect(() => {
      ;(POLICY.retentionClassOrder as NarrativePatternRetentionClass[])[0] = 'abandoned'
    }).toThrow()
    expect(POLICY.retentionClassOrder[0]).toBe('satisfied')
    expect(POLICY.retentionClassOrder).toHaveLength(6)
  })

  it('B5 — the pinned resource-policy version string does not move when fields are added', () => {
    expect(ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION).toBe('attention-stage-b-resource-policy-v1')
    expect(POLICY.resourcePolicyVersion).toBe('attention-stage-b-resource-policy-v1')
    // The version identifies the schema shape, not a value combination, so no
    // override may move it — a value edit is visible in the hash instead.
    for (const [field, value] of NUMERIC_POLICY_FIELD_VARIATIONS) {
      expect(overriddenPolicy(field, value).policy.resourcePolicyVersion)
        .toBe('attention-stage-b-resource-policy-v1')
    }
  })

  it('declares the exact versioned retention class order and rankable subset', () => {
    expect(NARRATIVE_PATTERN_RETENTION_CLASS_ORDER).toEqual([
      'satisfied',
      'active',
      'stalled',
      'violated',
      'expired',
      'abandoned',
    ])
    expect(NARRATIVE_PATTERN_RANKABLE_CLASSES).toEqual(['satisfied', 'active', 'stalled'])
  })
})

describe('B5 — every numeric policy value participates in the pattern-policy hash', () => {
  it('has a variation case for every numeric field, so none is unwitnessed', () => {
    // The variation list and the pinned name list are independent literals;
    // this equality is what stops a newly added policy field from having no
    // hash-participation case at all.
    expect([...NUMERIC_POLICY_FIELD_VARIATIONS.map(([field]) => field)].sort())
      .toEqual([...POLICY_FIELD_NAMES].filter(
        (name) => name !== 'resourcePolicyVersion' && name !== 'retentionClassOrder',
      ).sort())
    expect(NUMERIC_POLICY_FIELD_VARIATIONS).toHaveLength(POLICY_FIELD_COUNT - 2)
  })

  it('the default-valued build reproduces the pinned singleton hash exactly', () => {
    const built = buildAttentionStageBResourcePolicy()
    expect(built.policyHash).toBe(ATTENTION_NARRATIVE_PATTERN_POLICY_HASH)
    expect(canonicalSerialize(built.policy)).toBe(canonicalSerialize(POLICY))
  })

  it.each(NUMERIC_POLICY_FIELD_VARIATIONS)(
    'changing %s alone moves the pattern-policy hash and its canonical bytes',
    (field, value) => {
      const varied = overriddenPolicy(field, value)

      expect(varied.policy[field]).toBe(value)
      expect(varied.policyHash).not.toBe(ATTENTION_NARRATIVE_PATTERN_POLICY_HASH)
      expect(canonicalSerialize(varied.policy)).not.toBe(canonicalSerialize(POLICY))
      // Deterministic: the same override twice is byte-identical material.
      expect(overriddenPolicy(field, value).policyHash).toBe(varied.policyHash)
    },
  )

  it('no two single-field variations collide onto one hash', () => {
    const hashes = NUMERIC_POLICY_FIELD_VARIATIONS.map(
      ([field, value]) => overriddenPolicy(field, value).policyHash,
    )
    expect(new Set(hashes).size).toBe(NUMERIC_POLICY_FIELD_VARIATIONS.length)
  })
})

describe('B5 — test-policy overrides are separately hashed and never mutate the default singleton', () => {
  it('a zero-assertion override is a distinct, deterministic, frozen policy value', () => {
    const zeroAssertions = buildAttentionStageBResourcePolicy({ revealPackageAssertions: 0 })

    expect(zeroAssertions.policy.revealPackageAssertions).toBe(0)
    expect(zeroAssertions.policy.resourcePolicyVersion).toBe('attention-stage-b-resource-policy-v1')
    expect(zeroAssertions.policyHash).not.toBe(ATTENTION_NARRATIVE_PATTERN_POLICY_HASH)
    expect(zeroAssertions.policyHash).toMatch(/^fnv1a64-v1:[0-9a-f]{16}$/)
    expect(buildAttentionStageBResourcePolicy({ revealPackageAssertions: 0 }).policyHash)
      .toBe(zeroAssertions.policyHash)
    expect(Object.isFrozen(zeroAssertions.policy)).toBe(true)
    expect(Object.isFrozen(zeroAssertions)).toBe(true)
  })

  it('a zero-exposure override is a distinct, deterministic, frozen policy value', () => {
    const zeroExposures = buildAttentionStageBResourcePolicy({
      maxSuccessfulExposuresPerCandidateId: 0,
    })

    expect(zeroExposures.policy.maxSuccessfulExposuresPerCandidateId).toBe(0)
    expect(zeroExposures.policy.resourcePolicyVersion).toBe('attention-stage-b-resource-policy-v1')
    expect(zeroExposures.policyHash).not.toBe(ATTENTION_NARRATIVE_PATTERN_POLICY_HASH)
    expect(zeroExposures.policyHash).toMatch(/^fnv1a64-v1:[0-9a-f]{16}$/)
    expect(buildAttentionStageBResourcePolicy({ maxSuccessfulExposuresPerCandidateId: 0 }).policyHash)
      .toBe(zeroExposures.policyHash)
    expect(Object.isFrozen(zeroExposures.policy)).toBe(true)
  })

  it('the two zero overrides are distinct from each other, not one shared zero policy', () => {
    expect(buildAttentionStageBResourcePolicy({ revealPackageAssertions: 0 }).policyHash)
      .not.toBe(buildAttentionStageBResourcePolicy({ maxSuccessfulExposuresPerCandidateId: 0 }).policyHash)
  })

  it('repeated equivalent overrides produce byte-identical policy and hash material', () => {
    const first = buildAttentionStageBResourcePolicy({
      revealPackageAssertions: 0,
      maxSuccessfulExposuresPerCandidateId: 0,
    })
    // The same two overrides written in the opposite property order: canonical
    // serialization is key-sorted, so property order must not reach the bytes.
    const second = buildAttentionStageBResourcePolicy({
      maxSuccessfulExposuresPerCandidateId: 0,
      revealPackageAssertions: 0,
    })

    expect(canonicalSerialize(first.policy)).toBe(canonicalSerialize(second.policy))
    expect(first.policyHash).toBe(second.policyHash)
    expect(first.policy).toEqual(second.policy)
  })

  it('no override — including a zero one — mutates the default singleton or its hash', () => {
    const defaultBytesBefore = canonicalSerialize(POLICY)

    buildAttentionStageBResourcePolicy({ revealPackageAssertions: 0 })
    buildAttentionStageBResourcePolicy({ maxSuccessfulExposuresPerCandidateId: 0 })
    for (const [field, value] of NUMERIC_POLICY_FIELD_VARIATIONS) overriddenPolicy(field, value)

    expect(attentionStageBResourcePolicy()).toBe(POLICY)
    expect(canonicalSerialize(attentionStageBResourcePolicy())).toBe(defaultBytesBefore)
    expect(POLICY.revealPackageAssertions).toBe(4)
    expect(POLICY.maxSuccessfulExposuresPerCandidateId).toBe(2)
    expect(POLICY.satisfiedPatternRetirementLsns).toBe(8)
    expect(ATTENTION_NARRATIVE_PATTERN_POLICY_HASH)
      .toBe(buildAttentionStageBResourcePolicy().policyHash)
    expect(POLICY.retentionClassOrder).toEqual([
      'satisfied',
      'active',
      'stalled',
      'violated',
      'expired',
      'abandoned',
    ])
  })

  it('the default policy accessor returns the identical frozen singleton on every call', () => {
    expect(attentionStageBResourcePolicy()).toBe(attentionStageBResourcePolicy())
    expect(canonicalSerialize(attentionStageBResourcePolicy()))
      .toBe(canonicalSerialize(attentionStageBResourcePolicy()))
  })
})

describe('B4 — rankability: satisfied/active/stalled only', () => {
  it.each([
    ['satisfied', true],
    ['active', true],
    ['stalled', true],
    ['violated', false],
    ['expired', false],
    ['abandoned', false],
  ] as const)('classifies %s as rankable=%s', (cls, rankable) => {
    expect(isNarrativePatternInstanceRankable(fakeInstance('reciprocal_public_aid', cls, `id-${cls}`)))
      .toBe(rankable)
  })
})

describe('B4 — per-type reconstructed cap (all states) is 6: zero / exact / limit+1', () => {
  it('retains none when there are no instances', () => {
    const result = applyNarrativePatternStructuralRetention([])
    expect(result.retainedInstances).toEqual([])
    expect(result.retainedRankableInstances).toEqual([])
    expect(result.droppedInstanceIds).toEqual([])
    expect(result.resourceTrace).toEqual([])
  })

  it('retains exactly six of a type and reports no breach', () => {
    const instances = Array.from({ length: 6 }, (_, i) => (
      fakeInstance('reciprocal_public_aid', 'satisfied', `aid-${i}`)
    ))
    const result = applyNarrativePatternStructuralRetention(instances)
    expect(result.retainedInstances).toHaveLength(6)
    expect(result.resourceTrace).toEqual([])
  })

  it('drops the seventh and records a per-type-reconstructed breach with retained/dropped ids', () => {
    const forward = Array.from({ length: 7 }, (_, i) => (
      fakeInstance('reciprocal_public_aid', 'satisfied', `aid-${i}`)
    ))
    const result = applyNarrativePatternStructuralRetention(forward)
    const reversed = applyNarrativePatternStructuralRetention([...forward].reverse())

    expect(result.retainedInstances).toHaveLength(6)
    expect(result.droppedInstanceIds).toHaveLength(1)
    // Reversed input order yields the identical retained/dropped identity sets.
    expect(idsOf(result.retainedInstances)).toEqual(idsOf(reversed.retainedInstances))
    expect(result.droppedInstanceIds).toEqual(reversed.droppedInstanceIds)

    const breach = result.resourceTrace.find((entry) => entry.boundId === 'per-type-reconstructed')
    expect(breach).toBeDefined()
    expect(breach?.configuredValue).toBe(6)
    expect(breach?.observedValue).toBe(7)
    expect(breach?.patternType).toBe('reciprocal_public_aid')
    expect(breach?.retainedIdentities).toHaveLength(6)
    expect(breach?.droppedIdentities).toEqual(result.droppedInstanceIds)
  })
})

describe('B4 — per-type active/stalled live-partial cap is 4: zero / exact / limit+1', () => {
  it('retains four active/stalled partials of a type and reports no live breach', () => {
    const instances = [
      ...Array.from({ length: 2 }, (_, i) => fakeInstance('public_conflict_escalation', 'active', `act-${i}`)),
      ...Array.from({ length: 2 }, (_, i) => fakeInstance('public_conflict_escalation', 'stalled', `stl-${i}`)),
    ]
    const result = applyNarrativePatternStructuralRetention(instances)
    expect(result.retainedInstances).toHaveLength(4)
    expect(result.resourceTrace.some((entry) => entry.boundId === 'per-type-active-stalled')).toBe(false)
  })

  it('drops the fifth live partial (after the per-type total cap) and records the breach', () => {
    const instances = Array.from({ length: 5 }, (_, i) => (
      fakeInstance('public_conflict_escalation', 'active', `act-${i}`)
    ))
    const result = applyNarrativePatternStructuralRetention(instances)

    expect(result.retainedInstances).toHaveLength(4)
    expect(result.droppedInstanceIds).toHaveLength(1)
    const breach = result.resourceTrace.find((entry) => entry.boundId === 'per-type-active-stalled')
    expect(breach?.configuredValue).toBe(4)
    expect(breach?.observedValue).toBe(5)
    expect(breach?.patternType).toBe('public_conflict_escalation')
  })

  it('keeps satisfied instances beyond the live cap: only active/stalled compete for it', () => {
    const instances = [
      fakeInstance('reciprocal_public_aid', 'satisfied', 'sat-0'),
      fakeInstance('reciprocal_public_aid', 'satisfied', 'sat-1'),
      ...Array.from({ length: 4 }, (_, i) => fakeInstance('reciprocal_public_aid', 'active', `act-${i}`)),
    ]
    const result = applyNarrativePatternStructuralRetention(instances)
    // 2 satisfied + 4 active = 6, all under the per-type total cap of 6, and the
    // four active are exactly at the live cap, so nothing is dropped.
    expect(result.retainedInstances).toHaveLength(6)
    expect(result.resourceTrace).toEqual([])
  })
})

describe('B4 — global reconstructed cap is 12, forced non-vacuously after per-type caps', () => {
  it('retains all when there are twelve across three types', () => {
    const instances = [
      ...Array.from({ length: 4 }, (_, i) => fakeInstance('reciprocal_public_aid', 'satisfied', `aid-${i}`)),
      ...Array.from({ length: 4 }, (_, i) => fakeInstance('public_conflict_escalation', 'satisfied', `con-${i}`)),
      ...Array.from({ length: 4 }, (_, i) => fakeInstance('public_commitment_fulfilled', 'satisfied', `com-${i}`)),
    ]
    const result = applyNarrativePatternStructuralRetention(instances)
    expect(result.retainedInstances).toHaveLength(12)
    expect(result.resourceTrace.some((entry) => entry.boundId === 'global-reconstructed')).toBe(false)
  })

  it('drops the thirteenth: five + four + four all survive their per-type caps, then global caps to twelve', () => {
    const instances = [
      ...Array.from({ length: 5 }, (_, i) => fakeInstance('reciprocal_public_aid', 'satisfied', `aid-${i}`)),
      ...Array.from({ length: 4 }, (_, i) => fakeInstance('public_conflict_escalation', 'satisfied', `con-${i}`)),
      ...Array.from({ length: 4 }, (_, i) => fakeInstance('public_commitment_fulfilled', 'satisfied', `com-${i}`)),
    ]
    // Per-type caps (6 each) permit all 13; the global cap of 12 is the real
    // decider (RN019 §8.1's non-vacuous global-limit requirement).
    const forward = applyNarrativePatternStructuralRetention(instances)
    const reversed = applyNarrativePatternStructuralRetention([...instances].reverse())

    expect(forward.retainedInstances).toHaveLength(12)
    expect(forward.droppedInstanceIds).toHaveLength(1)
    expect(idsOf(forward.retainedInstances)).toEqual(idsOf(reversed.retainedInstances))
    expect(forward.droppedInstanceIds).toEqual(reversed.droppedInstanceIds)

    const breach = forward.resourceTrace.find((entry) => entry.boundId === 'global-reconstructed')
    expect(breach?.configuredValue).toBe(12)
    expect(breach?.observedValue).toBe(13)
    expect(breach?.patternType).toBeNull()
  })
})

describe('B4 — terminal non-rankability and the retention class order', () => {
  it('retains terminal instances for trace but excludes them from the rankable set', () => {
    const instances = [
      fakeInstance('reciprocal_public_aid', 'satisfied', 'sat'),
      fakeInstance('reciprocal_public_aid', 'active', 'act'),
      fakeInstance('reciprocal_public_aid', 'stalled', 'stl'),
      fakeInstance('reciprocal_public_aid', 'violated', 'vio'),
      fakeInstance('reciprocal_public_aid', 'expired', 'exp'),
      fakeInstance('reciprocal_public_aid', 'abandoned', 'aba'),
    ]
    const result = applyNarrativePatternStructuralRetention(instances)

    expect(idsOf(result.retainedInstances)).toEqual(['sat', 'act', 'stl', 'vio', 'exp', 'aba'])
    expect(idsOf(result.retainedRankableInstances)).toEqual(['sat', 'act', 'stl'])
  })
})

describe('B4 — the mixed-family candidate cap is 4: zero / exact / limit+1', () => {
  const candidate = (id: string) => ({ candidateId: id })

  it('retains all when four or fewer candidates are ordered', () => {
    const exact = applyMixedFamilyCandidateCap([candidate('a'), candidate('b'), candidate('c'), candidate('d')])
    expect(exact.retainedCandidates.map((entry) => entry.candidateId)).toEqual(['a', 'b', 'c', 'd'])
    expect(exact.resourceTrace).toBeNull()

    const zero = applyMixedFamilyCandidateCap([])
    expect(zero.retainedCandidates).toEqual([])
    expect(zero.resourceTrace).toBeNull()
  })

  it('drops the fifth after ordering and records the engine-only breach', () => {
    const result = applyMixedFamilyCandidateCap([
      candidate('a'), candidate('b'), candidate('c'), candidate('d'), candidate('e'),
    ])
    expect(result.retainedCandidates.map((entry) => entry.candidateId)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.resourceTrace).toEqual({
      boundId: 'mixed-family-candidate',
      patternType: null,
      configuredValue: 4,
      observedValue: 5,
      retainedIdentities: ['a', 'b', 'c', 'd'],
      droppedIdentities: ['e'],
    })
  })
})
