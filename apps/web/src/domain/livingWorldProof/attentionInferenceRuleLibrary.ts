import { canonicalSerialize, mintHash } from './canonicalSerialization'

export type AttentionInferenceRuleId =
  | 'reciprocal_public_exchange_v1'
  | 'public_aid_link_extension_v1'

export type AttentionInferenceSourceOrder =
  | 'direct-source-record-then-assertion'
  | 'aggregate-first-direct-second'

export interface AttentionInferenceRuleDefinition {
  readonly ruleId: AttentionInferenceRuleId
  readonly semanticVersion: '1.0.0'
  readonly contentHash: string
  readonly sourceOrder: AttentionInferenceSourceOrder
  readonly sourceCardinality: 2
}

function defineRule(
  ruleId: AttentionInferenceRuleId,
  sourceOrder: AttentionInferenceSourceOrder,
): AttentionInferenceRuleDefinition {
  const definition = { ruleId, semanticVersion: '1.0.0' as const, sourceOrder, sourceCardinality: 2 as const }
  return Object.freeze({ ...definition, contentHash: mintHash(canonicalSerialize(definition)) })
}

export const RECIPROCAL_PUBLIC_EXCHANGE_V1 = defineRule(
  'reciprocal_public_exchange_v1', 'direct-source-record-then-assertion',
)

export const PUBLIC_AID_LINK_EXTENSION_V1 = defineRule(
  'public_aid_link_extension_v1', 'aggregate-first-direct-second',
)

export const ATTENTION_INFERENCE_RULE_LIBRARY = Object.freeze([
  RECIPROCAL_PUBLIC_EXCHANGE_V1,
  PUBLIC_AID_LINK_EXTENSION_V1,
] as const)

export const ATTENTION_AGGREGATION_RULE_LIBRARY_VERSION_HASH = mintHash(canonicalSerialize({
  rules: ATTENTION_INFERENCE_RULE_LIBRARY,
  version: 'attention-aggregation-rule-library-v1',
}))

export function findAttentionInferenceRule(
  ruleId: unknown,
  semanticVersion: unknown,
  contentHash: unknown,
): AttentionInferenceRuleDefinition | undefined {
  return ATTENTION_INFERENCE_RULE_LIBRARY.find((rule) => (
    rule.ruleId === ruleId && rule.semanticVersion === semanticVersion && rule.contentHash === contentHash
  ))
}
