import { describe, expect, it } from 'vitest'
import {
  ATTENTION_INTERNAL_REFUSAL_LITERALS,
  ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS,
  ATTENTION_RUNTIME_REFUSAL_OWNER,
  ATTENTION_RUNTIME_REFUSALS_BY_GROUP,
  ATTENTION_RUNTIME_REFUSALS_BY_DIAGNOSTIC,
  ATTENTION_TYPE_A_DIAGNOSTIC_CODES,
  ATTENTION_TYPE_B_DIAGNOSTIC_CODES,
  classifyAttentionDiagnostic,
  classifyAttentionRuntimeRefusal,
} from './attentionDiagnosticPartition'

describe('C7 diagnostic partition', () => {
  it('maps every closed internal literal exactly once and reaches every D11 type-A code', () => {
    const classifications = ATTENTION_INTERNAL_REFUSAL_LITERALS.map((code) => classifyAttentionDiagnostic(code))
    expect(classifications).toHaveLength(new Set(ATTENTION_INTERNAL_REFUSAL_LITERALS).size)
    expect(classifications.filter((entry) => entry.resultType === 'PlayerObservableAttentionResult').map((entry) => entry.code).sort())
      .toEqual([...ATTENTION_TYPE_A_DIAGNOSTIC_CODES].sort())
    expect(classifications.filter((entry) => entry.resultType === 'EngineOnlyAttentionDiagnostic').map((entry) => entry.code).sort())
      .toEqual([...ATTENTION_TYPE_B_DIAGNOSTIC_CODES].sort())
  })

  it('keeps all nine provenance causes behind the same observable fallback', () => {
    const provenance = ATTENTION_TYPE_B_DIAGNOSTIC_CODES.filter((code) => code.includes('provenance') || code.startsWith('absence_'))
    expect(provenance).toHaveLength(9)
    expect(provenance.map((code) => classifyAttentionDiagnostic(code).fallback)).toEqual(Array(9).fill('provenance_missing'))
  })

  it('owns every actual runtime refusal exactly once through a distinct, bidirectional C7 group before its generic observable outcome', () => {
    const runtimeLiterals = Object.keys(ATTENTION_RUNTIME_REFUSAL_OWNER)
    expect(runtimeLiterals).toEqual(expect.arrayContaining([
      'candidate-disappeared', 'cache-key-mismatch', 'missing-template-version',
      'invalid-communication-command', 'authoritative-log-version-mismatch',
      'aggregate_assertion_not_legal', 'absence_match_exists', 'reveal_scope_expansion_attempt',
    ]))
    const reverse = Object.values(ATTENTION_RUNTIME_REFUSALS_BY_GROUP).flat()
    expect([...reverse].sort()).toEqual([...runtimeLiterals].sort())
    for (const runtime of runtimeLiterals) {
      const classification = classifyAttentionRuntimeRefusal(runtime as keyof typeof ATTENTION_RUNTIME_REFUSAL_OWNER)
      const group = ATTENTION_RUNTIME_REFUSAL_OWNER[runtime as keyof typeof ATTENTION_RUNTIME_REFUSAL_OWNER]
      expect(group).not.toBe(runtime)
      expect(ATTENTION_RUNTIME_REFUSALS_BY_GROUP[group]).toContain(runtime)
      expect(classification.code).toBe(ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS[group])
    }
    expect(Object.keys(ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS).sort())
      .toEqual(Object.keys(ATTENTION_RUNTIME_REFUSALS_BY_GROUP).sort())
  })
})
