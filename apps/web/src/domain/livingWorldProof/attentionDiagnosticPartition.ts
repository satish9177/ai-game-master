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
 * C7's internal ownership vocabulary.  These are intentionally broader than
 * any source refusal subtype: they explain which Stage C boundary rejected an
 * attempt without making a parser, certificate, template, or validator detail
 * observable.
 */
export const ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS = Object.freeze({
  candidate_lifecycle: 'candidate_disappeared',
  snapshot_freshness: 'stale_snapshot',
  ranking_integrity: 'policy_hash_mismatch',
  input_contract_integrity: 'policy_hash_mismatch',
  trace_integrity: 'policy_hash_mismatch',
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
 * A Stage C refusal reaches one of these deliberately generic observable
 * outcomes.  It is distinct from the trusted internal diagnostic above: a
 * runtime subtype must never become its own public label by punctuation-only
 * renaming.
 */
export const ATTENTION_GENERIC_OBSERVABLE_OUTCOMES = Object.freeze([
  'attention_unavailable',
  'attention_revalidation_required',
  'attention_evidence_unavailable',
  'attention_delivery_unavailable',
  'attention_presentation_unavailable',
] as const)
export type AttentionGenericObservableOutcome = typeof ATTENTION_GENERIC_OBSERVABLE_OUTCOMES[number]

export const ATTENTION_RUNTIME_DIAGNOSTIC_OUTCOME = Object.freeze({
  candidate_lifecycle: 'attention_unavailable',
  snapshot_freshness: 'attention_revalidation_required',
  ranking_integrity: 'attention_revalidation_required',
  input_contract_integrity: 'attention_revalidation_required',
  trace_integrity: 'attention_revalidation_required',
  authoritative_delivery: 'attention_delivery_unavailable',
  channel_legality: 'attention_delivery_unavailable',
  revealer_legality: 'attention_delivery_unavailable',
  reveal_scope_integrity: 'attention_delivery_unavailable',
  aggregate_legality: 'attention_evidence_unavailable',
  absence_counterexample: 'attention_evidence_unavailable',
  absence_relation: 'attention_evidence_unavailable',
  absence_window: 'attention_evidence_unavailable',
  absence_certificate_presence: 'attention_evidence_unavailable',
  absence_certificate_integrity: 'attention_evidence_unavailable',
  provenance_cycle_guard: 'attention_evidence_unavailable',
  provenance_depth_guard: 'attention_evidence_unavailable',
  provenance_budget_guard: 'attention_evidence_unavailable',
  provenance_completeness: 'attention_evidence_unavailable',
  presentation_resource_limit: 'attention_presentation_unavailable',
  presentation_phrasing: 'attention_presentation_unavailable',
} as const satisfies Readonly<Record<AttentionRuntimeDiagnosticGroup, AttentionGenericObservableOutcome>>)

/**
 * The source-level Stage C scan below must equal this table.  Grouping is the
 * only classification step: adding a runtime literal requires adding it here,
 * choosing an existing generic owner, and thereby selecting one generic
 * observable outcome.
 */
const RUNTIME_REFUSALS_BY_OWNER = Object.freeze({
  candidate_lifecycle: Object.freeze([
    'ambiguous-legal-identity',
    'candidate-disappeared',
    'candidate-identity-collision',
    'candidate-identity-mismatch',
    'duplicate-quest-opening-coordinate',
    'duplicate-source-id',
    'invalid-narrative-pattern-instance-id',
    'invalid-pattern-instance-id',
    'missing-candidate-id',
    'missing-opening-provenance-id',
    'missing-quest-opening-coordinate',
    'missing-retained-pattern-instance',
    'missing-source-id',
    'narrative-pattern-identity-collision',
    'quest-opening-coordinate-identity-mismatch',
    'quest-opening-provenance-mismatch',
    'quest-view-order-mismatch',
    'retired-pattern-instance',
    'source-identity-mismatch',
    'supporting-record-identity-mismatch',
    'unsafe-quest-opened-at-lsn',
  ]),
  snapshot_freshness: Object.freeze([
    'stale-snapshot',
  ]),
  ranking_integrity: Object.freeze([
    'accessor-contract-version-mismatch',
    'cache-key-mismatch',
    'duplicate-score-feature-input',
    'invalid-score-feature-input',
    'missing-accessor-contract-version',
    'missing-canonicalization-version',
    'missing-derivation-cache-key-schema-version',
    'missing-exposure-policy-version',
    'missing-identity-schema-version',
    'missing-ledger-policy-version',
    'missing-ordering-version',
    'missing-pattern-presentation-ledger-policy-version',
    'missing-ranking-cache-key-schema-version',
    'missing-ranking-snapshot-lsn',
    'missing-resource-policy-version',
    'missing-score-feature-input',
    'missing-template-channel-policy-version',
    'missing-template-version',
    'ordering-tie-not-total',
    'pattern-presentation-ledger-policy-mismatch',
    'ranking-snapshot-lsn-mismatch',
    'ranking-snapshot-lsn-out-of-range',
    'surface-schema-version-mismatch',
    'unsupported-canonicalization-version',
    'unsupported-exposure-policy-version',
    'unsupported-identity-schema-version',
    'unsupported-ledger-policy-version',
    'unsupported-pattern-presentation-ledger-policy-version',
    'unsupported-resource-policy-version',
    'unsupported-score-policy',
    'unsupported-template-channel-policy-version',
    'unsupported-template-version',
  ]),
  input_contract_integrity: Object.freeze([
    'closed-relation-certificate-order-mismatch',
    'communication-authority-contract-version-mismatch',
    'communication-authority-order-mismatch',
    'duplicate-definition',
    'evidence-after-expiry-deadline',
    'evidence-view-contract-version-mismatch',
    'input-not-accessor-minted',
    'input-not-attention-readable',
    'invalid-binding-map',
    'invalid-communication-authority-input',
    'invalid-content-hash',
    'invalid-coordinate',
    'invalid-direct-assertion-input',
    'invalid-evaluation-snapshot',
    'invalid-evidence-sequence',
    'invalid-instance-contract',
    'invalid-instance-shape',
    'invalid-lifecycle-coordinate',
    'invalid-lifecycle-transition',
    'invalid-pattern-evidence-input',
    'invalid-progress',
    'invalid-supporting-evidence',
    'invalid-supporting-record-identity',
    'invalid-verdict-annotation',
    'missing-communication-authority-contract-version',
    'missing-direct-evidence-slot',
    'missing-evidence-view-contract-version',
    'mutable-communication-authority-input',
    'mutable-pattern-evidence-input',
    'pattern-evidence-contract-version-mismatch',
    'pattern-evidence-order-mismatch',
    'quest-opening-coordinate-contract-version-mismatch',
    'quest-opening-coordinate-not-accessor-minted',
    'quest-opening-coordinate-order-mismatch',
    'unsupported-assertion-input',
    'unsupported-quest-opening-coordinate-version',
    'unsupported-semantic-version',
    'unsupported-version',
  ]),
  trace_integrity: Object.freeze([
    'invalid-mixed-family-arbitration',
    'invalid-pattern-presentation-decision',
    'invalid-presentation-entry',
    'missing-authoritative-log-digest-after',
    'missing-authoritative-log-digest-before',
    'missing-authoritative-log-fold-version',
    'missing-replay-case-id',
    'missing-revalidation-snapshot-lsn',
    'missing-structural-retention',
    'mixed-trace-candidate-entry',
  ]),
  authoritative_delivery: Object.freeze([
    'authoritative-log-version-mismatch',
    'commit-schema-fold-mismatch',
    'communication-unavailable',
    'invalid-communication-command',
    'invalid-proposal-member',
    'invalid-snapshot-coordinate',
    'malformed-communication-payload-digest',
    'mismatched-assertion-provenance',
    'payload-bearing-v1-record',
    'unknown-authoritative-communication',
    'unsupported-proposal-schema',
    'unsupported-validator-contract',
  ]),
  channel_legality: Object.freeze([
    'no_legal_channel',
  ]),
  revealer_legality: Object.freeze([
    'no_legal_revealer',
  ]),
  reveal_scope_integrity: Object.freeze([
    'reveal_scope_expansion_attempt',
  ]),
  aggregate_legality: Object.freeze([
    'aggregate_assertion_not_legal',
    'invalid-aggregate-assertion',
  ]),
  absence_counterexample: Object.freeze([
    'absence_match_exists',
  ]),
  absence_relation: Object.freeze([
    'absence_relation_not_closed',
  ]),
  absence_window: Object.freeze([
    'absence_window_incomplete',
  ]),
  absence_certificate_presence: Object.freeze([
    'absence_completeness_certificate_missing',
  ]),
  absence_certificate_integrity: Object.freeze([
    'absence_certificate_not_structural',
  ]),
  provenance_cycle_guard: Object.freeze([
    'provenance_cycle',
  ]),
  provenance_depth_guard: Object.freeze([
    'provenance_depth_exceeded',
  ]),
  provenance_budget_guard: Object.freeze([
    'provenance_budget_exceeded',
  ]),
  provenance_completeness: Object.freeze([
    'provenance_incomplete',
    'provenance_missing',
  ]),
  presentation_resource_limit: Object.freeze([
    'too-many-direct-evidence-assertions',
    'too-many-evidence-items',
    'too-many-steps',
    'zero-steps',
  ]),
  presentation_phrasing: Object.freeze([
    'direct-evidence-source-mismatch',
    'duplicate-direct-evidence-assertion',
    'duplicate-direct-evidence-source',
    'duplicate-pattern-assertion',
    'duplicate-record-identity',
    'duplicate-template-slot',
    'empty-assertion-input',
    'empty-direct-evidence-assertions',
    'empty-legally-visible-slot-value',
    'invalid-direct-evidence-field-character',
    'malformed-pattern-assertion',
    'missing-direct-evidence-assertions',
    'missing-pattern-assertion',
    'missing-pattern-presentation-input',
    'missing-pattern-presentation-lsn',
    'missing-rendered-output-identity',
    'missing-required-direct-evidence-assertion',
    'missing-required-template-slot',
    'missing-template-slot-value',
    'mixed-ledger-record-branch',
    'pattern-assertion-out-of-order',
    'pattern-presentation-lsn-out-of-range',
    'template-slot-out-of-order',
    'template-version-mismatch',
    'undeclared-role',
    'unexpected-direct-evidence-assertion',
    'unexpected-rendered-output-identity',
    'unknown-pattern-type',
    'unknown-score-feature-input',
    'unknown-template-slot',
    'unrenderable-result-tag',
    'unsupported-direct-evidence-assertions-for-quest',
    'unsupported-ledger-record-source-kind',
    'unsupported-outcome',
    'unsupported-pattern-package-schema',
    'unsupported-source-family',
  ]),
} as const satisfies Readonly<Record<AttentionRuntimeDiagnosticGroup, readonly string[]>>)

export type AttentionRuntimeRefusalLiteral = {
  [Group in AttentionRuntimeDiagnosticGroup]: (typeof RUNTIME_REFUSALS_BY_OWNER)[Group][number]
}[AttentionRuntimeDiagnosticGroup]

function buildRuntimeRefusalOwners(): Readonly<Record<AttentionRuntimeRefusalLiteral, AttentionRuntimeDiagnosticGroup>> {
  const owners: Record<string, AttentionRuntimeDiagnosticGroup> = {}
  for (const group of Object.keys(RUNTIME_REFUSALS_BY_OWNER) as AttentionRuntimeDiagnosticGroup[]) {
    for (const literal of RUNTIME_REFUSALS_BY_OWNER[group]) owners[literal] = group
  }
  return Object.freeze(owners) as unknown as Readonly<Record<AttentionRuntimeRefusalLiteral, AttentionRuntimeDiagnosticGroup>>
}

export const ATTENTION_RUNTIME_REFUSAL_OWNER = buildRuntimeRefusalOwners()

/** Reverse ownership and outcome evidence are generated, never maintained as
 * second sources. */
export const ATTENTION_RUNTIME_REFUSALS_BY_GROUP = Object.freeze(
  (Object.keys(ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS) as AttentionRuntimeDiagnosticGroup[]).reduce((groups, group) => Object.freeze({
    ...groups,
    [group]: RUNTIME_REFUSALS_BY_OWNER[group],
  }), {} as Readonly<Record<AttentionRuntimeDiagnosticGroup, readonly AttentionRuntimeRefusalLiteral[]>>),
)

export const ATTENTION_RUNTIME_REFUSALS_BY_OBSERVABLE_OUTCOME = Object.freeze(
  ATTENTION_GENERIC_OBSERVABLE_OUTCOMES.reduce((outcomes, outcome) => Object.freeze({
    ...outcomes,
    [outcome]: Object.freeze((Object.keys(ATTENTION_RUNTIME_REFUSAL_OWNER) as AttentionRuntimeRefusalLiteral[])
      .filter((runtime) => ATTENTION_RUNTIME_DIAGNOSTIC_OUTCOME[ATTENTION_RUNTIME_REFUSAL_OWNER[runtime]!] === outcome)),
  }), {} as Readonly<Record<AttentionGenericObservableOutcome, readonly AttentionRuntimeRefusalLiteral[]>>),
)

export const ATTENTION_RUNTIME_REFUSALS_BY_DIAGNOSTIC = Object.freeze(
  ATTENTION_INTERNAL_REFUSAL_LITERALS.reduce((diagnostics, diagnostic) => Object.freeze({
    ...diagnostics,
    [diagnostic]: Object.freeze((Object.keys(ATTENTION_RUNTIME_REFUSAL_OWNER) as AttentionRuntimeRefusalLiteral[])
      .filter((runtime) => ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS[ATTENTION_RUNTIME_REFUSAL_OWNER[runtime]!] === diagnostic)),
  }), {} as Readonly<Record<AttentionDiagnosticCode, readonly AttentionRuntimeRefusalLiteral[]>>),
)

export type AttentionRuntimeRefusalClassification = AttentionDiagnosticClassification & Readonly<{
  owner: AttentionRuntimeDiagnosticGroup
  observableOutcome: AttentionGenericObservableOutcome
}>

export function classifyAttentionRuntimeRefusal(runtime: AttentionRuntimeRefusalLiteral): AttentionRuntimeRefusalClassification {
  const owner = ATTENTION_RUNTIME_REFUSAL_OWNER[runtime]!
  return Object.freeze({
    ...classifyAttentionDiagnostic(ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS[owner]!),
    owner,
    observableOutcome: ATTENTION_RUNTIME_DIAGNOSTIC_OUTCOME[owner]!,
  })
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
