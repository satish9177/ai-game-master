import { describe, expect, it } from 'vitest'
import { evaluateAttentionAggregateLegitimacy } from './attentionAggregateLegitimacy'
import { buildAttentionDirectEvidenceAssertions } from './attentionDirectEvidenceAssertion'
import { ATTENTION_INFERENCE_PROVENANCE_POLICY } from './attentionInferenceProvenancePolicy'
import { PUBLIC_AID_LINK_EXTENSION_V1 } from './attentionInferenceRuleLibrary'
import { buildC1ReciprocalAidAssertions } from './attentionInferenceScenario'

function direct(actorId: string, targetId: string, sourceRecordId: string) {
  const built = buildAttentionDirectEvidenceAssertions([
    { actorId, assertionKind: 'public_aid', sourceRecordId, targetId, visibilityProvenanceId: `${sourceRecordId}-public` },
  ])
  if (built.kind !== 'ok') throw new Error('fixture construction refused')
  return built.assertions[0]!
}

function reciprocal() {
  const result = evaluateAttentionAggregateLegitimacy({
    policyRef: 'aggregate-legitimacy-c1-v1',
    sourceKind: 'narrative_pattern_instance',
    sources: buildC1ReciprocalAidAssertions(),
  })
  if (result.kind !== 'ok') throw new Error('expected reciprocal aggregate')
  return result.aggregate
}

describe('C1 aggregate legitimacy', () => {
  it('builds the closed reciprocal conclusion from two opposite direct public-aid sources', () => {
    const result = reciprocal()
    expect(result.token).toBe('public aid was exchanged')
    expect(result.participants).toEqual(['a', 'b'])
    expect(result.provenance.sources.map((source) => source.kind)).toEqual(['positive_record', 'positive_record'])
  })

  it('normalizes extension sources to aggregate-first/direct-second without a synthetic record id', () => {
    const aggregate = reciprocal()
    const directSource = direct('b', 'c', 'c1-aid-b-c')
    const authored = evaluateAttentionAggregateLegitimacy({
      policyRef: 'aggregate-legitimacy-c1-v1', sourceKind: 'narrative_pattern_instance',
      ruleId: PUBLIC_AID_LINK_EXTENSION_V1.ruleId, sources: [aggregate, directSource],
    })
    const reversed = evaluateAttentionAggregateLegitimacy({
      policyRef: 'aggregate-legitimacy-c1-v1', sourceKind: 'narrative_pattern_instance',
      ruleId: PUBLIC_AID_LINK_EXTENSION_V1.ruleId, sources: [directSource, aggregate],
    })
    expect(authored.kind).toBe('ok')
    expect(reversed).toEqual(authored)
    if (authored.kind !== 'ok') return
    expect(authored.aggregate.participants).toEqual(['a', 'b', 'c'])
    expect(authored.aggregate.provenance.sources.map((source) => source.kind)).toEqual(['aggregate', 'positive_record'])
    expect('sourceRecordId' in authored.aggregate.provenance.sources[0]!).toBe(false)
    expect(authored.aggregate.provenance.sources[1]).toMatchObject({ sourceRecordId: 'c1-aid-b-c' })
  })

  it('refuses the extension rule for either illegal source-kind pair', () => {
    const aggregate = reciprocal()
    const directSource = direct('b', 'c', 'c1-aid-b-c')
    for (const sources of [[directSource, direct('c', 'd', 'c1-aid-c-d')], [aggregate, aggregate]] as const) {
      expect(evaluateAttentionAggregateLegitimacy({
        policyRef: 'aggregate-legitimacy-c1-v1', sourceKind: 'narrative_pattern_instance',
        ruleId: PUBLIC_AID_LINK_EXTENSION_V1.ruleId, sources,
      })).toEqual({ kind: 'refused', reason: 'aggregate_assertion_not_legal' })
    }
  })

  it('does not enter C1 for disabled or quest inputs', () => {
    const sources = buildC1ReciprocalAidAssertions()
    expect(evaluateAttentionAggregateLegitimacy({
      policyRef: 'aggregate-legitimacy-disabled-v0', sourceKind: 'narrative_pattern_instance', sources,
    })).toEqual({ kind: 'bypassed' })
    expect(evaluateAttentionAggregateLegitimacy({
      policyRef: 'aggregate-legitimacy-c1-v1', sourceKind: 'quest_candidate', sources,
    })).toEqual({ kind: 'bypassed' })
    expect(evaluateAttentionAggregateLegitimacy({
      sourceKind: 'narrative_pattern_instance', sources,
    } as Parameters<typeof evaluateAttentionAggregateLegitimacy>[0]))
      .toEqual({ kind: 'refused', reason: 'aggregate_assertion_not_legal' })
  })

  it('enforces the exact extension resource ceiling structurally', () => {
    const aggregate = reciprocal()
    const directSource = direct('b', 'c', 'c1-aid-b-c')
    const result = evaluateAttentionAggregateLegitimacy({
      policyRef: 'aggregate-legitimacy-c1-v1', sourceKind: 'narrative_pattern_instance',
      ruleId: PUBLIC_AID_LINK_EXTENSION_V1.ruleId, sources: [aggregate, directSource],
      provenancePolicy: ATTENTION_INFERENCE_PROVENANCE_POLICY,
    })
    expect(result.kind).toBe('ok')
  })
})
