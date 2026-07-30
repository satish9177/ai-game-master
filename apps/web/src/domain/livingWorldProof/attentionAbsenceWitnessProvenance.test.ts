import { describe, expect, it } from 'vitest'
import { readAttentionReadableClosedRelationCertificate } from './attentionClosedRelationCertificateAccessor'
import { buildAttentionAbsenceWitnessProvenance } from './attentionAbsenceWitnessProvenance'
import { mintPatternEvidenceViews } from './attentionNarrativePatternScenario'
import { buildAttentionCertifiedAbsenceAssertion } from './attentionDirectEvidenceAssertion'

describe('C2 absence provenance', () => {
  it('is canonical and refuses absent or forged certificates', () => {
    const certificate = readAttentionReadableClosedRelationCertificate({ snapshotLsn: 10, fromLsn: 1, toLsn: 10, patternEvidenceViews: mintPatternEvidenceViews([]) })
    expect(certificate.kind).toBe('ok')
    if (certificate.kind !== 'ok') return
    const built = buildAttentionAbsenceWitnessProvenance({ policyRef: 'absence-witness-c2-v1', certificate: certificate.certificate, entityA: 'b', entityB: 'a' })
    expect(built.kind).toBe('ok')
    if (built.kind === 'ok') expect(built.provenance.boundEntities).toEqual(['a', 'b'])
    if (built.kind === 'ok') {
      const assertion = buildAttentionCertifiedAbsenceAssertion(built.provenance)
      expect(typeof assertion === 'string' ? assertion : assertion.token).toBe('nothing in the admitted public record shows aid between')
    }
    expect(buildAttentionAbsenceWitnessProvenance({ policyRef: 'absence-witness-c2-v1', certificate: undefined, entityA: 'a', entityB: 'b' }))
      .toEqual({ kind: 'refused', reason: 'absence_completeness_certificate_missing' })
    expect(buildAttentionAbsenceWitnessProvenance({
      policyRef: 'absence-witness-c2-v1', certificate: certificate.certificate, entityA: 'a', entityB: 'b', matchingRecordExists: true,
    })).toEqual({ kind: 'refused', reason: 'absence_match_exists' })
  })
})
