import { canonicalSerialize, mintHash } from './canonicalSerialization'
import { ATTENTION_CLOSED_RELATION_ID } from './attentionClosedRelationCertificateContracts'

export const NO_RECORDED_PUBLIC_AID_BETWEEN_V1 = Object.freeze({
  predicateId: 'no_recorded_public_aid_between_v1', semanticVersion: '1.0.0',
  closedRelationId: ATTENTION_CLOSED_RELATION_ID, token: 'nothing in the admitted public record shows aid between',
})
export const ATTENTION_ABSENCE_PREDICATE_LIBRARY_VERSION = 'attention-absence-predicate-library-c2-v1' as const
export const ATTENTION_ABSENCE_PREDICATE_LIBRARY_HASH = mintHash(canonicalSerialize({
  version: ATTENTION_ABSENCE_PREDICATE_LIBRARY_VERSION, predicates: [NO_RECORDED_PUBLIC_AID_BETWEEN_V1],
}))

export function findAttentionAbsencePredicate(predicateId: string, semanticVersion: string, contentHash: string) {
  const predicate = predicateId === NO_RECORDED_PUBLIC_AID_BETWEEN_V1.predicateId
    && semanticVersion === NO_RECORDED_PUBLIC_AID_BETWEEN_V1.semanticVersion
    ? NO_RECORDED_PUBLIC_AID_BETWEEN_V1 : undefined
  return predicate !== undefined && contentHash === mintHash(canonicalSerialize(predicate)) ? predicate : undefined
}
