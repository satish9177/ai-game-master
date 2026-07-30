import { evaluateAttentionRevealerLegality } from './attentionRevealerLegality'
import type { AttentionRevealerAuthorityRequest, AttentionRevealerAuthorityVerdict } from './attentionRevealerLegality'

export type AttentionDiegeticAggregateLegitimacyResult =
  | { readonly kind: 'ok'; readonly verdict: Extract<AttentionRevealerAuthorityVerdict, { readonly kind: 'legal' }> }
  | { readonly kind: 'refused'; readonly reason: 'aggregate_assertion_not_legal' | 'no_legal_channel' | 'no_legal_revealer' }
  | { readonly kind: 'bypassed' }

/** D9 check B's diegetic branch. The three accepted routes are selected only by the authority verdict. */
export function evaluateAttentionDiegeticAggregateLegitimacy(
  input: AttentionRevealerAuthorityRequest,
): AttentionDiegeticAggregateLegitimacyResult {
  const verdict = evaluateAttentionRevealerLegality(input)
  if (verdict.kind === 'bypassed') return verdict
  if (verdict.kind === 'refused') return verdict.reason === 'no_legal_channel'
    ? { kind: 'refused', reason: 'no_legal_channel' }
    : { kind: 'refused', reason: 'no_legal_revealer' }
  return { kind: 'ok', verdict }
}
