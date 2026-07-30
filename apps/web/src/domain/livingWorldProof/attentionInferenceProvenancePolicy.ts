import { canonicalSerialize, mintHash } from './canonicalSerialization'

export interface AttentionInferenceProvenancePolicy {
  readonly version: string
  readonly contentHash: string
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxEdges: number
  readonly maxSourcesPerRule: number
}

function definePolicy(
  version: string,
  maxDepth: number,
  maxNodes: number,
  maxEdges: number,
): AttentionInferenceProvenancePolicy {
  const definition = { maxDepth, maxEdges, maxNodes, maxSourcesPerRule: 2, version }
  return Object.freeze({ ...definition, contentHash: mintHash(canonicalSerialize(definition)) })
}

export const ATTENTION_INFERENCE_PROVENANCE_POLICY = definePolicy(
  'attention-inference-provenance-policy-v1', 2, 5, 4,
)

export const ATTENTION_INFERENCE_PROVENANCE_NODE_OVERFLOW_POLICY = definePolicy(
  'attention-inference-provenance-node-overflow-fixture-v1', 2, 4, 4,
)

export const ATTENTION_INFERENCE_PROVENANCE_EDGE_OVERFLOW_POLICY = definePolicy(
  'attention-inference-provenance-edge-overflow-fixture-v1', 2, 5, 3,
)
