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

/**
 * The closed intermediate vocabulary for runtime refusals.  A runtime literal
 * never classifies itself: it first selects one of these stable ownership
 * groups, then the D11 diagnostic classification determines the generic
 * external outcome.  This keeps an implementation subtype out of the public
 * result surface while retaining a lossless, auditable reverse mapping.
 */
export const ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS = Object.freeze({
  candidate_lifecycle: 'candidate_disappeared',
  snapshot_freshness: 'stale_snapshot',
  ranking_integrity: 'policy_hash_mismatch',
  authoritative_delivery: 'validator_rejection_detail',
  channel_legality: 'no_legal_channel',
  revealer_legality: 'no_legal_revealer',
  reveal_scope_integrity: 'reveal_scope_expansion_attempt',
  aggregate_legality: 'aggregate_assertion_not_legal',
  absence_counterexample: 'absence_match_exists',
  absence_relation: 'absence_relation_not_closed',
  absence_window: 'absence_window_incomplete',
  absence_certificate_presence: 'absence_completeness_certificate_missing',
  absence_certificate_integrity: 'absence_certificate_not_structural',
  provenance_cycle_guard: 'provenance_cycle',
  provenance_depth_guard: 'provenance_depth_exceeded',
  provenance_budget_guard: 'provenance_budget_exceeded',
  provenance_completeness: 'provenance_incomplete',
  presentation_resource_limit: 'resource_limit_exceeded',
  presentation_phrasing: 'phrasing_failed',
} as const satisfies Readonly<Record<string, AttentionDiagnosticCode>>)

export type AttentionRuntimeDiagnosticGroup = keyof typeof ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS

/**
 * C7's runtime-to-group ownership table. Keeping it explicit means a new
 * runtime refusal must consciously enter the closed C7 vocabulary.
 */
export const ATTENTION_RUNTIME_REFUSAL_OWNER = Object.freeze({
  'candidate-disappeared': 'candidate_lifecycle',
  'stale-snapshot': 'snapshot_freshness',
  'cache-key-mismatch': 'ranking_integrity',
  'candidate-identity-mismatch': 'ranking_integrity',
  'ranking-snapshot-lsn-mismatch': 'ranking_integrity',
  'accessor-contract-version-mismatch': 'ranking_integrity',
  'surface-schema-version-mismatch': 'ranking_integrity',
  'missing-accessor-contract-version': 'ranking_integrity',
  'missing-canonicalization-version': 'ranking_integrity',
  'missing-identity-schema-version': 'ranking_integrity',
  'missing-ordering-version': 'ranking_integrity',
  'missing-derivation-cache-key-schema-version': 'ranking_integrity',
  'missing-ranking-cache-key-schema-version': 'ranking_integrity',
  'missing-template-version': 'ranking_integrity',
  'missing-template-channel-policy-version': 'ranking_integrity',
  'missing-exposure-policy-version': 'ranking_integrity',
  'missing-ledger-policy-version': 'ranking_integrity',
  'missing-resource-policy-version': 'ranking_integrity',
  'missing-authoritative-log-fold-version': 'ranking_integrity',
  'authoritative-log-version-mismatch': 'authoritative_delivery',
  'invalid-communication-command': 'authoritative_delivery',
  'unknown-authoritative-communication': 'authoritative_delivery',
  'communication-unavailable': 'authoritative_delivery',
  'unsupported-validator-contract': 'authoritative_delivery',
  'malformed-communication-payload-digest': 'authoritative_delivery',
  'invalid-proposal-member': 'authoritative_delivery',
  'mismatched-assertion-provenance': 'authoritative_delivery',
  'invalid-snapshot-coordinate': 'authoritative_delivery',
  'unsupported-proposal-schema': 'authoritative_delivery',
  'no_legal_channel': 'channel_legality',
  'no_legal_revealer': 'revealer_legality',
  'reveal_scope_expansion_attempt': 'reveal_scope_integrity',
  'aggregate_assertion_not_legal': 'aggregate_legality',
  'invalid-aggregate-assertion': 'aggregate_legality',
  'absence_match_exists': 'absence_counterexample',
  'absence_relation_not_closed': 'absence_relation',
  'absence_window_incomplete': 'absence_window',
  'absence_completeness_certificate_missing': 'absence_certificate_presence',
  'absence_certificate_not_structural': 'absence_certificate_integrity',
  'provenance-cycle': 'provenance_cycle_guard',
  'provenance-depth-exceeded': 'provenance_depth_guard',
  'provenance-budget-exceeded': 'provenance_budget_guard',
  'provenance-incomplete': 'provenance_completeness',
  'resource-limit-exceeded': 'presentation_resource_limit',
  'phrasing-failed': 'presentation_phrasing',
} as const satisfies Readonly<Record<string, AttentionRuntimeDiagnosticGroup>>)

export type AttentionRuntimeRefusalLiteral = keyof typeof ATTENTION_RUNTIME_REFUSAL_OWNER

/** Reverse ownership is generated, never hand-maintained as a second source. */
export const ATTENTION_RUNTIME_REFUSALS_BY_GROUP = Object.freeze(
  (Object.keys(ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS) as AttentionRuntimeDiagnosticGroup[]).reduce((groups, group) => Object.freeze({
    ...groups,
    [group]: Object.freeze((Object.keys(ATTENTION_RUNTIME_REFUSAL_OWNER) as AttentionRuntimeRefusalLiteral[])
      .filter((runtime) => ATTENTION_RUNTIME_REFUSAL_OWNER[runtime] === group)),
  }), {} as Readonly<Record<AttentionRuntimeDiagnosticGroup, readonly AttentionRuntimeRefusalLiteral[]>>),
)

export const ATTENTION_RUNTIME_REFUSALS_BY_DIAGNOSTIC = Object.freeze(
  ATTENTION_INTERNAL_REFUSAL_LITERALS.reduce((diagnostics, diagnostic) => Object.freeze({
    ...diagnostics,
    [diagnostic]: Object.freeze((Object.keys(ATTENTION_RUNTIME_REFUSAL_OWNER) as AttentionRuntimeRefusalLiteral[])
      .filter((runtime) => ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS[ATTENTION_RUNTIME_REFUSAL_OWNER[runtime]] === diagnostic)),
  }), {} as Readonly<Record<AttentionDiagnosticCode, readonly AttentionRuntimeRefusalLiteral[]>>),
)

export function classifyAttentionRuntimeRefusal(runtime: AttentionRuntimeRefusalLiteral): AttentionDiagnosticClassification {
  return classifyAttentionDiagnostic(ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS[ATTENTION_RUNTIME_REFUSAL_OWNER[runtime]])
}

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
