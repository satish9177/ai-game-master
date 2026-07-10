import { applyEvidenceCorrection } from './beliefUpdate'
import { canonicalHash, canonicalSerialize } from './canonicalSerialization'
import { detectConflict, sortClaimPair } from './canonicalProposition'
import { currentBeliefs } from './beliefProjection'
import type { BeliefTimingMap, BeliefTransition, ClaimRegistry, ConflictCommit, QueryBounds } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION, TRANSITION_RULE_VERSION } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import { initConflictStore } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'

/**
 * Deterministic replay (ADR-0008 D7, spec conflict-edge-replay-v0.md §1.9).
 * Replay never calls mintEdge/proposeEdge/commitBelief/commitRevision/
 * commitTransition -- the normal allocator is structurally unreachable
 * here. For every recorded commit it mechanically validates the record,
 * then materializes it exactly: recorded id, commitSeq, versions, pairKey,
 * and proposal/adjudication key are all preserved byte-for-byte. Current
 * deterministic rule code is rerun only as a verification oracle whose
 * result is report-only -- it never authors or replaces a historical
 * record. No LLM, no I/O, no fresh identity is ever minted.
 */

/**
 * Any proposer/judge invocation during replay is forbidden (Corollary 6).
 * `calls` is asserted zero after every replay (P8); a direct call is a
 * hard failure by construction (F6) -- there is no code path in
 * `replayConflictLog` that ever reaches this method.
 */
export class JudgeProbe {
  calls = 0

  call(): never {
    this.calls += 1
    throw new Error('JudgeProbe: a proposer/judge was invoked during replay -- forbidden (ADR-0008 D7, Corollary 6)')
  }
}

export interface ReplayReport {
  judgeCalls: number
  verifiedEdges: readonly string[]
  verifiedTransitions: readonly string[]
  canonicalizerVersionMismatches: readonly string[]
  ruleVersionMismatches: readonly string[]
}

function outgoingOf(transitions: readonly BeliefTransition[], beliefId: string): BeliefTransition | undefined {
  return transitions.find((transition) => transition.fromBeliefId === beliefId)
}

function reaches(transitions: readonly BeliefTransition[], startBeliefId: string, targetBeliefId: string): boolean {
  let current: string | undefined = startBeliefId
  const seen = new Set<string>()
  while (current !== undefined) {
    if (current === targetBeliefId) return true
    if (seen.has(current)) return false
    seen.add(current)
    current = outgoingOf(transitions, current)?.toBeliefId
  }
  return false
}

function edgeNumericSuffix(edgeId: string): number {
  return Number(/CE_(\d+)/.exec(edgeId)?.[1] ?? '0')
}

/**
 * Verification oracle for a recorded transition: reruns the current
 * deterministic rule and byte-compares against the recorded outcome. Never
 * authors or edits the historical record -- its result only lands in the
 * report. Not applicable when the rule isn't `corrected-by-evidence`
 * (v0's only concretely re-runnable rule).
 */
function verifyTransitionOracle(universe: readonly ReadableRecord[], transition: BeliefTransition): 'match' | 'mismatch' | 'not-applicable' {
  if (transition.cause !== 'corrected-by-evidence' || transition.inputEvidenceIds.length !== 1) {
    return 'not-applicable'
  }
  const fromEntry = universe.find((entry) => entry.record.id === transition.fromBeliefId)
  const evidenceEntry = universe.find((entry) => entry.record.id === transition.inputEvidenceIds[0])
  const toEntry = universe.find((entry) => entry.record.id === transition.toBeliefId)
  if (fromEntry?.kind !== 'belief' || evidenceEntry?.kind !== 'evidence' || toEntry?.kind !== 'belief') {
    return 'not-applicable'
  }

  const outcome = applyEvidenceCorrection(fromEntry.record, evidenceEntry.record, transition.toBeliefId)
  if (outcome.status !== 'corrected') {
    return 'mismatch'
  }
  return canonicalHash(outcome.corrected) === canonicalHash(toEntry.record) ? 'match' : 'mismatch'
}

/**
 * Replays a recorded commit stream onto a fresh store, materializing every
 * edge and transition exactly as committed (§1.9/P7). Two replays -- or a
 * replay against original commit -- produce byte-identical stores. Any
 * recorded-invariant violation (a corrupted or tampered log) is a hard
 * failure, never a partial/best-effort replay.
 */
