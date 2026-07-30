import { describe, expect, it } from 'vitest'
import { evaluateAttentionAggregateLegitimacy } from './attentionAggregateLegitimacy'
import type { AttentionInferenceProvenance } from './attentionInferenceProvenance'
import { validateAttentionInferenceProvenance } from './attentionInferenceProvenance'
import {
  ATTENTION_INFERENCE_PROVENANCE_EDGE_OVERFLOW_POLICY,
  ATTENTION_INFERENCE_PROVENANCE_NODE_OVERFLOW_POLICY,
  ATTENTION_INFERENCE_PROVENANCE_POLICY,
} from './attentionInferenceProvenancePolicy'
import { PUBLIC_AID_LINK_EXTENSION_V1 } from './attentionInferenceRuleLibrary'
import { buildC1ReciprocalAidAssertions } from './attentionInferenceScenario'
import { buildAttentionDirectEvidenceAssertions } from './attentionDirectEvidenceAssertion'

function direct(actorId: string, targetId: string, sourceRecordId: string) {
  const built = buildAttentionDirectEvidenceAssertions([{
    actorId, assertionKind: 'public_aid', sourceRecordId, targetId,
    visibilityProvenanceId: `${sourceRecordId}-public`,
  }])
  if (built.kind !== 'ok') throw new Error('fixture construction refused')
  return built.assertions[0]!
}

function reciprocal() {
  const result = evaluateAttentionAggregateLegitimacy({
    policyRef: 'aggregate-legitimacy-c1-v1', sourceKind: 'narrative_pattern_instance',
    sources: buildC1ReciprocalAidAssertions(),
  })
  if (result.kind !== 'ok') throw new Error('expected reciprocal aggregate')
  return result.aggregate
}

function extension() {
  const result = evaluateAttentionAggregateLegitimacy({
    policyRef: 'aggregate-legitimacy-c1-v1', sourceKind: 'narrative_pattern_instance',
    ruleId: PUBLIC_AID_LINK_EXTENSION_V1.ruleId,
    sources: [direct('b', 'c', 'c1-aid-b-c'), reciprocal()],
  })
  if (result.kind !== 'ok') throw new Error('expected extension aggregate')
  return result.aggregate
}

describe('C1 inference provenance validation', () => {
  it('pins canonical bytes and aggregate-first/direct-second for a legal extension', () => {
    const root = extension()
    const validated = validateAttentionInferenceProvenance(root.provenance, ATTENTION_INFERENCE_PROVENANCE_POLICY)
    expect(validated.kind).toBe('ok')
    if (validated.kind !== 'ok') return
    expect(root.provenance.sources.map((source) => source.kind)).toEqual(['aggregate', 'positive_record'])
    expect(validated.value).toMatchObject({ edgeCount: 4, maxDepth: 2, nodeCount: 5 })
    expect(validated.value.canonicalBytes).toContain('public_aid_link_extension_v1')
  })

  it('refuses self and multi-node cycles deterministically', () => {
    const self = { ...extension().provenance } as unknown as { assertionId: string; sources: unknown[] }
    self.sources = [{ kind: 'aggregate', assertionId: self.assertionId, provenance: self }, {
      kind: 'positive_record', assertionId: 'cycle-direct', sourceRecordId: 'cycle-record',
    }]
    expect(validateAttentionInferenceProvenance(self as unknown as AttentionInferenceProvenance, ATTENTION_INFERENCE_PROVENANCE_POLICY))
      .toEqual({ kind: 'refused', reason: 'provenance_cycle' })

    const left = { ...extension().provenance } as unknown as { assertionId: string; sources: unknown[] }
    const right = { ...extension().provenance, assertionId: 'other-cycle-root' } as unknown as { assertionId: string; sources: unknown[] }
    left.sources = [{ kind: 'aggregate', assertionId: right.assertionId, provenance: right }, {
      kind: 'positive_record', assertionId: 'left-direct', sourceRecordId: 'left-record',
    }]
    right.sources = [{ kind: 'aggregate', assertionId: left.assertionId, provenance: left }, {
      kind: 'positive_record', assertionId: 'right-direct', sourceRecordId: 'right-record',
    }]
    expect(validateAttentionInferenceProvenance(left as unknown as AttentionInferenceProvenance, ATTENTION_INFERENCE_PROVENANCE_POLICY))
      .toEqual({ kind: 'refused', reason: 'provenance_cycle' })
  })

  it('enforces the pinned node and edge budgets before rendering or packaging', () => {
    const provenance = extension().provenance
    expect(validateAttentionInferenceProvenance(provenance, {
      ...ATTENTION_INFERENCE_PROVENANCE_POLICY,
      maxDepth: 0,
    })).toEqual({ kind: 'refused', reason: 'provenance_depth_exceeded' })
    expect(validateAttentionInferenceProvenance(provenance, ATTENTION_INFERENCE_PROVENANCE_NODE_OVERFLOW_POLICY))
      .toEqual({ kind: 'refused', reason: 'provenance_budget_exceeded' })
    expect(validateAttentionInferenceProvenance(provenance, ATTENTION_INFERENCE_PROVENANCE_EDGE_OVERFLOW_POLICY))
      .toEqual({ kind: 'refused', reason: 'provenance_budget_exceeded' })
  })

  it('refuses incomplete or unpinned rule coordinates', () => {
    const provenance = extension().provenance
    const tampered = { ...provenance, ruleContentHash: 'forged-rule-hash' }
    expect(validateAttentionInferenceProvenance(tampered, ATTENTION_INFERENCE_PROVENANCE_POLICY))
      .toEqual({ kind: 'refused', reason: 'provenance_incomplete' })
    const syntheticAggregateRecord = {
      ...provenance,
      sources: [{ ...provenance.sources[0]!, sourceRecordId: 'synthetic-aggregate-record' }, provenance.sources[1]!],
    }
    expect(validateAttentionInferenceProvenance(syntheticAggregateRecord as AttentionInferenceProvenance, ATTENTION_INFERENCE_PROVENANCE_POLICY))
      .toEqual({ kind: 'refused', reason: 'provenance_incomplete' })
  })
})
