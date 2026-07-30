import { readAttentionReadableClosedRelationCertificate } from './attentionClosedRelationCertificateAccessor'
import type { AttentionReadablePatternEvidenceView } from './attentionPatternEvidenceContracts'

/** Fixture-only C2 helper; it consumes A-prime views, never raw/private records. */
export function buildAttentionAbsenceCertificateScenario(input: {
  readonly snapshotLsn: number
  readonly fromLsn: number
  readonly toLsn: number
  readonly patternEvidenceViews: readonly AttentionReadablePatternEvidenceView[]
}) {
  return readAttentionReadableClosedRelationCertificate(input)
}
