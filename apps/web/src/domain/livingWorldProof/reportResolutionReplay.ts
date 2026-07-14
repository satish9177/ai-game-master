import { JudgeProbe, replayConflictLog } from './conflictReplay'
import type { ClaimRegistry, ConflictCommit } from './conflictContracts'
import type { ReadableRecord } from './evidenceRecords'
import { SOURCE_TRUST_RULE_VERSION } from './reportResolutionContracts'
import type { ReportResolution, ReportResolutionCommit, ReportResolutionStore } from './reportResolutionContracts'

/**
 * Deterministic replay for the source-trust ledger (research vault
 * ADR-0012 D12, spec §11). There is no independent commit log for report
 * Beliefs -- the underlying `ConflictStore`'s commit log (unmodified
 * `replayConflictLog`) already reconstructs every report Belief's timing
 * byte-identically, exactly as `attributionReplay.ts` reuses it for
 * attribution Beliefs. This module supplies the two things unique to this
 * rig: materializing every resolving-Observation commit marker and every
 * committed `ReportResolution` from this store's OWN append-only
 * `commitLog` -- verbatim, never re-running `mintReportResolution`'s
 * five-condition gate.
 *
 * `mintReportResolution`/`commitReportResolution` are never imported by
 * this file -- structurally absent from the replay module's import graph
 * (F10), exactly as `attributionReplay.ts` never imports
 * `commitBelief`/`commitRevision`/`mintEdge`.
 */

export { JudgeProbe }

/**
 * Any call to `mintReportResolution` during replay is forbidden (D12).
 * `calls` is asserted zero after every replay (P60); a direct call is a
 * hard failure by construction. Kept distinct from `JudgeProbe` -- this
 * proof has no proposer/judge at all, and the property this probe guards
 * ("replay never mints") is a different one from "replay never calls a
 * model" (P65, trivially true here since no LLM exists in this fixture).
 */
export class MintProbe {
  calls = 0

  call(): never {
    this.calls += 1
    throw new Error('MintProbe: mintReportResolution was invoked during replay -- forbidden (ADR-0012 D12)')
  }
}

export interface SourceTrustReplayReport {
  judgeCalls: number
  mintCalls: number
  verifiedEdges: readonly string[]
  verifiedTransitions: readonly string[]
  canonicalizerVersionMismatches: readonly string[]
  ruleVersionMismatches: readonly string[]
  materializedObservationCommits: readonly string[]
  materializedResolutions: readonly string[]
  /** Resolutions whose recorded `ruleVersion` does not match the current `srt_v0` -- materialized verbatim, never reinterpreted (D12, P61). */
  ruleVersionMismatchedResolutions: readonly string[]
}

/**
 * Replays a recorded commit stream onto a fresh store, reconstructing:
 * every report Belief's timing (via the unmodified `replayConflictLog`),
 * every resolving-Observation commit marker, and the full `ReportResolution`
 * ledger -- byte-identically, at every query bound. Any recorded-invariant
 * violation (a duplicate id, or two resolutions sharing one provenance-root
 * dedup key) is a hard failure, never a partial/best-effort replay -- the
 * same discipline `replayConflictLog`/`replayAttributionLog` already apply.
 * `mint` is accepted only so a caller can pass a live `MintProbe` and assert
 * `.calls === 0` afterward; this function never calls it.
 */
export function replaySourceTrustLog(
  universe: readonly ReadableRecord[],
  claims: ClaimRegistry,
  conflictCommits: readonly ConflictCommit[],
  reportResolutionCommits: readonly ReportResolutionCommit[],
  judge: JudgeProbe,
  mint: MintProbe,
): { store: ReportResolutionStore; report: SourceTrustReplayReport } {
  const { store: conflict, report: conflictReport } = replayConflictLog(universe, claims, conflictCommits, judge)

  const observationCommits = new Map<string, number>()
  const resolutions: ReportResolution[] = []
  const materializedObservationCommits: string[] = []
  const materializedResolutions: string[] = []
  const ruleVersionMismatchedResolutions: string[] = []

  for (const commit of reportResolutionCommits) {
    if (commit.kind === 'observation-commit') {
      if (observationCommits.has(commit.observationId)) {
        throw new Error(`replaySourceTrustLog: recorded-invariant-violation -- duplicate observation commit for ${commit.observationId}`)
      }
      observationCommits.set(commit.observationId, commit.commitSeq)
      materializedObservationCommits.push(commit.observationId)
      continue
    }

    const resolution = commit.resolution
    if (resolutions.some((existing) => existing.resolutionId === resolution.resolutionId)) {
      throw new Error(`replaySourceTrustLog: recorded-invariant-violation -- duplicate resolutionId ${resolution.resolutionId}`)
    }
    const rootAlreadyConsumed = resolutions.some(
      (existing) =>
        existing.reportProvenanceRoot === resolution.reportProvenanceRoot &&
        existing.sourceId === resolution.sourceId &&
        existing.reportClaimKey === resolution.reportClaimKey,
    )
    if (rootAlreadyConsumed) {
      throw new Error(`replaySourceTrustLog: recorded-invariant-violation -- duplicate provenance-root contribution for ${resolution.resolutionId}`)
    }

    resolutions.push(resolution)
    if (resolution.ruleVersion === SOURCE_TRUST_RULE_VERSION) {
      materializedResolutions.push(resolution.resolutionId)
    } else {
      ruleVersionMismatchedResolutions.push(resolution.resolutionId)
    }
  }

  const maxObservationSeq = Math.max(0, ...[...observationCommits.values()])
  const maxResolutionSeq = Math.max(0, ...resolutions.map((resolution) => resolution.commitSeq))
  const nextSeq = Math.max(conflict.nextSeq, maxObservationSeq + 1, maxResolutionSeq + 1)

  const store: ReportResolutionStore = {
    conflict: { ...conflict, nextSeq },
    observationCommits,
    resolutions,
    commitLog: reportResolutionCommits,
  }

  return {
    store,
    report: {
      judgeCalls: conflictReport.judgeCalls,
      mintCalls: mint.calls,
      verifiedEdges: conflictReport.verifiedEdges,
      verifiedTransitions: conflictReport.verifiedTransitions,
      canonicalizerVersionMismatches: conflictReport.canonicalizerVersionMismatches,
      ruleVersionMismatches: conflictReport.ruleVersionMismatches,
      materializedObservationCommits,
      materializedResolutions,
      ruleVersionMismatchedResolutions,
    },
  }
}
