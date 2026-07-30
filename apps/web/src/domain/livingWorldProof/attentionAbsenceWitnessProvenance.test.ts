import { describe, expect, it } from 'vitest'
import { readAttentionReadableClosedRelationCertificate } from './attentionClosedRelationCertificateAccessor'
import { buildAttentionAbsenceWitnessProvenance } from './attentionAbsenceWitnessProvenance'
import { aidRecord, mintPatternEvidenceViews } from './attentionNarrativePatternScenario'
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
    const match = readAttentionReadableClosedRelationCertificate({
      snapshotLsn: 10, fromLsn: 1, toLsn: 10,
      patternEvidenceViews: mintPatternEvidenceViews([aidRecord('aid-a-b', 4, 'a', 'b')]),
    })
    if (match.kind !== 'ok') throw new Error('expected matching certificate')
    expect(buildAttentionAbsenceWitnessProvenance({
      policyRef: 'absence-witness-c2-v1', certificate: match.certificate, entityA: 'a', entityB: 'b',
    })).toEqual({ kind: 'refused', reason: 'absence_match_exists' })
  })

  it('refuses an incomplete lookback, malformed certificate, and text-shaped non-certificate without treating a failed text search as absence', () => {
    const records = mintPatternEvidenceViews(Array.from({ length: 33 }, (_, index) => aidRecord(`aid-${String(index).padStart(2, '0')}`, index + 1, 'x', 'y')))
    expect(readAttentionReadableClosedRelationCertificate({ snapshotLsn: 33, fromLsn: 1, toLsn: 33, patternEvidenceViews: records }))
      .toEqual({ kind: 'refused', reason: 'absence_window_incomplete' })
    const certificate = readAttentionReadableClosedRelationCertificate({ snapshotLsn: 33, fromLsn: 2, toLsn: 33, patternEvidenceViews: records })
    if (certificate.kind !== 'ok') throw new Error('expected lookback-contained certificate')
    expect(buildAttentionAbsenceWitnessProvenance({ policyRef: 'absence-witness-c2-v1', certificate: { ...certificate.certificate } as never, entityA: 'a', entityB: 'b' }))
      .toEqual({ kind: 'refused', reason: 'absence_certificate_not_structural' })
    expect(buildAttentionAbsenceWitnessProvenance({ policyRef: 'absence-witness-c2-v1', certificate: { search: 'no matching text' } as never, entityA: 'a', entityB: 'b' }))
      .toEqual({ kind: 'refused', reason: 'absence_certificate_not_structural' })
  })
})
