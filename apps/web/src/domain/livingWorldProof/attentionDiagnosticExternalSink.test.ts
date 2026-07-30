import { describe, expect, it } from 'vitest'
import { classifyAttentionDiagnostic, emitAttentionDiagnosticToExternalSink } from './attentionDiagnosticPartition'

describe('C7 external diagnostic sink', () => {
  it('refuses engine-only emission and type-A aggregation while allowing only an individual type-A code', () => {
    expect(emitAttentionDiagnosticToExternalSink({ classification: classifyAttentionDiagnostic('resource_limit_exceeded'), aggregate: false }))
      .toEqual({ kind: 'refused', reason: 'engine-only-diagnostic' })
    expect(emitAttentionDiagnosticToExternalSink({ classification: classifyAttentionDiagnostic('no_legal_channel'), aggregate: true }))
      .toEqual({ kind: 'refused', reason: 'external-diagnostic-aggregation-forbidden' })
    expect(emitAttentionDiagnosticToExternalSink({ classification: classifyAttentionDiagnostic('no_legal_channel'), aggregate: false }))
      .toEqual({ kind: 'ok', code: 'no_legal_channel' })
  })
})
