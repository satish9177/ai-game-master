import type { BeliefDialogueContext, BeliefSourceTrustBucket } from '../domain/dialogue/contracts'
import { currentBeliefs } from '../domain/livingWorldProof/beliefProjection'
import type { Belief } from '../domain/livingWorldProof/contracts'
import type { QueryBounds } from '../domain/livingWorldProof/conflictContracts'
import type { ConflictStore } from '../domain/livingWorldProof/conflictStore'
import type { ReadableRecord } from '../domain/livingWorldProof/evidenceRecords'
import { topicOf, type ReportResolutionStore } from '../domain/livingWorldProof/reportResolutionContracts'
import { lookupSourceTrust } from '../domain/livingWorldProof/sourceTrustProjection'
import type { Logger } from '../platform/logger/Logger'

/**
 * Composition-root orchestrator (belief-driven-npc-dialogue-slice-v0, S2).
 *
 * Bridges the spine's bitemporal projection (`currentBeliefs`) plus the
 * derived source-trust projection (`lookupSourceTrust`) into a small,
 * bounded, holder-scoped, dialogue-local view. One direction only: it reads
 * spine records and never writes back — no belief, transition, edge,
 * observation, transmission or resolution is created, revised or
 * strengthened here.
 *
 * Any failure — including a throwing store — degrades to an empty context
 * instead of propagating, matching `recallRoomMemoryContext`'s discipline.
 * An empty belief section is simply omitted downstream by the prompt builder.
 *
 * The returned shape is dialogue-local (`BeliefDialogueContext`), not the
 * spine's `Belief`: per entry it carries the proposition text verbatim plus
 * bucketed confidence and source trust. It never carries record ids,
 * evidence ids, `sourceRef`, timestamps, supporting/contraditing refs, or any
 * holder id other than the speaker's own (the caller decides whose context
 * this is), and it never carries raw scores. Hedging of the proposition text
 * happens at render time in the prompt builder, keyed by the confidence
 * bucket, so this mapping stays lossless about what was projected while
 * remaining silent about anything the holder is not entitled to know.
 */

/** The read-only spine view the projection is taken over. */
export interface BeliefSpineView {
  readonly universe: readonly ReadableRecord[]
  readonly store: ConflictStore
  readonly bounds: QueryBounds
}

export interface ProjectBeliefDialogueContextOptions {
  /**
   * Optional authoritative ReportResolution ledger. This slice commits no
   * resolutions, so when supplied its lookups resolve to the unknown tier and
   * otherwise the lookup is skipped entirely; the seam becomes live when
   * resolution minting lands. Trust is never defaulted from anything else
   * (ADR-0012 §6.0: `lookupSourceTrust` is the only source of tiers).
   */
  readonly trustStore?: ReportResolutionStore
}

const TIER_RANK: Readonly<Record<'low' | 'medium' | 'high', number>> = { low: 0, medium: 1, high: 2 }

/**
 * A single dialogue-facing trust bucket, combined as the worst of the two
 * derived tiers so an optimistic certainty can never mask a low competence
 * (or vice versa). Raw confirmed/refuted counts never leave this module.
 */
function combineTrustBucket(competence: 'low' | 'medium' | 'high', certainty: 'low' | 'medium' | 'high'): BeliefSourceTrustBucket {
  return TIER_RANK[competence] <= TIER_RANK[certainty] ? competence : certainty
}

function trustBucketFor(holder: string, belief: Belief, store: ConflictStore, trustStore: ReportResolutionStore): BeliefSourceTrustBucket {
  const predicate = store.claims.get(belief.id)?.predicate
  const topic = predicate === undefined ? 'unmapped' : topicOf(predicate)
  if (topic === 'unmapped') return 'unknown'
  const lookup = lookupSourceTrust(trustStore, holder, belief.sourceRef, topic)
  return lookup.tier === 'resolved' ? combineTrustBucket(lookup.competence, lookup.certainty) : 'unknown'
}

function toEntry(holder: string, belief: Belief, store: ConflictStore, trustStore: ReportResolutionStore | undefined): BeliefDialogueContext['entries'][number] {
  return {
    text: belief.proposition,
    confidenceBucket: belief.confidence,
    ...(trustStore !== undefined
      ? { sourceTrustBucket: trustBucketFor(holder, belief, store, trustStore) }
      : { sourceTrustBucket: 'unknown' }),
  }
}

/**
 * Projects `holder`'s current beliefs into the plain dialogue-local shape.
 * Pure with respect to inputs: the universe, store and bounds are read but
 * never mutated, and the returned object shares no structure with them.
 */
export function projectBeliefDialogueContext(
  holder: string,
  spine: BeliefSpineView,
  logger: Logger,
  options?: ProjectBeliefDialogueContextOptions,
): BeliefDialogueContext {
  try {
    const projection = currentBeliefs(holder, spine.universe, spine.store, spine.bounds)
    const entries = projection.beliefs.map((belief) => toEntry(holder, belief, spine.store, options?.trustStore))
    logger.info('belief dialogue context projected', { holder, count: entries.length })
    return { entries }
  } catch {
    logger.warn('belief dialogue context failed', { holder, code: 'belief-projection-threw' })
    return { entries: [] }
  }
}
