import type { ReportResolutionStore, SourceTrustProjection, SourceTrustTier, TopicId } from './reportResolutionContracts'

/**
 * Derived projection (research vault ADR-0012 D8, spec §7). Total,
 * deterministic, integer-only: every non-negative `(C, R)` pair -- the
 * confirmed/refuted counts on one `(holderId, sourceId, topicId)` key --
 * projects to exactly one of nine `(competence, certainty)` cells. Tiers
 * are NEVER stored (D1) -- this module is the only place they are computed,
 * always from committed `ReportResolution` counts and the `srt_v0` rule
 * version alone.
 *
 * Cutpoints (§7.1, experiment-selected engineering cutpoints that satisfy
 * the ADR's invariants and keep the fixture bounded -- not uniquely implied
 * by the literature or the ADR; other cutpoints, including smaller ones,
 * could satisfy the same invariants):
 *
 *   competence high   iff  C >= 2R + 1
 *   competence low    iff  R >= 2C + 1
 *   competence medium otherwise
 *
 *   certainty low     iff  C + R <= 2
 *   certainty high    iff  C + R >= 9
 *   certainty medium  otherwise
 *
 * Every threshold above is an exact integer inequality -- no float is ever
 * computed on the write path (D8).
 */
export function deriveSourceTrustProjection(confirmed: number, refuted: number): SourceTrustProjection {
  const competence: SourceTrustTier = confirmed >= 2 * refuted + 1 ? 'high' : refuted >= 2 * confirmed + 1 ? 'low' : 'medium'

  const total = confirmed + refuted
  const certainty: SourceTrustTier = total <= 2 ? 'low' : total >= 9 ? 'high' : 'medium'

  return { competence, certainty }
}

export type SourceTrustLookup =
  | { tier: 'unknown' }
  | { tier: 'resolved'; confirmed: number; refuted: number; competence: SourceTrustTier; certainty: SourceTrustTier }

/**
 * `lookupSourceTrust` (§6.0): the ONLY function that may determine whether a
 * source is unknown vs. resolved for a given holder/topic -- it never falls
 * back to `TrustRegistry` (§3.5). Returns `{tier: 'unknown'}` IFF no
 * `ReportResolution` exists for this exact key -- structurally distinct
 * from any resolved state, including the mathematically-defined-but-
 * never-stored `(0,0)` case (§7.4): minting always produces `C+R >= 1`, so
 * a key with zero total resolutions is never actually reachable here --
 * only an absent key is.
 */
export function lookupSourceTrust(store: ReportResolutionStore, holderId: string, sourceId: string, topicId: TopicId): SourceTrustLookup {
  const matching = store.resolutions.filter(
    (resolution) => resolution.holderId === holderId && resolution.sourceId === sourceId && resolution.topicId === topicId,
  )

  if (matching.length === 0) {
    return { tier: 'unknown' }
  }

  const confirmed = matching.filter((resolution) => resolution.outcome === 'confirmed').length
  const refuted = matching.filter((resolution) => resolution.outcome === 'refuted').length
  const projection = deriveSourceTrustProjection(confirmed, refuted)

  return { tier: 'resolved', confirmed, refuted, ...projection }
}
