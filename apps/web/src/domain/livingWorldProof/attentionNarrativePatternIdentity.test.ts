import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
  ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
  ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
  ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
} from './attentionCandidatePolicy'
import {
  canonicalNarrativePatternIdentityBytes,
  computeNarrativePatternInstanceId,
  deduplicateNarrativePatternInstances,
} from './attentionNarrativePatternIdentity'
import type {
  NarrativePatternIdentityInput,
} from './attentionNarrativePatternIdentity'

function identityInput(): NarrativePatternIdentityInput {
  return {
    patternType: 'reciprocal_public_aid',
    patternSemanticVersion: ATTENTION_NARRATIVE_PATTERN_SEMANTIC_VERSION,
    patternContentHash: 'pattern-content-aid-v1',
    monitorRuleVersion: ATTENTION_NARRATIVE_PATTERN_MONITOR_RULE_VERSION,
    canonicalizationVersion: ATTENTION_CANDIDATE_CANONICALIZATION_VERSION,
    identitySchemaVersion: ATTENTION_NARRATIVE_PATTERN_IDENTITY_SCHEMA_VERSION,
    bindingMap: [
      { role: 'counterparty', entityId: 'npc-b' },
      { role: 'initiator', entityId: 'npc-a' },
    ],
    supportingRecordIdentityTuple: [
      {
        semanticRole: 'aid-start',
        recordKind: 'observable_action',
        recordId: 'aid-1',
        visibilityProvenanceId: 'public-aid-1',
        commitLsn: 7,
      },
    ],
  }
}

const EXPECTED_AID_IDENTITY_BYTES =
  '{"bindingTuple":[["initiator","npc-a"],["counterparty","npc-b"]],"canonicalizationVersion":"attention-candidate-canonicalization-v1","identitySchemaVersion":"attention-narrative-pattern-identity-schema-v1","monitorRuleVersion":"attention-narrative-pattern-monitor-v1","patternContentHash":"pattern-content-aid-v1","patternSemanticVersion":1,"patternType":"reciprocal_public_aid","sourceKind":"narrative_pattern_instance","supportingRecordIdentityTuple":[["aid-start","observable_action","aid-1","public-aid-1",7]]}'

const EXPECTED_AID_ID =
  'attention-narrative-pattern-identity-schema-v1:fnv1a64-v1:cc4d2a8b332417da'

function instanceFor(input: NarrativePatternIdentityInput, patternInstanceId?: string) {
  return Object.freeze({
    ...input,
    patternInstanceId: patternInstanceId ?? computeNarrativePatternInstanceId(input),
  })
}

afterEach(() => {
  vi.doUnmock('./canonicalSerialization')
})

