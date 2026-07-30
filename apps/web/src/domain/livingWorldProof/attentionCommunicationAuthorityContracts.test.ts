import { describe, expect, it } from 'vitest'
import {
  ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION,
  isStructurallyValidProofCommunicationAuthorityRecord,
} from './attentionCommunicationAuthorityContracts'

const record = Object.freeze({ authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION, visibility: 'public' as const, authorityKind: 'public_knowledge' as const, entityId: 'speaker', revealerClass: 'individual' as const, propositionKey: 'c', groundingRecordId: 'record-c', visibilityProvenanceId: 'public-c', commitLsn: 3 })

describe('C3 communication authority contracts', () => {
  it('admits only the declared public/declassified source shape', () => {
    expect(isStructurallyValidProofCommunicationAuthorityRecord(record)).toBe(true)
    expect(isStructurallyValidProofCommunicationAuthorityRecord({ ...record, belief: 'hidden' })).toBe(false)
    expect(isStructurallyValidProofCommunicationAuthorityRecord({ ...record, commitLsn: 1.5 })).toBe(false)
  })

  it('does not permit a Belief-shaped value on the authority path at the type boundary', () => {
    // @ts-expect-error Belief is intentionally absent from ProofCommunicationAuthorityRecord.
    const impossible: typeof record = { ...record, belief: 'private' }
    expect(impossible).toBeDefined()
  })
})
