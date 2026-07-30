import { buildAttentionDirectEvidenceAssertions } from './attentionDirectEvidenceAssertion'
import type { AttentionDirectEvidenceAssertion } from './attentionDirectEvidenceAssertion'

export function buildC1ReciprocalAidAssertions(): readonly AttentionDirectEvidenceAssertion[] {
  const built = buildAttentionDirectEvidenceAssertions([
    { actorId: 'a', assertionKind: 'public_aid', sourceRecordId: 'c1-aid-a-b', targetId: 'b', visibilityProvenanceId: 'c1-public-a-b' },
    { actorId: 'b', assertionKind: 'public_aid', sourceRecordId: 'c1-aid-b-a', targetId: 'a', visibilityProvenanceId: 'c1-public-b-a' },
  ])
  if (built.kind !== 'ok') throw new Error('C1 scenario construction refused')
  return built.assertions
}
