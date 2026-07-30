import { describe, expect, it } from 'vitest'
import { createAttentionLedger } from './attentionLedger'
import { runAttentionMixedFamilyEvaluation } from './attentionReplay'
import { buildB6PatternOnlyEvaluationInput } from './attentionReplayScenario'
import { evaluateAttentionAggregateLegitimacy } from './attentionAggregateLegitimacy'
import { buildAttentionDirectEvidenceAssertions } from './attentionDirectEvidenceAssertion'
import { buildC1ReciprocalAidAssertions } from './attentionInferenceScenario'

describe('C1 aggregate legitimacy replay', () => {
  it('uses the existing mixed evaluator/package/template/ledger route for a licensed aggregate', () => {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: 'attention-ledger-policy-v1' })
    if (ledger.kind !== 'ok') throw new Error('expected test ledger')
    const input = buildB6PatternOnlyEvaluationInput('c1-reciprocal', ledger.ledger)
    const result = runAttentionMixedFamilyEvaluation({
      ...input,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-c1-v1',
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.result.arbitrationAttempts[0]?.refusalReason).toBeNull()
    expect(result.result.presentation?.output).toContain('public aid was exchanged')
    expect(result.result.ledger.records).toHaveLength(1)
  })

  it('routes the normalized extension aggregate through the same evaluator without a synthetic aggregate record id', () => {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: 'attention-ledger-policy-v1' })
    if (ledger.kind !== 'ok') throw new Error('expected test ledger')
    const reciprocal = evaluateAttentionAggregateLegitimacy({
      policyRef: 'aggregate-legitimacy-c1-v1', sourceKind: 'narrative_pattern_instance',
      sources: buildC1ReciprocalAidAssertions(),
    })
    const direct = buildAttentionDirectEvidenceAssertions([{
      actorId: 'b', assertionKind: 'public_aid', sourceRecordId: 'c1-aid-b-c', targetId: 'c',
      visibilityProvenanceId: 'c1-aid-b-c-public',
    }])
    if (reciprocal.kind !== 'ok' || direct.kind !== 'ok') throw new Error('expected C1 evidence')
    const base = buildB6PatternOnlyEvaluationInput('c1-extension', ledger.ledger)
    const first = base.patternPresentationInputs[0]!
    const result = runAttentionMixedFamilyEvaluation({
      ...base,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-c1-v1',
      patternPresentationInputs: Object.freeze([{
        ...first,
        aggregateSources: Object.freeze([direct.assertions[0]!, reciprocal.aggregate]),
      }]),
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.result.presentation?.output).toContain('recorded public aid linked/a|b|c')
    expect(result.result.ledger.records).toHaveLength(1)
  })
})
