import { describe, expect, it } from 'vitest'
import { readAttentionReadableClosedRelationCertificate } from './attentionClosedRelationCertificateAccessor'
import { buildAttentionAbsenceWitnessProvenance } from './attentionAbsenceWitnessProvenance'
import { aidRecord, mintPatternEvidenceViews } from './attentionNarrativePatternScenario'
import { revalidateAttentionAbsenceCertificate } from './attentionReplay'

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
})
