import { describe, expect, it } from 'vitest'
import { ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION } from './attentionCommunicationAuthorityContracts'
import { isAttentionReadableCommunicationAuthorityViewFromAccessor, readAttentionReadableCommunicationAuthorityViews } from './attentionCommunicationAuthorityAccessor'

function snapshot(records: readonly object[]) {
  return Object.freeze({ authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION, records: Object.freeze(records) }) as never
}
const publicKnowledge = Object.freeze({ authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION, visibility: 'public' as const, authorityKind: 'public_knowledge' as const, entityId: 'speaker', revealerClass: 'individual' as const, propositionKey: 'c', groundingRecordId: 'record-c', visibilityProvenanceId: 'public-c', commitLsn: 3 })

describe('C3 communication authority accessor', () => {
  it('is the exclusive mint and excludes private/unobserved/institutional inputs', () => {
    const result = readAttentionReadableCommunicationAuthorityViews(snapshot([publicKnowledge, Object.freeze({ ...publicKnowledge, entityId: 'private', visibility: 'private' as const }), Object.freeze({ ...publicKnowledge, entityId: 'institution', revealerClass: 'institution' as const })]), { authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.views.map((view) => view.entityId)).toEqual(['speaker'])
    expect(isAttentionReadableCommunicationAuthorityViewFromAccessor(result.views[0])).toBe(true)
    expect(isAttentionReadableCommunicationAuthorityViewFromAccessor({ ...result.views[0]! })).toBe(false)
  })

  it('refuses mutable source material', () => {
    expect(readAttentionReadableCommunicationAuthorityViews({ authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION, records: [publicKnowledge] } as never, { authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION })).toEqual({ kind: 'refused', reason: 'mutable-communication-authority-input' })
  })
})
