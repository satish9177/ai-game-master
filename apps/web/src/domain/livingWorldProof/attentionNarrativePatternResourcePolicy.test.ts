import { describe, expect, it } from 'vitest'
import {
  ATTENTION_NARRATIVE_PATTERN_POLICY_HASH,
  ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
  NARRATIVE_PATTERN_RANKABLE_CLASSES,
  NARRATIVE_PATTERN_RETENTION_CLASS_ORDER,
  applyMixedFamilyCandidateCap,
  applyNarrativePatternStructuralRetention,
  attentionStageBResourcePolicy,
  isNarrativePatternInstanceRankable,
} from './attentionNarrativePatternResourcePolicy'
import type { NarrativePatternRetentionClass } from './attentionNarrativePatternResourcePolicy'
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
 */

const POLICY = attentionStageBResourcePolicy()

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
