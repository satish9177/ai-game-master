import { describe, expect, it } from 'vitest'
import { readAttentionReadableClosedRelationCertificate } from './attentionClosedRelationCertificateAccessor'
import { buildAttentionAbsenceWitnessProvenance } from './attentionAbsenceWitnessProvenance'
import { aidRecord, mintPatternEvidenceViews } from './attentionNarrativePatternScenario'
import { revalidateAttentionAbsenceCertificate } from './attentionReplay'
import { runAttentionMixedFamilyEvaluation } from './attentionReplay'
import { buildB6PatternOnlyEvaluationInput } from './attentionReplayScenario'
import { createAttentionLedger } from './attentionLedger'
import { buildAttentionCertifiedAbsenceAssertion } from './attentionDirectEvidenceAssertion'

describe('C2 absence replay controls', () => {
  it('keeps an admitted private record out of the certificate and canonical witness bytes', () => {
    const publicViews = mintPatternEvidenceViews([])
    const left = readAttentionReadableClosedRelationCertificate({ snapshotLsn: 8, fromLsn: 1, toLsn: 8, patternEvidenceViews: publicViews })
    const right = readAttentionReadableClosedRelationCertificate({ snapshotLsn: 8, fromLsn: 1, toLsn: 8, patternEvidenceViews: mintPatternEvidenceViews([
      { ...aidRecord('private-aid', 4, 'a', 'b'), visibilityProvenance: { visibility: 'private' as const } },
    ]) })
    expect(left).toEqual(right)
    if (left.kind !== 'ok' || right.kind !== 'ok') return
    expect(buildAttentionAbsenceWitnessProvenance({ policyRef: 'absence-witness-c2-v1', certificate: left.certificate, entityA: 'a', entityB: 'b' }))
      .toEqual(buildAttentionAbsenceWitnessProvenance({ policyRef: 'absence-witness-c2-v1', certificate: right.certificate, entityA: 'b', entityB: 'a' }))
  })

  it('reconstructs a certificate at revalidation instead of reusing ranking material', () => {
    const ranking = readAttentionReadableClosedRelationCertificate({ snapshotLsn: 8, fromLsn: 1, toLsn: 8, patternEvidenceViews: mintPatternEvidenceViews([]) })
    if (ranking.kind !== 'ok') throw new Error('expected certificate')
    expect(revalidateAttentionAbsenceCertificate({
      rankingCertificate: ranking.certificate, revalidationSnapshotLsn: 8, revalidationPatternEvidenceViews: mintPatternEvidenceViews([]),
    })).toBe('still-legal')
    expect(revalidateAttentionAbsenceCertificate({
      rankingCertificate: ranking.certificate, revalidationSnapshotLsn: 8,
      revalidationPatternEvidenceViews: mintPatternEvidenceViews([aidRecord('new-aid', 4, 'a', 'b')]),
    })).toBe('certificate-revalidation-failed')
  })

  it('carries a certified absence through the real package, renderer, ledger, and trusted trace while refusing to aggregate it', () => {
    const certificate = readAttentionReadableClosedRelationCertificate({ snapshotLsn: 10, fromLsn: 1, toLsn: 10, patternEvidenceViews: mintPatternEvidenceViews([]) })
    if (certificate.kind !== 'ok') throw new Error('expected certificate')
    const witness = buildAttentionAbsenceWitnessProvenance({ policyRef: 'absence-witness-c2-v1', certificate: certificate.certificate, entityA: 'a', entityB: 'b' })
    if (witness.kind !== 'ok') throw new Error('expected absence witness')
    const absence = buildAttentionCertifiedAbsenceAssertion(witness.provenance)
    if (typeof absence === 'string') throw new Error(absence)
    const ledger = createAttentionLedger({ ledgerPolicyVersion: 'attention-ledger-policy-v1' })
    if (ledger.kind !== 'ok') throw new Error('expected ledger')
    const base = buildB6PatternOnlyEvaluationInput('c2-real-pipeline', ledger.ledger)
    const result = runAttentionMixedFamilyEvaluation({
      ...base,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
      patternPresentationInputs: Object.freeze(base.patternPresentationInputs.map((entry) => Object.freeze({ ...entry, absenceAssertions: Object.freeze([absence]) }))),
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected absence presentation')
    expect(result.result.presentation?.output).toContain('nothing in the admitted public record shows aid between')
    expect(result.result.ledger.records).toHaveLength(1)
    expect(result.result.trace.absenceWitnessMaterial).toEqual([expect.objectContaining({ certificateId: certificate.certificate.certificateId, outcome: 'certified' })])
    expect(result.result.trace.playerObservable).not.toHaveProperty('absenceWitnessMaterial')
    const aggregateRefusal = runAttentionMixedFamilyEvaluation({
      ...base,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-c1-v1',
      patternPresentationInputs: Object.freeze(base.patternPresentationInputs.map((entry) => Object.freeze({ ...entry, aggregateSources: Object.freeze([absence, absence]) as never }))),
    })
    expect(aggregateRefusal.kind).toBe('ok')
    if (aggregateRefusal.kind !== 'ok') throw new Error('expected arbitration refusal')
    expect(aggregateRefusal.result.arbitrationAttempts[0]).toMatchObject({ outcome: 'assertion-build-refused', refusalReason: 'aggregate_assertion_not_legal' })
  })
})