describe('B2 NarrativePatternInstance identity', () => {
  it('matches independently pinned canonical bytes and ID', () => {
    expect(canonicalNarrativePatternIdentityBytes(identityInput())).toBe(EXPECTED_AID_IDENTITY_BYTES)
    expect(computeNarrativePatternInstanceId(identityInput())).toBe(EXPECTED_AID_ID)
  })

  it('is deterministic and independent of binding and supporting-record insertion order', () => {
    const original = identityInput()
    const reversed = {
      ...identityInput(),
      bindingMap: [...identityInput().bindingMap].reverse(),
      supportingRecordIdentityTuple: [...identityInput().supportingRecordIdentityTuple].reverse(),
    }
    expect(canonicalNarrativePatternIdentityBytes(original))
      .toBe(canonicalNarrativePatternIdentityBytes(identityInput()))
    expect(computeNarrativePatternInstanceId(original))
      .toBe(computeNarrativePatternInstanceId(reversed))
  })

  it.each([
    ['pattern semantic version', (value: NarrativePatternIdentityInput) => ({
      ...value,
      patternSemanticVersion: 2,
    })],
    ['pattern content hash', (value: NarrativePatternIdentityInput) => ({
      ...value,
      patternContentHash: 'changed',
    })],
    ['monitor-rule version', (value: NarrativePatternIdentityInput) => ({
      ...value,
      monitorRuleVersion: 'changed',
    })],
    ['canonicalization version', (value: NarrativePatternIdentityInput) => ({
      ...value,
      canonicalizationVersion: 'changed',
    })],
    ['identity-schema version', (value: NarrativePatternIdentityInput) => ({
      ...value,
      identitySchemaVersion: 'changed',
    })],
    ['binding entity', (value: NarrativePatternIdentityInput) => ({
      ...value,
      bindingMap: value.bindingMap.map((entry) => (
        entry.role === 'initiator' ? { ...entry, entityId: 'npc-c' } : entry
      )),
    })],
    ['supporting semantic role', (value: NarrativePatternIdentityInput) => ({
      ...value,
      supportingRecordIdentityTuple: value.supportingRecordIdentityTuple.map((entry) => ({
        ...entry,
        semanticRole: 'aid-return' as const,
      })),
    })],
    ['recordKind', (value: NarrativePatternIdentityInput) => ({
      ...value,
      supportingRecordIdentityTuple: value.supportingRecordIdentityTuple.map((entry) => ({
        ...entry,
        recordKind: 'validated_public_communication' as const,
      })),
    })],
    ['recordId', (value: NarrativePatternIdentityInput) => ({
      ...value,
      supportingRecordIdentityTuple: value.supportingRecordIdentityTuple.map((entry) => ({
        ...entry,
        recordId: 'aid-2',
      })),
    })],
    ['visibilityProvenanceId', (value: NarrativePatternIdentityInput) => ({
      ...value,
      supportingRecordIdentityTuple: value.supportingRecordIdentityTuple.map((entry) => ({
        ...entry,
        visibilityProvenanceId: 'public-aid-other',
      })),
    })],
    ['supporting commitLsn', (value: NarrativePatternIdentityInput) => ({
      ...value,
      supportingRecordIdentityTuple: value.supportingRecordIdentityTuple.map((entry) => ({
        ...entry,
        commitLsn: 8,
      })),
    })],
  ])('changes identity when only %s changes', (_label, mutate) => {
    const original = identityInput()
    expect(computeNarrativePatternInstanceId(mutate(original)))
      .not.toBe(computeNarrativePatternInstanceId(original))
  })

  it.each([
    'evaluationSnapshotLsn',
    'rank',
    'resourcePolicyVersion',
    'retained',
    'exposure',
    'cooldown',
    'retirement',
    'templateVersion',
    'presentationVersion',
  ])('does not change identity when only %s changes', (field) => {
    const baseline = { ...identityInput(), [field]: 'baseline' }
    const changed = { ...baseline, [field]: 'changed' }
    expect(computeNarrativePatternInstanceId(baseline))
      .toBe(computeNarrativePatternInstanceId(changed))
  })

  it('collapses equal canonical bytes regardless of object identity', () => {
    const firstInput = identityInput()
    const secondInput = {
      ...identityInput(),
      bindingMap: [...identityInput().bindingMap].reverse(),
    }
    const result = deduplicateNarrativePatternInstances([
      instanceFor(firstInput),
      instanceFor(secondInput),
    ])
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.instances).toHaveLength(1)
  })

  it('keeps unequal canonical bytes with unequal derived IDs distinct', () => {
    const firstInput = identityInput()
    const secondInput = { ...identityInput(), patternContentHash: 'different-content' }
    const result = deduplicateNarrativePatternInstances([
      instanceFor(firstInput),
      instanceFor(secondInput),
    ])
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.instances).toHaveLength(2)
  })

  it('refuses a manually different supplied ID before deduplication', () => {
    const input = identityInput()
    expect(deduplicateNarrativePatternInstances([
      instanceFor(input),
      instanceFor(input, 'manually-different-id'),
    ])).toEqual({ kind: 'refused', reason: 'invalid-narrative-pattern-instance-id' })
  })

  it('forces a real deterministic hash collision at the existing hash seam and fails closed', async () => {
    vi.resetModules()
    vi.doMock('./canonicalSerialization', async () => {
      const actual = await vi.importActual<typeof import('./canonicalSerialization')>(
        './canonicalSerialization',
      )
      return { ...actual, mintHash: () => 'forced-hash-v1:collision' }
    })
    const collisionIdentity = await import('./attentionNarrativePatternIdentity')
    const firstInput = identityInput()
    const secondInput = { ...identityInput(), patternContentHash: 'different-content' }
    expect(collisionIdentity.canonicalNarrativePatternIdentityBytes(firstInput))
      .not.toBe(collisionIdentity.canonicalNarrativePatternIdentityBytes(secondInput))
    const firstId = collisionIdentity.computeNarrativePatternInstanceId(firstInput)
    const secondId = collisionIdentity.computeNarrativePatternInstanceId(secondInput)
    expect(firstId).toBe(secondId)
    expect(collisionIdentity.deduplicateNarrativePatternInstances([
      Object.freeze({ ...firstInput, patternInstanceId: firstId }),
      Object.freeze({ ...secondInput, patternInstanceId: secondId }),
    ])).toEqual({ kind: 'refused', reason: 'narrative-pattern-identity-collision' })
  })
})
