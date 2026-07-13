import { canonicalSerialize } from './canonicalSerialization'
import { captureConflictSnapshot, JudgeProbe, replayConflictLog } from './conflictReplay'
import type { ClaimRegistry, ConflictCommit, QueryBounds } from './conflictContracts'
import type { ReadableRecord } from './evidenceRecords'
import type { Observation } from './contracts'
import { UNDERSTANDING_RULE_VERSION } from './attributionContracts'
import type { AttributionTransitionSupportMap } from './attributionContracts'
import { understandDefault, understandDistracted } from './attributionUnderstanding'
import type { AttributionStore } from './attributionStore'

/**
 * Deterministic replay for the attribution layer (research vault ADR-0011
 * D18, spec §12). There is no independent attribution commit log to
 * replay (D8/D21 condition 1) -- the underlying `ConflictStore`'s commit
 * log (unmodified `replayConflictLog`) already reconstructs every
 * attribution `Belief`/`BeliefTransition` byte-identically, since an
 * attribution IS an ordinary `Belief`. This module supplies the one
 * missing piece: materializing each `AttributionTransitionSupport` sidecar
 * entry ALONGSIDE its owning transition (never independently, never ahead
 * of it), plus a verification-only re-derivation check -- never a
 * historical decision (§5.3/§12).
 */

export { JudgeProbe }

export interface AttributionReplayReport {
  judgeCalls: number
  verifiedEdges: readonly string[]
  verifiedTransitions: readonly string[]
  canonicalizerVersionMismatches: readonly string[]
  ruleVersionMismatches: readonly string[]
  /** Every sidecar entry whose `transitionId` resolved to a committed transition in the replayed store (D8: no independent lifecycle). */
  materializedSidecars: readonly string[]
  /** Sidecar entries whose recorded understanding-rule version matches the current rule and whose re-derivation disagreed with the recorded transition -- verification-only, never authoritative. */
  understandingReDerivationMismatches: readonly string[]
}

function observationOf(universe: readonly ReadableRecord[], id: string): Observation | undefined {
  const entry = universe.find((candidate) => candidate.record.id === id)
  return entry?.kind === 'observation' ? entry.record : undefined
}

/**
 * A deterministic, verification-only re-derivation: given a sidecar's
 * recorded `input_record_ids` and `understanding_rule_id`, re-runs the
 * CURRENT rule (only when its version matches the recorded version) and
 * reports whether the recomputed `understood` value would differ. Never
 * authors or replaces the historical transition (§5.3/§12) -- purely a
 * report-only comparison, exactly like `conflictReplay.ts`'s
 * `verifyTransitionOracle`.
 */
function reDeriveUnderstood(universe: readonly ReadableRecord[], understandingRuleId: string, inputRecordIds: readonly string[]): boolean | undefined {
  const [primaryId, competingId] = inputRecordIds
  const primary = primaryId === undefined ? undefined : observationOf(universe, primaryId)
  if (primary === undefined) return undefined

  if (understandingRuleId === 'understand_default') {
    return understandDefault(primary.observer, primary).understood
  }
  if (understandingRuleId === 'understand_distracted') {
    const competing = competingId === undefined ? undefined : observationOf(universe, competingId)
    if (competing === undefined) return undefined
    return understandDistracted(primary.observer, primary, competing).understood
  }
  return undefined
}

/**
 * Replays a recorded commit stream onto a fresh store (the unmodified
 * `replayConflictLog`), then materializes every sidecar entry alongside its
 * now-replayed owning transition. Any sidecar whose `transitionId` does not
 * resolve to a replayed transition is a recorded-invariant violation --
 * exactly the discipline `replayConflictLog` already applies to edges and
 * transitions.
 */
export function replayAttributionLog(
  universe: readonly ReadableRecord[],
  claims: ClaimRegistry,
  conflictCommits: readonly ConflictCommit[],
  sidecars: AttributionTransitionSupportMap,
  judge: JudgeProbe,
): { store: AttributionStore; report: AttributionReplayReport } {
  const { store: conflict, report } = replayConflictLog(universe, claims, conflictCommits, judge)

  const materializedSidecars: string[] = []
  const understandingReDerivationMismatches: string[] = []

  for (const [transitionId, support] of sidecars) {
    if (!conflict.transitions.some((transition) => transition.transitionId === transitionId)) {
      throw new Error(`replayAttributionLog: recorded-invariant-violation -- sidecar ${transitionId} has no owning transition`)
    }
    materializedSidecars.push(transitionId)

    if (support.understandingRuleId !== undefined && support.understandingRuleVersion === UNDERSTANDING_RULE_VERSION) {
      const rederived = reDeriveUnderstood(universe, support.understandingRuleId, support.inputRecordIds)
      // The committed transition existing at all is itself evidence the
      // rule fired positively (every ascribe_* rule requires understood:
      // true to fire) -- a mismatch here means re-derivation now disagrees.
      if (rederived === false) {
        understandingReDerivationMismatches.push(transitionId)
      }
    }
  }

  return {
    store: { conflict, sidecars },
    report: { ...report, materializedSidecars, understandingReDerivationMismatches },
  }
}

/**
 * A deterministic, canonically-serialized snapshot spanning the conflict
 * layer (reusing `captureConflictSnapshot` verbatim) plus every sidecar
 * entry -- two replays' snapshots (or replay vs. live) must be byte-equal.
 */
export function captureAttributionSnapshot(universe: readonly ReadableRecord[], store: AttributionStore, boundsGrid: readonly QueryBounds[]): string {
  const conflictSnapshot = captureConflictSnapshot(universe, store.conflict, boundsGrid)
  const sortedSidecars = [...store.sidecars.entries()].sort(([a], [b]) => a.localeCompare(b))
  return canonicalSerialize({ conflictSnapshot, sidecars: sortedSidecars })
}
