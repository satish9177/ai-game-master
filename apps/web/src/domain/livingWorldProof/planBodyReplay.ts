import { canonicalSerialize } from './canonicalSerialization'
import type { WorldTimeMark, WorldTimeStore } from './worldTimeStore'
import type { ExecutionStateSnapshot, PlanBodyEvalInputs } from './planBodyProjection'
import { deriveExecutionState } from './planBodyProjection'

/**
 * Cold replay for the plan-body layer (ADR-0010 D23, spec §5.1/P57-P62).
 * There is no plan-execution commit log of its own to replay (D2) --
 * `IntentionCommit`/`ConflictCommit` replay (existing, unmodified) already
 * reconstructs the intention and conflict stores byte-identically; this
 * module supplies the one missing piece (the world-time commit log) and
 * the canonical execution-state snapshot both a live run and a cold
 * replay compare against, exercising `deriveExecutionState` itself --
 * never a separate "exec state replay" path, because there is no such
 * state to replay: it is always derived fresh (D2/D23).
 */

/** Materializes a world-time commit log into a fresh store -- no rule or allocator re-invoked, exactly mirroring `replayIntentionLog`/`replayConflictLog`'s discipline. */
export function replayWorldTimeLog(marks: readonly WorldTimeMark[]): WorldTimeStore {
  const sorted = [...marks].sort((a, b) => a.commitSeq - b.commitSeq)
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]
    const previous = sorted[i - 1]
    if (current !== undefined && previous !== undefined && current.commitSeq === previous.commitSeq) {
      throw new Error(`replayWorldTimeLog: recorded-invariant-violation -- duplicate commitSeq ${current.commitSeq}`)
    }
  }
  const maxSeq = sorted.reduce((max, mark) => Math.max(max, mark.commitSeq), 0)
  return { marks: sorted, nextSeq: maxSeq + 1 }
}

function sortedEntries<T>(map: ReadonlyMap<string, T>): Array<[string, T]> {
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

/** A canonically-serialized snapshot of one execution scope's fully-derived state -- two calls (live vs. cold-replayed stores) must be byte-equal (P58). */
export function capturePlanBodyExecutionSnapshot(inputs: PlanBodyEvalInputs): string {
  const state: ExecutionStateSnapshot = deriveExecutionState(inputs)
  return canonicalSerialize({
    scopeOpen: state.scopeOpen,
    suspended: state.suspended,
    activePath: state.activePath,
    dispatchCandidate: state.dispatchCandidate,
    planLocalResult: state.planLocalResult,
    waitStates: sortedEntries(state.waitStates),
    haltedThisPass: state.haltedThisPass,
    retryCounts: sortedEntries(state.retryCounts),
  })
}
