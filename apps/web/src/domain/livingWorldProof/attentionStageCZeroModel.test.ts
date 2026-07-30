import { describe, expect, it } from 'vitest'
import { readAttentionReadableClosedRelationCertificate } from './attentionClosedRelationCertificateAccessor'
import { buildAttentionAbsenceWitnessProvenance } from './attentionAbsenceWitnessProvenance'
import { mintPatternEvidenceViews } from './attentionNarrativePatternScenario'
import { ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION } from './attentionCommunicationAuthorityContracts'
import { readAttentionReadableCommunicationAuthorityViews } from './attentionCommunicationAuthorityAccessor'
import { evaluateAttentionRevealerLegality } from './attentionRevealerLegality'
import { evaluateAttentionRecipientScope } from './attentionRecipientScope'
import { createAttentionRevealScope } from './attentionRevealScope'
import { createAttentionZeroModelProbe, assertAttentionZeroModelProbeUnused } from './attentionZeroModelProbe'
import { createAttentionDiegeticRevealProposal, ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION } from './attentionDiegeticRevealProposal'
import { deliverAttentionDiegeticReveal } from './attentionDiegeticDelivery'
import { createAttentionReplayAuthoritativeResources } from './attentionReplayResources'
import { classifyAttentionRuntimeRefusal } from './attentionDiagnosticPartition'

describe('Stage C zero-model composition', () => {
  it('reaches C2-C7 absence, legality, recipient/scope, proposal, validation, delivery, and diagnostics with no provider or model call', () => {
    const probe = createAttentionZeroModelProbe()
    const certificate = readAttentionReadableClosedRelationCertificate({
      snapshotLsn: 9, fromLsn: 1, toLsn: 9, patternEvidenceViews: mintPatternEvidenceViews([]),
    })
    if (certificate.kind !== 'ok') throw new Error('expected C2 certificate')
    expect(buildAttentionAbsenceWitnessProvenance({ policyRef: 'absence-witness-c2-v1', certificate: certificate.certificate, entityA: 'a', entityB: 'b' }).kind).toBe('ok')

    const authority = readAttentionReadableCommunicationAuthorityViews(Object.freeze({
      authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION,
      records: Object.freeze([Object.freeze({
        authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION, visibility: 'public' as const,
        authorityKind: 'public_knowledge' as const, entityId: 'speaker', revealerClass: 'individual' as const,
        propositionKey: 'aid', groundingRecordId: 'public-aid', visibilityProvenanceId: 'public-aid-view', commitLsn: 1,
      })]),
    }) as never, { authorityContractVersion: ATTENTION_COMMUNICATION_AUTHORITY_ACCESSOR_VERSION })
    if (authority.kind !== 'ok') throw new Error('expected C3 authority')
    const legality = evaluateAttentionRevealerLegality({
      policyRef: 'communication-legality-c3-v1', candidateId: 'c', channelId: 'diegetic-direct-communication-v1', propositionKey: 'aid',
      sourcePropositionKeys: [], aggregateRuleLicensed: false, authorityViews: authority.views, availabilityEvidence: [],
      declaredChannelAvailability: [{ channelId: 'diegetic-direct-communication-v1', available: true, validatorIntakeAvailable: true }],
    })
    expect(legality.kind).toBe('legal')
    const recipientScope = Object.freeze({ kind: 'direct_recipient' as const, recipientId: 'player' })
    expect(evaluateAttentionRecipientScope({ channelId: 'diegetic-direct-communication-v1', scope: recipientScope, authorizedRecipientIds: ['player'], unavailableRecipientIds: [] })).toEqual({ kind: 'legal' })
    const revealScope = createAttentionRevealScope(['assertion-aid'], recipientScope)
    if (typeof revealScope === 'string') throw new Error(revealScope)
    const proposal = createAttentionDiegeticRevealProposal({
      schemaVersion: ATTENTION_DIEGETIC_REVEAL_PROPOSAL_SCHEMA_VERSION, candidateId: 'c', assertions: ['assertion-aid'], assertionProvenance: ['full-provenance-aid'],
      channelId: 'diegetic-direct-communication-v1', revealerId: 'speaker', recipientScope, revealScope,
      rankingSnapshotLsn: 9, revalidationSnapshotLsn: 9, policyIdentities: ['c3', 'c4'],
    })
    if (proposal.kind !== 'ok') throw new Error('expected C6 proposal')
    const delivery = deliverAttentionDiegeticReveal({
      resources: createAttentionReplayAuthoritativeResources(3), proposal: proposal.proposal, wallClockInput: 9,
      authoritativePayloads: [Object.freeze({ communicationKey: 'aid', assertionContent: Object.freeze(['assertion-aid']), assertionProvenance: Object.freeze(['full-provenance-aid']),
        channelId: 'diegetic-direct-communication-v1', revealerId: 'speaker', recipientScope, revealScope, policyIdentities: Object.freeze(['c3', 'c4']), available: true })],
    })
    expect(delivery.kind).toBe('committed')
    expect(classifyAttentionRuntimeRefusal('invalid-communication-command').fallback).toBe('no_legal_channel')
    assertAttentionZeroModelProbeUnused(probe)
  })
})
