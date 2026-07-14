import { initConflictStore } from './conflictStore'
import type { ConflictStore } from './conflictStore'
import type { ClaimRegistry, WorldInstant } from './conflictContracts'
import type { ReadableRecord } from './evidenceRecords'
import { mintReportResolution, reportProvenanceRootOf } from './reportResolutionRules'
import type {
  MintRejectReason,
  ReportIndex,
  ReportResolution,
  ReportResolutionCause,
  ReportResolutionCommit,
  ReportResolutionStore,
  TopicId,
} from './reportResolutionContracts'

/**
 * The append-only source-trust store (research vault ADR-0012, spec §3.2).
 * Every mutator here is pure -- it returns a new store rather than mutating
 * the one passed in -- mirroring `conflictStore.ts`'s own discipline
 * exactly. `conflict.nextSeq` is the ONE shared transaction-time counter
 * every commit in this rig draws from: report Beliefs (via the reused,
 * unmodified `commitBelief`), resolving Observations (`commitObservation`
 * below, this rig's own addition -- the harness has no existing "commit an
 * Observation" concept), and `ReportResolution` mints
 * (`commitReportResolution` below) all advance the identical counter, so
 * condition 3's "commits after" check is always comparing values drawn from
 * one monotonic sequence.
 */

export function initReportResolutionStore(claims: ClaimRegistry): ReportResolutionStore {
  return { conflict: initConflictStore(claims), observationCommits: new Map(), resolutions: [], commitLog: [] }
}

export type CommitObservationOutcome = { verdict: 'committed'; commitSeq: number } | { verdict: 'rejected'; fault: 'unknown-observation' | 'already-committed' }

/**
 * Registers a resolving Observation's commit-order marker, mirroring
 * `conflictStore.ts`'s `commitBelief` exactly in shape (idempotent-refusal
 * on a repeat, never an overwrite) but for Observations rather than
 * Beliefs, and sharing the same `conflict.nextSeq` counter.
 */
export function commitObservation(
  store: ReportResolutionStore,
  universe: readonly ReadableRecord[],
  observationId: string,
): { store: ReportResolutionStore; outcome: CommitObservationOutcome } {
  const entry = universe.find((candidate) => candidate.record.id === observationId)
  if (entry === undefined || entry.kind !== 'observation') {
    return { store, outcome: { verdict: 'rejected', fault: 'unknown-observation' } }
  }
  if (store.observationCommits.has(observationId)) {
    return { store, outcome: { verdict: 'rejected', fault: 'already-committed' } }
  }

  const commitSeq = store.conflict.nextSeq
  const observationCommits = new Map(store.observationCommits)
  observationCommits.set(observationId, commitSeq)
  const conflict: ConflictStore = { ...store.conflict, nextSeq: commitSeq + 1 }
  const commit: ReportResolutionCommit = { kind: 'observation-commit', observationId, commitSeq }

  return {
    store: { ...store, conflict, observationCommits, commitLog: [...store.commitLog, commit] },
    outcome: { verdict: 'committed', commitSeq },
  }
}

export interface ResolveReportInput {
  resolutionId: string
  holderId: string
  sourceId: string
  topicId: TopicId
  reportRef: string
  reportClaimKey: string
  resolutionRef: string
  resolutionClaimKey: string
  polarity: 'confirms' | 'refutes'
  resolutionCause: ReportResolutionCause
  validTime: WorldInstant
  beliefTransitionRef?: string
}

export type CommitReportResolutionOutcome =
  | { verdict: 'mint'; resolution: ReportResolution }
  | { verdict: 'rejected'; reason: MintRejectReason }

