import type { Confidence } from './contracts'
import type { SourceTrustLookup } from './sourceTrustProjection'

/**
 * The report-confidence cap consumer (research vault ADR-0012 D11, spec
 * §6.1) -- the additive consumer this proof introduces for the first time
 * (spec §3.5: no prior working "report -> world-belief, trust-capped"
 * function existed in the harness to rewire). `preCapConfidence` comes from
 * the existing, unmodified evidence-hierarchy/corroboration logic
 * (calculus §2.4/§2.9); this function only ever narrows it, never raises it
 * (F24).
 *
 * BINDING (D11/D14 item 17, single trust authority): this module's only
 * import besides `Confidence`/`SourceTrustLookup` types is nothing --
 * there is no `TrustRegistry` parameter anywhere in this file, no
 * `speakerTrust` field is ever read, and `trustOf`/`TRUST_TO_CAP`
 * (attributionRules.ts/attributionContracts.ts) are never imported here.
 * This closure is structural (the function's signature cannot accept a
 * per-speaker trust value at all), not a review convention -- mirroring
 * the discipline ADR-0011 D8 already applies to keep a modeled holder's
 * private store out of an ascription rule's signature.
 */

const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 }

function minConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b
}

/**
 * The cap value an unknown, or merely-`low`-certainty (not yet
 * *established*), source's reports are held to -- unchanged from what the
 * pre-existing calculus already assigned before this ADR (D11's table, row
 * 1/2). Not fixed by ADR-0012 or Note 017 to any specific value; `medium`
 * is this proof's own engineering choice, consistent with the existing,
 * already-accepted ADR-0011 `TRUST_TO_CAP` precedent (`attributionRules.ts`)
 * of capping a merely-`medium`-trust source at `medium` -- an untested
 * source is treated no more permissively than a known-but-unremarkable one.
 */
export const UNKNOWN_SOURCE_DEFAULT_CAP: Confidence = 'medium'

export interface ApplyReportConfidenceCapInput {
  preCapConfidence: Confidence
  trust: SourceTrustLookup
}

export type ApplyReportConfidenceCapOutcome = { verdict: 'cap'; confidence: Confidence } | { verdict: 'reject' }

/**
 * `applyReportConfidenceCap` (§6.1's table): `reject` mints no world belief,
 * but it never suppresses the assertion fact -- `epSpeakerAct`'s
 * unconditional mint (D6 item 1) already committed "S asserted P" before
 * this function ever runs, and nothing here or in any caller touches that
 * Belief (P41/F23).
 */
export function applyReportConfidenceCap(input: ApplyReportConfidenceCapInput): ApplyReportConfidenceCapOutcome {
  if (input.trust.tier === 'unknown') {
    return { verdict: 'cap', confidence: minConfidence(input.preCapConfidence, UNKNOWN_SOURCE_DEFAULT_CAP) }
  }

  if (input.trust.certainty === 'low') {
    return { verdict: 'cap', confidence: minConfidence(input.preCapConfidence, UNKNOWN_SOURCE_DEFAULT_CAP) }
  }

  if (input.trust.competence === 'high') {
    return { verdict: 'cap', confidence: minConfidence(input.preCapConfidence, 'medium') }
  }

  if (input.trust.competence === 'medium') {
    return { verdict: 'cap', confidence: minConfidence(input.preCapConfidence, 'low') }
  }

  return { verdict: 'reject' }
}