export function replayConflictLog(
  universe: readonly ReadableRecord[],
  claims: ClaimRegistry,
  commits: readonly ConflictCommit[],
  judge: JudgeProbe,
): { store: ConflictStore; report: ReplayReport } {
  let store = initConflictStore(claims)
  let maxSeq = 0
  let maxEdgeSeq = 0
  const verifiedEdges: string[] = []
  const verifiedTransitions: string[] = []
  const canonicalizerVersionMismatches: string[] = []
  const ruleVersionMismatches: string[] = []

  for (const commit of commits) {
    if (commit.kind === 'belief') {
      if (store.timing.has(commit.beliefId)) {
        throw new Error(`replayConflictLog: recorded-invariant-violation -- duplicate belief commit for ${commit.beliefId}`)
      }
      const timing = new Map(store.timing)
      timing.set(commit.beliefId, { validFrom: commit.validFrom, mintSeq: commit.mintSeq })
      store = { ...store, timing, commitLog: [...store.commitLog, commit] }
      maxSeq = Math.max(maxSeq, commit.mintSeq)
      continue
    }

    if (commit.kind === 'edge') {
      const edge = commit.edge
      if (store.edges.some((existing) => existing.edgeId === edge.edgeId || existing.pairKey === edge.pairKey)) {
        throw new Error(`replayConflictLog: recorded-invariant-violation -- duplicate edge ${edge.edgeId}`)
      }

      if (edge.canonicalizerVersion === CONFLICT_CANONICALIZER_VERSION) {
        const claimFirst = claims.get(edge.endpoints[0].witnessRecordId)
        const claimSecond = claims.get(edge.endpoints[1].witnessRecordId)
        if (claimFirst === undefined || claimSecond === undefined) {
          throw new Error(`replayConflictLog: recorded-invariant-violation -- unresolved endpoint witness for ${edge.edgeId}`)
        }
        const sorted = sortClaimPair(claimFirst, claimSecond)
        const detection = detectConflict(claimFirst, claimSecond)
        const overlapMatches = detection.verdict === 'conflict' && canonicalSerialize(detection.overlapWitness) === canonicalSerialize(edge.overlapWitness)
        if (sorted.pairKey !== edge.pairKey || detection.verdict !== 'conflict' || !overlapMatches) {
          throw new Error(`replayConflictLog: recorded-invariant-violation -- edge ${edge.edgeId} does not reconstruct from its recorded endpoints`)
        }
        verifiedEdges.push(edge.edgeId)
      } else {
        canonicalizerVersionMismatches.push(edge.edgeId)
      }

      store = { ...store, edges: [...store.edges, edge], commitLog: [...store.commitLog, commit] }
      maxSeq = Math.max(maxSeq, edge.commitSeq)
      maxEdgeSeq = Math.max(maxEdgeSeq, edgeNumericSuffix(edge.edgeId))
      continue
    }

    // 'revision' | 'transition'
    const transition = commit.transition

    if (transition.fromBeliefId === transition.toBeliefId) {
      throw new Error(`replayConflictLog: recorded-invariant-violation -- self-transition ${transition.transitionId}`)
    }
    if (store.transitions.some((existing) => existing.transitionId === transition.transitionId)) {
      throw new Error(`replayConflictLog: recorded-invariant-violation -- duplicate transitionId ${transition.transitionId}`)
    }
    if (outgoingOf(store.transitions, transition.fromBeliefId) !== undefined) {
      throw new Error(`replayConflictLog: recorded-invariant-violation -- branching from ${transition.fromBeliefId}`)
    }
    if (reaches(store.transitions, transition.toBeliefId, transition.fromBeliefId)) {
      throw new Error(`replayConflictLog: recorded-invariant-violation -- cycle via ${transition.transitionId}`)
    }

    if (transition.ruleVersion === TRANSITION_RULE_VERSION) {
      const verdict = verifyTransitionOracle(universe, transition)
      if (verdict === 'mismatch') {
        throw new Error(`replayConflictLog: recorded-invariant-violation -- oracle mismatch for ${transition.transitionId}`)
      }
      if (verdict === 'match') {
        verifiedTransitions.push(transition.transitionId)
      }
    } else {
      ruleVersionMismatches.push(transition.transitionId)
    }

    let timing: BeliefTimingMap = store.timing
    if (commit.kind === 'revision') {
      if (store.timing.has(commit.toBeliefId)) {
        throw new Error(`replayConflictLog: recorded-invariant-violation -- destination ${commit.toBeliefId} already timed`)
      }
      const mutableTiming = new Map(store.timing)
      mutableTiming.set(commit.toBeliefId, { validFrom: commit.validFrom, mintSeq: transition.commitSeq })
      timing = mutableTiming
    }

    store = {
      ...store,
      timing,
      transitions: [...store.transitions, transition],
      commitLog: [...store.commitLog, commit],
    }
    maxSeq = Math.max(maxSeq, transition.commitSeq)
  }

  store = { ...store, nextSeq: maxSeq + 1, nextEdgeSeq: maxEdgeSeq + 1 }

  return {
    store,
    report: {
      judgeCalls: judge.calls,
      verifiedEdges,
      verifiedTransitions,
      canonicalizerVersionMismatches,
      ruleVersionMismatches,
    },
  }
}

/**
 * A deterministic, canonically-serialized snapshot of every holder's
 * projection across a fixed bounds grid, plus the full edge/transition/
 * proposal/commit log -- two replays' snapshots (or replay vs. original)
 * must be byte-equal (P7).
 */
export function captureConflictSnapshot(universe: readonly ReadableRecord[], store: ConflictStore, boundsGrid: readonly QueryBounds[]): string {
  const holders = [
    ...new Set(
      universe
        .filter((entry): entry is Extract<ReadableRecord, { kind: 'belief' }> => entry.kind === 'belief')
        .map((entry) => entry.record.holder),
    ),
  ].sort()

  const projections = boundsGrid.map((bounds) => ({
    bounds,
    perHolder: Object.fromEntries(holders.map((holder) => [holder, currentBeliefs(holder, universe, store, bounds)])),
  }))

  return canonicalSerialize({
    edges: store.edges,
    transitions: store.transitions,
    proposalLog: store.proposalLog,
    commitLog: store.commitLog,
    timing: [...store.timing.entries()].sort(([a], [b]) => a.localeCompare(b)),
    projections,
  })
}
