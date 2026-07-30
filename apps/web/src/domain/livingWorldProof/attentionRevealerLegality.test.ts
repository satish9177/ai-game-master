import { describe, expect, it } from 'vitest'
import { ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION } from './attentionCommunicationAuthorityContracts'
import { readAttentionReadableCommunicationAuthorityViews } from './attentionCommunicationAuthorityAccessor'
import { evaluateAttentionRevealerLegality } from './attentionRevealerLegality'

function views(records: readonly object[]) {
  const result = readAttentionReadableCommunicationAuthorityViews(Object.freeze({ authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION, records: Object.freeze(records) }) as never, { authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION })
  if (result.kind !== 'ok') throw new Error(result.reason)
  return result.views
}
function knowledge(entityId: string, propositionKey: string, commitLsn: number, groundingRecordId = `record-${propositionKey}`) {
  return Object.freeze({ authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION, visibility: 'public' as const, authorityKind: 'public_knowledge' as const, entityId, revealerClass: 'individual' as const, propositionKey, groundingRecordId, visibilityProvenanceId: `public-${propositionKey}`, commitLsn })
}
function request(authorityViews: ReturnType<typeof views>, overrides: object = {}) {
  return { policyRef: 'communication-legality-c3-v1' as const, candidateId: 'candidate-c', channelId: 'diegetic-direct-communication-v1' as const, propositionKey: 'c', sourcePropositionKeys: ['a', 'b'], aggregateRuleLicensed: false, authorityViews, availabilityEvidence: [], declaredChannelAvailability: [{ channelId: 'diegetic-direct-communication-v1' as const, available: true, validatorIntakeAvailable: true }], ...overrides }
}

describe('C3 revealer legality', () => {
  it('discharges R12/R13/R15/R16 without reading private state', () => {
    const r12 = evaluateAttentionRevealerLegality(request(views([knowledge('one', 'a', 1), knowledge('one', 'b', 2)])))
    expect(r12.kind).toBe('refused') // R12
    const r13 = evaluateAttentionRevealerLegality(request(views([knowledge('one', 'a', 1), knowledge('two', 'b', 2)]), { aggregateRuleLicensed: true }))
    expect(r13.kind).toBe('refused') // R13
    const r15 = evaluateAttentionRevealerLegality(request(views([knowledge('one', 'c', 1, 'communicated-c')]), { authoritativeCommunicationGroundingRecordId: 'communicated-c' }))
    expect(r15).toMatchObject({ kind: 'legal', route: 'authoritatively-communicated', revealerId: 'one' }) // R15
    const institutional = Object.freeze({ ...knowledge('institution', 'c', 1), revealerClass: 'institution' as const })
    const r16 = evaluateAttentionRevealerLegality(request(views([institutional])))
    expect(r16).toMatchObject({ kind: 'refused', reason: 'no_legal_revealer' }) // R16
  })

  it('uses the canonical revealer order independent of caller insertion', () => {
    const result = evaluateAttentionRevealerLegality(request(views([knowledge('z', 'c', 3), knowledge('a', 'c', 1)])))
    expect(result).toMatchObject({ kind: 'legal', revealerId: 'a' })
  })

  it('makes V5 and V6 typed refusals', () => {
    const v5 = evaluateAttentionRevealerLegality(request(views([knowledge('a', 'c', 1)]), { declaredChannelAvailability: [{ channelId: 'diegetic-direct-communication-v1', available: false, validatorIntakeAvailable: true }] }))
    expect(v5).toMatchObject({ kind: 'refused', reason: 'no_legal_channel' })
    const unavailable = Object.freeze({ evidenceViewContractVersion: 'attention-pattern-evidence-accessor-v1', recordId: 'dead-a', commitLsn: 2, worldTimeTick: 2, visibilityProvenanceId: 'public-dead-a', recordKind: 'world_observable_availability', availabilityCode: 'dead', entityId: 'a' })
    const v6 = evaluateAttentionRevealerLegality(request(views([knowledge('a', 'c', 1)]), { availabilityEvidence: [unavailable] }))
    expect(v6).toMatchObject({ kind: 'refused', reason: 'no_legal_revealer' })
  })
})
