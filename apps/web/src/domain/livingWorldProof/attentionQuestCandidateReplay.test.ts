import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { A1_RANKING_SNAPSHOT_LSN } from './attentionQuestCandidateScenario'
import {
  canonicalAttentionTraceBytes,
  runAttentionQuestCandidateReplayPass,
  stableWorldReplayPassInput,
} from './attentionReplay'
import { digestAttentionReplayAuthoritativeLog } from './attentionReplayResources'
import {
  assertAttentionZeroModelProbeUnused,
  createAttentionZeroModelProbe,
} from './attentionZeroModelProbe'
import {
  buildAttentionReplayQuestCandidateOnlyWorld,
  buildAttentionReplayTwoQuestCandidateWorld,
} from './attentionReplayScenario'

/**
 * A5 — full-pipeline determinism, zero-model cold replay, and lifecycle
 * preservation across a complete A1 -> A2 -> A3 -> A4 replay pass.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D20 items 5 and 16: full-pipeline determinism, byte-identical cold
 *    replay with zero model calls);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§13 "Full-pipeline determinism" D1/D4);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§8 "1. ATTENTIONTRACE", "6. ZERO-MODEL REPLAY"; §9 A5 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated
 * to attention and is not the source of any rule asserted here.
 */

const NO_AUTHORITATIVE_LOG_DIGEST = digestAttentionReplayAuthoritativeLog({ commits: [] })

function runOnce() {
  const world = buildAttentionReplayQuestCandidateOnlyWorld()
  const outcome = runAttentionQuestCandidateReplayPass(
    stableWorldReplayPassInput('quest-candidate-replay-case', world, NO_AUTHORITATIVE_LOG_DIGEST),
  )
  if (outcome.kind !== 'ok') throw new Error('expected a complete replay pass')
  return outcome.result
}

describe('A5 — the complete trace is byte-identical across repeated cold runs', () => {
  it('produces byte-identical complete traces for identical declared inputs', () => {
    const runs = [0, 1, 2].map(() => canonicalAttentionTraceBytes(runOnce().trace))

    expect(new Set(runs).size).toBe(1)
  })

  it('carries an explicit schema version and a canonical, versioned identity', () => {
    const { trace } = runOnce()

    expect(trace.schemaVersion).toBe('attention-trace-schema-v1')
    expect(trace.traceIdentity.startsWith('attention-trace-schema-v1:')).toBe(true)
  })

  it('records the ranking snapshot LSN, the revalidation LSN, and the admitted candidate', () => {
    const { trace } = runOnce()

    expect(trace.rankingSnapshotLsn).toBe(A1_RANKING_SNAPSHOT_LSN)
    expect(trace.revalidationSnapshotLsn).toBe(A1_RANKING_SNAPSHOT_LSN)
    expect(trace.admittedQuestCandidateSourceIds).toEqual(['quest-p2-only'])
    expect(trace.orderedAttentionCandidates).toHaveLength(1)
    expect(trace.presentations).toHaveLength(1)
    expect(trace.presentations[0]?.resultTag).toBe('presentation-ready')
  })

  it('the player-observable subtrace is a strict projection, holding no version coordinate beyond LSNs', () => {
    const { trace } = runOnce()

    expect(Object.keys(trace.playerObservable).sort()).toEqual([
      'orderedCandidateIds',
      'presentations',
      'rankingSnapshotLsn',
      'revalidationSnapshotLsn',
      'revalidations',
    ])
  })

  it('an intermediate divergence fails determinism even if the final selection matches', () => {
    const first = runOnce().trace
    const second = runOnce().trace

    // The two runs really are separately computed values, not the same object.
    expect(first).not.toBe(second)
    expect(canonicalSerialize(first)).toBe(canonicalSerialize(second))
  })

  it('records an empty ordering trace when fewer than two candidates were ordered', () => {
    const { trace } = runOnce()

    expect(trace.orderedAttentionCandidates).toHaveLength(1)
    expect(trace.orderingTrace).toEqual([])
  })
})

/**
 * Correction round — real order/tie-break trace evidence. Every other A5
 * world admits at most one candidate, which cannot exercise
 * `attentionCandidateOrdering.ts`'s comparator at all; this uses
 * `buildAttentionReplayTwoQuestCandidateWorld` (two independently admitted
 * public-open candidates, differing first at `source-id`) so the deciding
 * key and the two runs' order are non-vacuous.
 */
function runTwoCandidateOnce(order: 'authored' | 'reversed') {
  const world = buildAttentionReplayTwoQuestCandidateWorld(order)
  const outcome = runAttentionQuestCandidateReplayPass(
    stableWorldReplayPassInput(`two-candidate-${order}`, world, NO_AUTHORITATIVE_LOG_DIGEST),
  )
  if (outcome.kind !== 'ok') throw new Error('expected a complete replay pass')
  return outcome.result
}