/**
 * Live-processing-only wrapper (D4/D12): resolves `reportCommitSeq` from
 * this store's own commit-order records (never trusting a caller-supplied
 * number), computes the provenance root, then calls the pure
 * `mintReportResolution` gate. On `mint`, assigns `commitSeq` from the
 * shared counter (exactly as `conflictStore.ts`'s `commitRevision`/
 * `commitTransition` assign `commitSeq` to `buildTransition`'s output) and
 * appends to both `resolutions` and this store's own `commitLog`. This is
 * the ONLY function in the whole rig that ever inserts a `ReportResolution`
 * outside of replay materialization (§13/F10).
 *
 * `resolutionCommitSeq`: when `resolutionRef` names a genuinely committed
 * Observation, its real, store-tracked commit sequence is used, so
 * `mintReportResolution`'s own condition 2 governs ordinary "resolver
 * committed before the report" rejections exactly as before (F2/F3/F4).
 * When `resolutionRef` has no `observationCommits` entry at all --
 * testimony, a hidden-`TruthEvent`-shaped id, or any other wrong-kind or
 * unknown reference -- that absence is NOT a temporal fact about the
 * report/resolver ordering, so it must never be classified as one: a
 * deterministic sentinel (this store's own next-assignable sequence,
 * `store.conflict.nextSeq`, always strictly greater than any already-
 * assigned `reportCommitSeq`) is used instead, purely so condition 3
 * (commit-sequence ordering) passes through without asserting anything
 * about a record that was never committed as an Observation. Conditions
 * 1-4 are therefore always evaluated by `mintReportResolution` itself
 * before any wrong-kind reference is judged, so it is condition 5's own
 * runtime `kind`/`observer` lookup -- never this wrapper's absence-of-an-
 * observation-commit check -- that produces `resolution-not-holder-
 * observation` (F6/F7/F8). `reportIndex` is passed straight through to
 * `mintReportResolution` unmodified -- this wrapper never reads or derives
 * a predicate itself; condition 2's topic derivation is entirely
 * `mintReportResolution`'s own responsibility, reading only the committed
 * `ReportIndexEntry` for `reportRef` (D9, closes the reportPredicate-
 * authority gap: there is no predicate field anywhere in `ResolveReportInput`
 * for a caller to independently supply).
 */
export function commitReportResolution(
  store: ReportResolutionStore,
  universe: readonly ReadableRecord[],
  reportIndex: ReportIndex,
  input: ResolveReportInput,
): { store: ReportResolutionStore; outcome: CommitReportResolutionOutcome } {
  const reportTiming = store.conflict.timing.get(input.reportRef)
  if (reportTiming === undefined) {
    return { store, outcome: { verdict: 'rejected', reason: 'report-not-committed' as MintRejectReason } }
  }

  const resolutionCommitSeq = store.observationCommits.get(input.resolutionRef) ?? store.conflict.nextSeq

  const reportProvenanceRoot = reportProvenanceRootOf(universe, reportIndex, store.conflict.timing, input.sourceId, input.reportClaimKey)

  const gateOutcome = mintReportResolution({
    resolutionId: input.resolutionId,
    holderId: input.holderId,
    sourceId: input.sourceId,
    topicId: input.topicId,
    reportRef: input.reportRef,
    reportClaimKey: input.reportClaimKey,
    reportCommitSeq: reportTiming.mintSeq,
    resolutionRef: input.resolutionRef,
    resolutionCommitSeq,
    resolutionClaimKey: input.resolutionClaimKey,
    polarity: input.polarity,
    resolutionCause: input.resolutionCause,
    validTime: input.validTime,
    beliefTransitionRef: input.beliefTransitionRef,
    universe,
    reportIndex,
    reportProvenanceRoot,
    existingResolutions: store.resolutions,
  })

  if (gateOutcome.verdict === 'rejected') {
    return { store, outcome: gateOutcome }
  }

  const commitSeq = store.conflict.nextSeq
  const resolution: ReportResolution = { ...gateOutcome.resolution, commitSeq }
  const conflict: ConflictStore = { ...store.conflict, nextSeq: commitSeq + 1 }
  const commit: ReportResolutionCommit = { kind: 'resolution', resolution }

  const nextStore: ReportResolutionStore = {
    ...store,
    conflict,
    resolutions: [...store.resolutions, resolution],
    commitLog: [...store.commitLog, commit],
  }

  return { store: nextStore, outcome: { verdict: 'mint', resolution } }
}
