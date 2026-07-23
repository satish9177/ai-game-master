import { describe, expect, it } from 'vitest'
import { ATTENTION_RANKING_SNAPSHOT_LSN_MAX, ATTENTION_RANKING_SNAPSHOT_LSN_MIN } from './attentionCandidatePolicy'
import { runAttentionQuestCandidateReplayPass, stableWorldReplayPassInput } from './attentionReplay'
import { digestAttentionReplayAuthoritativeLog } from './attentionReplayResources'
import { buildAttentionReplayLsnBoundaryWorlds } from './attentionReplayScenario'

/**
 * A5 — Stage A limits and deterministic refusal fixtures, exercised through
 * the complete replay pipeline (not in isolation, which A3's own
 * `attentionCandidate.test.ts`/`attentionCandidateCacheKey.test.ts` already
 * cover for the bare identity/cache-key functions).
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D13 "arithmetic cannot overflow within those ranges"; D16 resource
 *    bounds -- deferred beyond the one pinned coordinate this slice owns);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§21 "Resource-bound fixtures" -- the boundary-oracle discipline this
 *    file applies to the one bound Stage A actually pins);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§6.1(1) "the only presently pinned bounded integer is the ranking
 *    snapshot coordinate"; §8 "5. CACHE, REVALIDATION AND LIMIT EVIDENCE" --
 *    "exact Stage A limits or refusal cases pinned by the plan... Do not
 *    invent policy values that remain explicitly deferred"; §9 A5 slice
 *    plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated
 * to attention and is not the source of any rule asserted here.
 *
 * **No candidate cap, template-assertion cap, or window-density limit is
 * exercised here** -- plan §6.1(3) leaves every one of those unpinned and
 * deferred, and A3's own header is explicit that inventing a numeric default
 * for any of them is exactly the failure mode this rig refuses to commit.
 * The only bounded integer this slice tests is `rankingSnapshotLsn`.
 */

const NO_AUTHORITATIVE_LOG_DIGEST = digestAttentionReplayAuthoritativeLog({ commits: [] })

describe('A5 — rankingSnapshotLsn boundary, exercised end-to-end through the complete replay pipeline', () => {
  it('exactly at the minimum (0): admitted, presented, no refusal', () => {
    const { worldAtMin } = buildAttentionReplayLsnBoundaryWorlds()

    const outcome = runAttentionQuestCandidateReplayPass(
      stableWorldReplayPassInput('resource-limit-at-min', worldAtMin, NO_AUTHORITATIVE_LOG_DIGEST),
    )

    expect(worldAtMin.request.rankingSnapshotLsn).toBe(ATTENTION_RANKING_SNAPSHOT_LSN_MIN)
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') throw new Error('unreachable')
    expect(outcome.result.trace.presentations).toHaveLength(1)
  })

  it('exactly at the maximum (Number.MAX_SAFE_INTEGER): admitted, presented, no refusal', () => {
    const { worldAtMax } = buildAttentionReplayLsnBoundaryWorlds()

    const outcome = runAttentionQuestCandidateReplayPass(
      stableWorldReplayPassInput('resource-limit-at-max', worldAtMax, NO_AUTHORITATIVE_LOG_DIGEST),
    )

    expect(worldAtMax.request.rankingSnapshotLsn).toBe(ATTENTION_RANKING_SNAPSHOT_LSN_MAX)
    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') throw new Error('unreachable')
    expect(outcome.result.trace.presentations).toHaveLength(1)
    expect(outcome.result.trace.rankingSnapshotLsn).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('one past the maximum: A1/A2 admit the coordinate (it is still a non-negative integer), A3 normalization refuses with a typed, engine-side reason -- never an unbounded fallback', () => {
    const { worldOverMax } = buildAttentionReplayLsnBoundaryWorlds()

    const outcome = runAttentionQuestCandidateReplayPass(
      stableWorldReplayPassInput('resource-limit-over-max', worldOverMax, NO_AUTHORITATIVE_LOG_DIGEST),
    )

    expect(worldOverMax.request.rankingSnapshotLsn).toBe(ATTENTION_RANKING_SNAPSHOT_LSN_MAX + 1)
    expect(outcome.kind).toBe('refused')
    if (outcome.kind !== 'refused') throw new Error('unreachable')
    expect(outcome.refusal).toEqual({ stage: 'normalization', reason: 'ranking-snapshot-lsn-out-of-range' })
  })

  it('a negative request coordinate refuses at the A1 accessor stage, before normalization is ever reached', () => {
    const { worldNegativeRequest } = buildAttentionReplayLsnBoundaryWorlds()

    const outcome = runAttentionQuestCandidateReplayPass(
      stableWorldReplayPassInput('resource-limit-negative', worldNegativeRequest, NO_AUTHORITATIVE_LOG_DIGEST),
    )

    expect(worldNegativeRequest.request.rankingSnapshotLsn).toBe(-1)
    expect(outcome.kind).toBe('refused')
    if (outcome.kind !== 'refused') throw new Error('unreachable')
    expect(outcome.refusal.stage).toBe('accessor')
  })

  it('every boundary refusal is deterministic across repeated cold runs', () => {
    const { worldOverMax, worldNegativeRequest } = buildAttentionReplayLsnBoundaryWorlds()

    const overMaxRuns = [0, 1].map(() => (
      runAttentionQuestCandidateReplayPass(
        stableWorldReplayPassInput('resource-limit-over-max-repeat', worldOverMax, NO_AUTHORITATIVE_LOG_DIGEST),
      )
    ))
    const negativeRuns = [0, 1].map(() => (
      runAttentionQuestCandidateReplayPass(
        stableWorldReplayPassInput('resource-limit-negative-repeat', worldNegativeRequest, NO_AUTHORITATIVE_LOG_DIGEST),
      )
    ))

    expect(overMaxRuns[0]).toEqual(overMaxRuns[1])
    expect(negativeRuns[0]).toEqual(negativeRuns[1])
  })

  it('a refusal at any stage leaves the underlying QuestCandidate snapshot completely untouched', () => {
    const { worldOverMax } = buildAttentionReplayLsnBoundaryWorlds()
    const before = JSON.stringify(worldOverMax.snapshot)

    runAttentionQuestCandidateReplayPass(
      stableWorldReplayPassInput('resource-limit-untouched', worldOverMax, NO_AUTHORITATIVE_LOG_DIGEST),
    )

    expect(JSON.stringify(worldOverMax.snapshot)).toBe(before)
  })
})