describe('A5 — order/tie-break trace over two independently admitted candidates', () => {
  it('records exactly one adjacent-pair comparison with a non-vacuous deciding key', () => {
    const { trace } = runTwoCandidateOnce('authored')

    expect(trace.orderedAttentionCandidates).toHaveLength(2)
    expect(trace.orderingTrace).toHaveLength(1)
    const [entry] = trace.orderingTrace

    // source-kind ties (Stage A has exactly one kind), so source-id -- the
    // candidates' only other difference -- is the real decider, not a
    // trivial or default value.
    expect(entry?.decidingKey).toBe('source-id')
    expect(entry?.evaluatedKeys).toEqual(['source-kind', 'source-id'])
    expect(entry?.leftValue).not.toBe(entry?.rightValue)
    expect(entry?.result).toBe('left-first')
    expect(entry?.leftCandidateId).not.toBe(entry?.rightCandidateId)
  })

  it('the ordered candidate IDs and the tie-break path are byte-identical regardless of snapshot insertion order', () => {
    const authored = runTwoCandidateOnce('authored')
    const reversed = runTwoCandidateOnce('reversed')

    expect(authored.trace.orderedAttentionCandidates.map((entry) => entry.candidateId))
      .toEqual(reversed.trace.orderedAttentionCandidates.map((entry) => entry.candidateId))
    expect(canonicalSerialize(authored.trace.orderingTrace)).toBe(canonicalSerialize(reversed.trace.orderingTrace))
    expect(canonicalSerialize(authored.trace.playerObservable)).toBe(canonicalSerialize(reversed.trace.playerObservable))
  })
})

describe('A5 — zero-model cold replay', () => {
  it('completes the whole A1-A5 path with the zero-model probe still at zero', () => {
    const probe = createAttentionZeroModelProbe()

    const { trace } = runOnce()

    expect(trace.presentations).toHaveLength(1)
    expect(probe.invocationCount()).toBe(0)
    expect(() => assertAttentionZeroModelProbeUnused(probe)).not.toThrow()
  })

  it('fails loudly if a model/provider call is attempted, even if the caller swallows it', () => {
    const probe = createAttentionZeroModelProbe()

    try {
      probe.invoke('a-hypothetical-generative-seam')
    } catch {
      // Deliberately ignored: a swallowed call still leaves a non-zero count.
    }

    expect(() => assertAttentionZeroModelProbeUnused(probe)).toThrow(/zero generative calls/)
  })

  it('remains deterministic under repeated cold runs with a fresh probe each time', () => {
    const traces = [0, 1, 2].map(() => {
      const probe = createAttentionZeroModelProbe()
      const { trace } = runOnce()
      assertAttentionZeroModelProbeUnused(probe)
      return canonicalAttentionTraceBytes(trace)
    })

    expect(new Set(traces).size).toBe(1)
  })
})

describe('A5 — lifecycle preservation across a complete replay pass', () => {
  /**
   * Correction round: this no longer asserts
   * `authoritativeLogDigestBefore === authoritativeLogDigestAfter` against
   * each other. `stableWorldReplayPassInput` (the only caller this file
   * uses) passes the identical caller-supplied digest string into both
   * fields, so a before/after comparison here could never fail regardless
   * of what the pipeline actually did -- it is not independent evidence of
   * authoritative noninterference. What this test still proves, honestly:
   * `buildAttentionTrace` records exactly the two digest strings its caller
   * supplied, each checked against `NO_AUTHORITATIVE_LOG_DIGEST` (a value
   * computed independently, by `digestAttentionReplayAuthoritativeLog`, not
   * copied from the trace). The load-bearing authoritative-noninterference
   * proof is P2 in `attentionP2Noninterference.test.ts`, which compares two
   * independently-computed authoritative digests (director-off vs
   * director-on, each folded from its own `AttentionReplayAuthoritativeResources`)
   * and is not satisfiable by construction the way this one was.
   */
  it('records the caller-supplied authoritative-log digests into the trace verbatim', () => {
    const { trace } = runOnce()

    expect(trace.authoritativeLogDigestBefore).toBe(NO_AUTHORITATIVE_LOG_DIGEST)
    expect(trace.authoritativeLogDigestAfter).toBe(NO_AUTHORITATIVE_LOG_DIGEST)
  })

  it('leaves the underlying QuestCandidate snapshot byte-identical', () => {
    const world = buildAttentionReplayQuestCandidateOnlyWorld()
    const before = canonicalSerialize(world.snapshot)

    runAttentionQuestCandidateReplayPass(stableWorldReplayPassInput('lifecycle-case', world, NO_AUTHORITATIVE_LOG_DIGEST))

    expect(canonicalSerialize(world.snapshot)).toBe(before)
    expect(world.snapshot.candidates.map((candidate) => candidate.status)).toEqual(['open'])
  })
})
