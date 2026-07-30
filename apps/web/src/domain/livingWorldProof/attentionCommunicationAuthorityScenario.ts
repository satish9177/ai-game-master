import { ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION } from './attentionCommunicationAuthorityContracts'
import type { ProofCommunicationAuthoritySnapshot } from './attentionCommunicationAuthorityContracts'

/** Fixture-only public/declassified authority material; no engine state is represented here. */
export function createAttentionCommunicationAuthorityScenario(): ProofCommunicationAuthoritySnapshot {
  return Object.freeze({
    authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION,
    records: Object.freeze([
      Object.freeze({ authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION, visibility: 'public' as const, authorityKind: 'public_knowledge' as const, entityId: 'revealer-a', revealerClass: 'individual' as const, propositionKey: 'conclusion-c', groundingRecordId: 'record-c', visibilityProvenanceId: 'public-record-c', commitLsn: 4 }),
    ]),
  })
}
