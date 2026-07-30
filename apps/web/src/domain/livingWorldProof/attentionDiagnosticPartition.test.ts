import { describe, expect, it } from 'vitest'
import {
  ATTENTION_INTERNAL_REFUSAL_LITERALS,
  ATTENTION_TYPE_A_DIAGNOSTIC_CODES,
  ATTENTION_TYPE_B_DIAGNOSTIC_CODES,
  classifyAttentionDiagnostic,
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
})
