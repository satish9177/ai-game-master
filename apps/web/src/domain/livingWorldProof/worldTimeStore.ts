import { compareInstants, instantBefore } from './canonicalProposition'
import type { WorldInstant } from './conflictContracts'

/**
 * The committed world-time record stream ADR-0010 D2/D9 names as one of the
 * deterministic fold's authoritative inputs (spec plan-body-execution-
 * replay-v0.md §0.1/§2.7). This is NOT a plan-execution record family --
 * it is a general append-only clock, the same kind of committed substrate
 * `BeliefTransition`/`ActionOutcome` already are, and ADR-0010 open Q3
 * names its exact binding as downstream spec work this rig settles. No
 * wall clock, no frame counter, no Date.now anywhere: `WorldTimeMark`s are
 * authored/committed exactly like every other record in this folder.
 */

export interface WorldTimeMark {
  id: string
  at: WorldInstant
  commitSeq: number
}

export interface WorldTimeStore {
  marks: readonly WorldTimeMark[]
  nextSeq: number
}

export function initWorldTimeStore(): WorldTimeStore {
  return { marks: [], nextSeq: 1 }
}

export type WorldTimeCommitFault = 'non-monotonic-world-time'

export type WorldTimeCommitResult =
  | { verdict: 'committed'; mark: WorldTimeMark }
  | { verdict: 'rejected'; fault: WorldTimeCommitFault }

/** Commits one world-time mark. World time is monotonic by construction -- a later commit may never assert an earlier instant (replay-safety for Wait crossings, D9/D23). */
export function commitWorldTime(store: WorldTimeStore, id: string, at: WorldInstant): { store: WorldTimeStore; outcome: WorldTimeCommitResult } {
  const last = store.marks[store.marks.length - 1]
  if (last !== undefined && instantBefore(at, last.at)) {
    return { store, outcome: { verdict: 'rejected', fault: 'non-monotonic-world-time' } }
  }
  const commitSeq = store.nextSeq
  const mark: WorldTimeMark = { id, at, commitSeq }
  return { store: { marks: [...store.marks, mark], nextSeq: commitSeq + 1 }, outcome: { verdict: 'committed', mark } }
}

export function worldTimeTxBound(store: WorldTimeStore): number {
  return store.nextSeq - 1
}

/** The latest committed world-time mark at or before `txBound` -- the "current effective world time" any evaluation pass at that commit position observes (ADR-0010 D9's anchor/crossing basis). */
export function latestWorldTimeAt(store: WorldTimeStore, txBound: number): WorldInstant | undefined {
  const visible = store.marks.filter((mark) => mark.commitSeq <= txBound)
  return visible[visible.length - 1]?.at
}

/** The first committed world-time mark whose effective time is >= target, among marks committed at or before `txBound` -- the addressable Wait-crossing trigger (D9/D21). */
export function firstCrossing(store: WorldTimeStore, target: WorldInstant, txBound: number): WorldTimeMark | undefined {
  return store.marks
    .filter((mark) => mark.commitSeq <= txBound)
    .sort((a, b) => a.commitSeq - b.commitSeq)
    .find((mark) => compareInstants(mark.at, target) >= 0)
}

export function addWorldTicks(at: WorldInstant, durationWorldTicks: number): WorldInstant {
  return { night: at.night, tick: at.tick + durationWorldTicks }
}
