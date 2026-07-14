import { canonicalKeyOf } from './canonicalProposition'
import type { CanonicalClaim, BeliefTimingMap, WorldInstant } from './conflictContracts'
import type { ReadableRecord } from './evidenceRecords'
import type { MintRejectReason, ReportIndex, ReportResolution, ReportResolutionCause, TopicId } from './reportResolutionContracts'
import { REPORT_RESOLUTION_SCHEMA_VERSION, SOURCE_TRUST_RULE_VERSION as SRT_V0, topicOf } from './reportResolutionContracts'

/**
 * Minting rule (research vault ADR-0012 D4/D6/D10, spec §5). Every function
 * here is a pure, deterministic, versioned rule whose input signature reads
 * only already-committed records (a `universe: readonly ReadableRecord[]`
 * snapshot and this rig's own hand-registered `ReportIndex`) -- it can
 * never name a modeled source's private belief store, hidden `TruthEvent`
 * data, or an LLM/proposer result (D6, F9/F11/F12).
 */

// ---- Report provenance root (D7/D10 rule 5, §5.0) --------------------------

/**
 * `reportProvenanceRootOf` (§5.0): a pure EARLIEST-MATCH FILTER over the
 * committed `epSpeakerAct` ledger -- scans every committed "S asserted P"
 * event-participation `Belief` for this exact `(sourceId, reportClaimKey)`
 * pair and returns the one with the lowest commit sequence. This is NOT a
 * chain-following walk (`intentionRules.ts`'s `provenancePathHolders` walks
 * a `RumorTransmission.sourceBelief`/`sourceRef` pointer chain to find a
 * rumor's origin holder -- a different algorithm shape); every candidate
 * here is a direct source assertion, never a relayed rumor, so no chain-walk
 * is needed at all. Requires the timing map (this rig's shared
 * `conflict.timing`, since a report's own commit order lives there) in
 * addition to `universe` and the hand-registered `ReportIndex` (a Belief
 * record itself carries no structured `sourceId`/claim-key fields -- see
 * `reportResolutionContracts.ts`'s `ReportIndex` doc).
 */
export function reportProvenanceRootOf(
  universe: readonly ReadableRecord[],
  reportIndex: ReportIndex,
  timing: BeliefTimingMap,
  sourceId: string,
  reportClaimKey: string,
): string {
  const candidates = universe
    .filter((entry): entry is Extract<ReadableRecord, { kind: 'belief' }> => entry.kind === 'belief')
    .map((entry) => {
      const index = reportIndex.get(entry.record.id)
      const timed = timing.get(entry.record.id)
      if (index === undefined || timed === undefined) return undefined
      if (index.sourceId !== sourceId || index.reportClaimKey !== reportClaimKey) return undefined
      return { id: entry.record.id, mintSeq: timed.mintSeq }
    })
    .filter((candidate): candidate is { id: string; mintSeq: number } => candidate !== undefined)
    .sort((a, b) => a.mintSeq - b.mintSeq)

  const earliest = candidates[0]
  if (earliest === undefined) {
    throw new Error(`reportProvenanceRootOf: no committed report found for (${sourceId}, ${reportClaimKey}) -- the current report must already be in universe/reportIndex/timing before calling this`)
  }

  return earliest.id
}

// ---- Claim identity vs. polarity (§3.0/§5.1 condition 3) -------------------

/**
 * `claimPolarityOf` (§5.1 condition 3): `canonicalKeyOf` excludes
 * `contestedValue` (canonicalProposition.ts) -- it identifies only the
 * shared question a claim answers. Key match alone never means
 * confirmation. This function separately inspects each claim's
 * `contestedValue` to decide confirms/refutes, and reports a key mismatch
 * distinctly so a caller never mistakes "different question" for
 * "opposite answer to the same question".
 */
export function claimPolarityOf(reportClaim: CanonicalClaim, resolvingClaim: CanonicalClaim): 'confirms' | 'refutes' | 'mismatch' {
  if (canonicalKeyOf(reportClaim) !== canonicalKeyOf(resolvingClaim)) {
    return 'mismatch'
  }
  return reportClaim.contestedValue === resolvingClaim.contestedValue ? 'confirms' : 'refutes'
}

// ---- The five-condition minting gate (D4, §5.1) ----------------------------

export interface MintReportResolutionInput {
  resolutionId: string
  holderId: string
  sourceId: string
  topicId: TopicId
  reportRef: string
  reportClaimKey: string
  reportCommitSeq: number
  resolutionRef: string
  resolutionCommitSeq: number
  resolutionClaimKey: string
  polarity: 'confirms' | 'refutes'
  resolutionCause: ReportResolutionCause
  validTime: WorldInstant
  beliefTransitionRef?: string
  universe: readonly ReadableRecord[]
  /** The committed report's own hand-registered index (D9) -- the ONLY source `reportRef`'s predicate/topic may ever be read from; there is no caller-supplied predicate field anywhere in this input. */
  reportIndex: ReportIndex
  reportProvenanceRoot: string
  existingResolutions: readonly ReportResolution[]
}

export type MintReportResolutionOutcome =
  | { verdict: 'mint'; resolution: Omit<ReportResolution, 'commitSeq'> }
  | { verdict: 'rejected'; reason: MintRejectReason }

function dedupKeyOf(reportProvenanceRoot: string, sourceId: string, reportClaimKey: string): string {
  return JSON.stringify([reportProvenanceRoot, sourceId, reportClaimKey])
}

