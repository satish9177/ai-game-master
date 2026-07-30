/** C7's closed D11 partition. It classifies existing refusal literals only; it
 * does not decide when any refusal fires. */
export const ATTENTION_TYPE_A_DIAGNOSTIC_CODES = Object.freeze([
  'no_legal_channel', 'no_legal_revealer', 'stale_snapshot', 'candidate_disappeared',
  'policy_hash_mismatch', 'provenance_missing', 'aggregate_assertion_not_legal', 'phrasing_failed',
] as const)
export type AttentionTypeADiagnosticCode = typeof ATTENTION_TYPE_A_DIAGNOSTIC_CODES[number]

export const ATTENTION_TYPE_B_DIAGNOSTIC_CODES = Object.freeze([
  'resource_limit_exceeded', 'provenance_cycle', 'provenance_depth_exceeded',
  'provenance_budget_exceeded', 'provenance_incomplete', 'absence_match_exists',
  'absence_relation_not_closed', 'absence_window_incomplete',
  'absence_completeness_certificate_missing', 'absence_certificate_not_structural',
  'reveal_scope_expansion_attempt', 'validator_rejection_detail',
] as const)
export type AttentionTypeBDiagnosticCode = typeof ATTENTION_TYPE_B_DIAGNOSTIC_CODES[number]

export type AttentionDiagnosticCode = AttentionTypeADiagnosticCode | AttentionTypeBDiagnosticCode
export type AttentionDiagnosticClassification =
  | { readonly resultType: 'PlayerObservableAttentionResult'; readonly code: AttentionTypeADiagnosticCode; readonly playerVisible: true; readonly externallyAggregatable: false; readonly fallback: AttentionTypeADiagnosticCode; readonly participatesInP3: true }
  | { readonly resultType: 'EngineOnlyAttentionDiagnostic'; readonly code: AttentionTypeBDiagnosticCode; readonly playerVisible: false; readonly externallyAggregatable: false; readonly fallback: AttentionTypeADiagnosticCode | null; readonly participatesInP3: false }

const TYPE_A = new Set<string>(ATTENTION_TYPE_A_DIAGNOSTIC_CODES)
const PROVENANCE_FALLBACK = new Set<string>([
  'provenance_cycle', 'provenance_depth_exceeded', 'provenance_budget_exceeded',
  'provenance_incomplete', 'absence_match_exists', 'absence_relation_not_closed',
  'absence_window_incomplete', 'absence_completeness_certificate_missing',
  'absence_certificate_not_structural',
])

/** The canonical internal literal list C7 audits in both directions. */
export const ATTENTION_INTERNAL_REFUSAL_LITERALS = Object.freeze([
  ...ATTENTION_TYPE_A_DIAGNOSTIC_CODES,
  ...ATTENTION_TYPE_B_DIAGNOSTIC_CODES,
] as const)

export function classifyAttentionDiagnostic(code: AttentionDiagnosticCode): AttentionDiagnosticClassification {
  if (TYPE_A.has(code)) {
    return Object.freeze({
      resultType: 'PlayerObservableAttentionResult',
      code: code as AttentionTypeADiagnosticCode,
      playerVisible: true,
      externallyAggregatable: false,
      fallback: code as AttentionTypeADiagnosticCode,
      participatesInP3: true,
    })
  }
  const typed = code as AttentionTypeBDiagnosticCode
  return Object.freeze({
    resultType: 'EngineOnlyAttentionDiagnostic',
    code: typed,
    playerVisible: false,
    externallyAggregatable: false,
    fallback: PROVENANCE_FALLBACK.has(typed)
      ? 'provenance_missing'
      : typed === 'validator_rejection_detail' ? 'no_legal_channel' : null,
    participatesInP3: false,
  })
}

/** The only external boundary: type B cannot be emitted, and neither class
 * can be externally aggregated. */
export function emitAttentionDiagnosticToExternalSink(input: {
  readonly classification: AttentionDiagnosticClassification
  readonly aggregate: boolean
}): { readonly kind: 'ok'; readonly code: AttentionTypeADiagnosticCode } | { readonly kind: 'refused'; readonly reason: 'engine-only-diagnostic' | 'external-diagnostic-aggregation-forbidden' } {
  if (input.classification.resultType === 'EngineOnlyAttentionDiagnostic') {
    return { kind: 'refused', reason: 'engine-only-diagnostic' }
  }
  if (input.aggregate) return { kind: 'refused', reason: 'external-diagnostic-aggregation-forbidden' }
  return { kind: 'ok', code: input.classification.code }
}
