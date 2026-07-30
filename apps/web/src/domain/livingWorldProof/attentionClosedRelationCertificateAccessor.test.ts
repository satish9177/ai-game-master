import { describe, expect, it } from 'vitest'
import { aidRecord, mintPatternEvidenceViews } from './attentionNarrativePatternScenario'
import { readAttentionReadableClosedRelationCertificate } from './attentionClosedRelationCertificateAccessor'

describe('C2 closed relation certificate accessor', () => {
  it('uses only admitted public aid views and refuses an over-bound relation', () => {
    const views = mintPatternEvidenceViews([aidRecord('aid-b', 2, 'b', 'a'), aidRecord('aid-a', 1, 'a', 'b')])
    const result = readAttentionReadableClosedRelationCertificate({ snapshotLsn: 2, fromLsn: 1, toLsn: 2, patternEvidenceViews: views })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.certificate.admittedRecordIds).toEqual(['aid-a', 'aid-b'])
    expect(readAttentionReadableClosedRelationCertificate({ snapshotLsn: 1, fromLsn: 2, toLsn: 1, patternEvidenceViews: views }))
      .toEqual({ kind: 'refused', reason: 'absence_window_incomplete' })
  })
})
