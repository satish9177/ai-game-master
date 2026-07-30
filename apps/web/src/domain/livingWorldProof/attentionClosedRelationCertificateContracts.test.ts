import { describe, expect, it } from 'vitest'
import { mintPatternEvidenceViews } from './attentionNarrativePatternScenario'
import { aidRecord } from './attentionNarrativePatternScenario'
import { readAttentionReadableClosedRelationCertificate } from './attentionClosedRelationCertificateAccessor'
import { isStructurallyValidAttentionReadableClosedRelationCertificateView } from './attentionClosedRelationCertificateContracts'

describe('C2 closed relation certificate contract', () => {
  it('accepts only an accessor-minted, bounded, canonical certificate', () => {
    const views = mintPatternEvidenceViews([aidRecord('c2-aid', 4, 'a', 'b')])
    const result = readAttentionReadableClosedRelationCertificate({ snapshotLsn: 4, fromLsn: 1, toLsn: 4, patternEvidenceViews: views })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(isStructurallyValidAttentionReadableClosedRelationCertificateView(result.certificate)).toBe(true)
    expect(isStructurallyValidAttentionReadableClosedRelationCertificateView({ ...result.certificate })).toBe(false)
  })
})
