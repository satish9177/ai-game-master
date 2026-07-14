import { runCompactionPass } from './compactionPass'
import type { CompactionProposal, ContradictionEdge, ProofConsequenceRecord } from './compactionContracts'
import type { ReadableRecord } from './evidenceRecords'
import type { ArcRecord } from './hierarchyContracts'
import { resolutionVisible } from './reportResolutionContracts'
import type { ReportResolutionStore, TopicId } from './reportResolutionContracts'
import { lookupSourceTrust } from './sourceTrustProjection'
import type { SourceTrustLookup } from './sourceTrustProjection'

/**
 * ReportResolution compaction (research vault ADR-0012 D13, spec §3.2/§12):
 * because `ReportResolution` is never a `ReadableRecord`, it is never a
 * candidate for `compactionGates.ts`'s demote/merge pipeline in the first
 * place -- not because that pipeline preserves it through some existing
 * gate, but because the pipeline has no path to it at all, exactly as it
 * has none to `ConflictEdge`/`BeliefTransition`. This module is therefore
 * a thin, documentary pass-through, never a new gate: it runs the
 * existing, UNMODIFIED `runCompactionPass` over the fixture's OTHER record
 * families and never touches a `ReportResolutionStore` at all -- there is
 * no parameter here for one. `ReportResolution` needs no pin set, no
 * survival-only counter checkpoint, and no special-case code (D13/D14
 * item 14): this is the second content layer since ADR-0007 (after
 * attribution) to add zero to the compaction predicate list, and it does
 * so more strongly than attribution's zero-predicate claim, since
 * `ReportResolution` never even enters the `ReadableRecord`-gated pipeline
 * attribution's `Belief`-shaped records do.
 */
export function runSourceTrustAwareCompactionPass(
  universe: readonly ReadableRecord[],
  arcs: readonly ArcRecord[],
  edges: readonly ContradictionEdge[],
  consequences: readonly ProofConsequenceRecord[],
  proposals: readonly CompactionProposal[],
  budget: number,
): ReturnType<typeof runCompactionPass> {
  return runCompactionPass(universe, arcs, edges, consequences, proposals, budget)
}

/**
 * A snapshot of every `ReportResolution`'s holder-scoped visibility verdict
 * -- for asserting a compaction pass over the OTHER record families leaves
 * every verdict unchanged (P62/P63, no visibility drift).
 */
export interface SourceTrustVisibilitySnapshotEntry {
  resolutionId: string
  visibleToHolder: boolean
}

export function snapshotResolutionVisibility(store: ReportResolutionStore, holderId: string): readonly SourceTrustVisibilitySnapshotEntry[] {
  return store.resolutions.map((resolution) => ({ resolutionId: resolution.resolutionId, visibleToHolder: resolutionVisible(holderId, resolution) }))
}

/** A snapshot of one key's derived tier -- for asserting compaction never changes it (P64). */
export function snapshotSourceTrust(store: ReportResolutionStore, holderId: string, sourceId: string, topicId: TopicId): SourceTrustLookup {
  return lookupSourceTrust(store, holderId, sourceId, topicId)
}