/**
 * `mintReportResolution` (§5.1): the one pure gate function through which
 * every `ReportResolution` must pass. Conditions evaluated strictly in
 * order, each independently fault-tested (F1-F9, F14-F16): (1) the report
 * must already be a committed Belief -- a report must be resolved before
 * its trusted predicate can even be read, so this runs first, never after
 * topic validation; (2) topic identity is derived from the committed
 * report's own registered `ReportIndexEntry.claim.predicate` via `topicOf`,
 * never taken on faith from any caller-supplied predicate -- there is no
 * such field in this input at all, so it cannot be spoofed independently of
 * the report actually being resolved; an unmapped predicate or a `topicId`
 * that disagrees with the predicate's one true topic is rejected here
 * (D9, F14/F15); (3) the resolving evidence must commit AFTER the report,
 * by commit sequence alone, never valid time (D4's late-arriving-evidence
 * rule); (4) the two claims' canonical keys must match (a mismatch is a
 * no-op, never a resolution of the wrong report); (5) the resolving
 * reference must resolve, via a runtime `kind` lookup against `universe`,
 * to an `Observation` whose `observer` is `holderId` -- record ids in this
 * harness are plain, unbranded strings, so a testimony (`kind: 'belief'`)
 * id is mechanically rejected here, never structurally unconstructible at
 * the type level; (6) the dedup key must not already be consumed.
 * `resolutionId`/`resolutionCause`/`validTime`/`beliefTransitionRef` are
 * carried straight into the returned record (commitSeq is assigned by the
 * caller/store, exactly as `conflictStore.ts`'s `buildTransition` leaves
 * `commitSeq` to its own caller). `resolution.topicId` is the derived
 * `expectedTopic`, never a copy of `input.topicId` -- by the time it is
 * written the two are guaranteed equal, but deriving it keeps the record's
 * own topic traceable to the same one trusted source as the check itself.
 */
export function mintReportResolution(input: MintReportResolutionInput): MintReportResolutionOutcome {
  // Condition 1: reportRef must resolve to a committed, holder-local report.
  const reportEntry = input.universe.find((entry) => entry.record.id === input.reportRef)
  if (reportEntry === undefined || reportEntry.kind !== 'belief') {
    return { verdict: 'rejected', reason: 'report-not-committed' }
  }

  // Condition 2: topic identity is derived from the committed report's own
  // registered claim, never supplied on faith by the caller (D9). A report
  // absent from reportIndex is not a resolvable report in this rig, so it
  // is rejected identically to condition 1. An unmapped predicate or a
  // topicId that disagrees with topicOf(predicate) is rejected
  // unconditionally -- there is no fallback topic (F14/F15).
  const indexEntry = input.reportIndex.get(input.reportRef)
  if (indexEntry === undefined) {
    return { verdict: 'rejected', reason: 'report-not-committed' }
  }
  const expectedTopic = topicOf(indexEntry.claim.predicate)
  if (expectedTopic === 'unmapped') {
    return { verdict: 'rejected', reason: 'unknown-predicate-topic-mapping' }
  }
  if (expectedTopic !== input.topicId) {
    return { verdict: 'rejected', reason: 'topic-mismatch' }
  }

  // Condition 3: commit-sequence ordering only, never valid-time (F2/F3/F4).
  if (!(input.resolutionCommitSeq > input.reportCommitSeq)) {
    return { verdict: 'rejected', reason: 'resolution-not-after-report' }
  }

  // Condition 4: canonical-key match is identity only; a mismatch is a no-op (F5).
  if (input.reportClaimKey !== input.resolutionClaimKey) {
    return { verdict: 'rejected', reason: 'claim-key-mismatch' }
  }

  // Condition 5: resolutionRef must resolve, by runtime kind lookup, to the holder's own Observation (F6/F7/F8).
  const resolutionEntry = input.universe.find((entry) => entry.record.id === input.resolutionRef)
  if (resolutionEntry === undefined || resolutionEntry.kind !== 'observation' || resolutionEntry.record.observer !== input.holderId) {
    return { verdict: 'rejected', reason: 'resolution-not-holder-observation' }
  }

  // Condition 6: provenance-root dedup -- at most one contribution per (root, source, claim) (F16).
  const key = dedupKeyOf(input.reportProvenanceRoot, input.sourceId, input.reportClaimKey)
  const alreadyConsumed = input.existingResolutions.some(
    (resolution) => dedupKeyOf(resolution.reportProvenanceRoot, resolution.sourceId, resolution.reportClaimKey) === key,
  )
  if (alreadyConsumed) {
    return { verdict: 'rejected', reason: 'provenance-already-consumed' }
  }

  const resolution: Omit<ReportResolution, 'commitSeq'> = {
    schemaVersion: REPORT_RESOLUTION_SCHEMA_VERSION,
    resolutionId: input.resolutionId,
    holderId: input.holderId,
    sourceId: input.sourceId,
    topicId: expectedTopic,
    reportRef: input.reportRef,
    reportClaimKey: input.reportClaimKey,
    reportProvenanceRoot: input.reportProvenanceRoot,
    resolutionRef: input.resolutionRef,
    outcome: input.polarity === 'confirms' ? 'confirmed' : 'refuted',
    resolutionCause: input.resolutionCause,
    ruleId: 'resolve_report_from_observation',
    ruleVersion: SRT_V0,
    validTime: input.validTime,
    ...(input.beliefTransitionRef !== undefined ? { beliefTransitionRef: input.beliefTransitionRef } : {}),
  }

  return { verdict: 'mint', resolution }
}
