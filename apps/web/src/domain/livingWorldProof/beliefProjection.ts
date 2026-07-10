import { canonicalKeyOf, claimKeyOf, compareInstants, detectConflict, instantBefore, sortClaimPair } from './canonicalProposition'
import type { Belief } from './contracts'
import type { BeliefTransition, ConflictEdge, QueryBounds, WorldInstant } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'

/**
 * Bitemporal as-of queries over the conflict store (ADR-0008 D4/D5/D8,
 * spec conflict-edge-replay-v0.md §1.6). Every function here is a pure
 * projection over committed Beliefs, their timing sidecar, and committed
 * BeliefTransitions/ConflictEdges -- there is no other read path, and none
 * of them ever mutate a belief or write back an interval. No LLM, no I/O.
 */

/**
 * A Belief has at most one outgoing transition in v0 (design plan I8,
 * revised) -- so its effective end is simply that transition's
 * `effectiveValidTime` if the transition is visible at `txBound`, else
 * open (`null`). There is nothing to tie-break.
 */
export function effectiveEnd(beliefId: string, transitions: readonly BeliefTransition[], txBound: number): WorldInstant | null {
  const outgoing = transitions.find((transition) => transition.fromBeliefId === beliefId && transition.commitSeq <= txBound)
  return outgoing === undefined ? null : outgoing.effectiveValidTime
}

export interface UnresolvedPair {
  beliefIds: readonly [string, string]
  /** The committed ConflictEdge covering this pair, if one has been minted by `bounds.txBound`. */
  edgeId?: string
}

export interface CurrentProjection {
  beliefs: readonly Belief[]
  /** D8 never-silently-inconsistent: every co-held incompatible claim pair, explicit rather than silently picked. */
  unresolved: readonly UnresolvedPair[]
}

function isBeliefEntry(entry: ReadableRecord): entry is Extract<ReadableRecord, { kind: 'belief' }> {
  return entry.kind === 'belief'
}

/**
 * The holder's current projection at `(validT, txBound)`: beliefs whose
 * `mintSeq <= txBound`, `validFrom <= validT`, and derived effective end is
 * either open or strictly after `validT` -- enforced here, not by caller
 * discipline (ADR-0008 D8). Every co-held incompatible pair is flagged in
 * `unresolved` rather than one being silently preferred.
 */
export function currentBeliefs(holder: string, universe: readonly ReadableRecord[], store: ConflictStore, bounds: QueryBounds): CurrentProjection {
  const holderBeliefs = universe.filter((entry) => isBeliefEntry(entry) && entry.record.holder === holder) as Extract<ReadableRecord, { kind: 'belief' }>[]

  const visible = holderBeliefs.filter((entry) => {
    const timing = store.timing.get(entry.record.id)
    if (timing === undefined) return false
    if (timing.mintSeq > bounds.txBound) return false
    if (compareInstants(timing.validFrom, bounds.validT) > 0) return false
    const end = effectiveEnd(entry.record.id, store.transitions, bounds.txBound)
    return end === null || instantBefore(bounds.validT, end)
  })

  const beliefs = visible.map((entry) => entry.record)
  const unresolved: UnresolvedPair[] = []

  for (const [i, beliefA] of beliefs.entries()) {
    for (const beliefB of beliefs.slice(i + 1)) {
      const claimA = store.claims.get(beliefA.id)
      const claimB = store.claims.get(beliefB.id)
      if (claimA === undefined || claimB === undefined) {
        continue
      }
      if (detectConflict(claimA, claimB).verdict !== 'conflict') {
        continue
      }

      const pairKey = sortClaimPair(claimA, claimB).pairKey
      const edge = store.edges.find((candidate) => candidate.pairKey === pairKey && candidate.commitSeq <= bounds.txBound)
      unresolved.push({ beliefIds: [beliefA.id, beliefB.id], ...(edge !== undefined ? { edgeId: edge.edgeId } : {}) })
    }
  }

  return { beliefs, unresolved }
}

export type KeyProjectionResult =
  | { status: 'none' }
  | { status: 'resolved'; belief: Belief }
  | { status: 'unresolved'; beliefs: readonly Belief[]; conflictEdgeIds: readonly string[] }

/**
 * The holder's current belief on one canonical question, tagged so no
 * caller can silently pick one when the projection is unresolved (design
 * plan correction 3). `unresolved` carries every surviving belief on the
 * key plus the ids of any committed edges covering their co-held pairs
 * (possibly empty -- a co-held incompatibility is still `unresolved` even
 * before an edge has been minted over it).
 */
export function currentBeliefForKey(
  holder: string,
  canonicalKey: string,
  universe: readonly ReadableRecord[],
  store: ConflictStore,
  bounds: QueryBounds,
): KeyProjectionResult {
  const projection = currentBeliefs(holder, universe, store, bounds)
  const matching = projection.beliefs.filter((belief) => {
    const claim = store.claims.get(belief.id)
    return claim !== undefined && canonicalKeyOf(claim) === canonicalKey
  })

  const [onlyMatch] = matching
  if (onlyMatch === undefined) {
    return { status: 'none' }
  }
  if (matching.length === 1) {
    return { status: 'resolved', belief: onlyMatch }
  }

  const matchingIds = new Set(matching.map((belief) => belief.id))
  const edgeIds = new Set<string>()
  for (const pair of projection.unresolved) {
    if (pair.edgeId !== undefined && pair.beliefIds.every((id) => matchingIds.has(id))) {
      edgeIds.add(pair.edgeId)
    }
  }

  return { status: 'unresolved', beliefs: matching, conflictEdgeIds: [...edgeIds] }
}

/** World-state succession (D5): the projection consults no transitions, only the derived effective-period rule (canonicalProposition.ts). */
export { latestValidStateClaim as latestValidClaim } from './canonicalProposition'

/**
 * Derives edge activity -- never stored, never mutated (ADR-0008 D9).
 * Active iff, at `bounds`, some holder's current projection still holds a
 * belief carrying either endpoint claim, or a transition visible at
 * `bounds.txBound` cites the edge while its destination is still current
 * for its holder (an open chain). Matching is claim-level: after a
 * correction, the successor belief carries the same claimKey as the
 * evidence that corrected it, so the edge stays active without any stored
 * status field.
 */
export function isConflictActive(edge: ConflictEdge, universe: readonly ReadableRecord[], store: ConflictStore, bounds: QueryBounds): boolean {
  const holders = [...new Set(universe.filter(isBeliefEntry).map((entry) => entry.record.holder))]
  const endpointKeys = new Set(edge.endpoints.map((endpoint) => endpoint.claimKey))

  const heldByAnyHolder = holders.some((holder) =>
    currentBeliefs(holder, universe, store, bounds).beliefs.some((belief) => {
      const claim = store.claims.get(belief.id)
      return claim !== undefined && endpointKeys.has(claimKeyOf(claim))
    }),
  )
  if (heldByAnyHolder) {
    return true
  }

  return store.transitions.some((transition) => {
    if (transition.commitSeq > bounds.txBound) return false
    if (!transition.conflictEdgeIds.includes(edge.edgeId)) return false
    return currentBeliefs(transition.holder, universe, store, bounds).beliefs.some((belief) => belief.id === transition.toBeliefId)
  })
}
