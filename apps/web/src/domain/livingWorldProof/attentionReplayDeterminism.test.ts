import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { runAttentionDirectorOnPass, stableWorldReplayPassInput } from './attentionReplay'
import { createAttentionReplayAuthoritativeResources, digestAttentionReplayAuthoritativeLog } from './attentionReplayResources'
import {
  A5_AUTHORITATIVE_COMMAND_IDS,
  A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
  A5_RNG_SEED,
  buildAttentionReplayQuestCandidateOnlyWorld,
} from './attentionReplayScenario'
import { buildAttentionQuestCandidateHiddenPairScenario } from './attentionQuestCandidateScenario'

/**
 * A5 — determinism under timing and scheduling perturbation, independent of
 * the P2 authoritative-log comparison (which `attentionP2Noninterference
 * .test.ts` already covers). This file asserts the attention trace itself —
 * not only the authoritative log — is unaffected by execution order.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D19 P2: "no authoritative value may depend on attention execution
 *    latency, completion order, or process scheduling"; D20 item 5);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§13 "Full-pipeline determinism"; §4 "forbidden input dependencies");
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§8 "2. REPLAY HARNESS" — deterministic director-off/on runs; §9 A5
 *    slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated
 * to attention and is not the source of any rule asserted here.
 */

const NO_AUTHORITATIVE_LOG_DIGEST = digestAttentionReplayAuthoritativeLog({ commits: [] })

describe('A5 — the attention trace is unaffected by execution order relative to the authoritative pass', () => {
  it('running attention before vs after the authoritative commits yields a byte-identical trace', () => {
    const world = buildAttentionReplayQuestCandidateOnlyWorld()

    const attentionFirst = runAttentionDirectorOnPass({
      replayPassInput: stableWorldReplayPassInput('determinism-attention-first', world, NO_AUTHORITATIVE_LOG_DIGEST),
      initialAuthoritativeResources: createAttentionReplayAuthoritativeResources(A5_RNG_SEED),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      runAttentionFirst: true,
    })
    const authoritativeFirst = runAttentionDirectorOnPass({
      replayPassInput: stableWorldReplayPassInput('determinism-authoritative-first', world, NO_AUTHORITATIVE_LOG_DIGEST),
      initialAuthoritativeResources: createAttentionReplayAuthoritativeResources(A5_RNG_SEED),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      runAttentionFirst: false,
    })

    expect(attentionFirst.attention.kind).toBe('ok')
    expect(authoritativeFirst.attention.kind).toBe('ok')
    if (attentionFirst.attention.kind !== 'ok' || authoritativeFirst.attention.kind !== 'ok') throw new Error('unreachable')

    // playerObservable is compared directly: replayCaseId differs by design between the two calls above.
    expect(attentionFirst.attention.result.trace.playerObservable)
      .toEqual(authoritativeFirst.attention.result.trace.playerObservable)
  })

  it('repeated director-on runs, alternating order each time, remain byte-identical for the attention trace', () => {
    const world = buildAttentionReplayQuestCandidateOnlyWorld()

    const traces = [true, false, true, false].map((runAttentionFirst, index) => {
      const result = runAttentionDirectorOnPass({
        replayPassInput: stableWorldReplayPassInput(`determinism-alternating-${index}`, world, NO_AUTHORITATIVE_LOG_DIGEST),
        initialAuthoritativeResources: createAttentionReplayAuthoritativeResources(A5_RNG_SEED),
        commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
        wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
        runAttentionFirst,
      })
      if (result.attention.kind !== 'ok') throw new Error('expected a complete replay pass')
      return canonicalSerialize(result.attention.result.trace.playerObservable)
    })

    expect(new Set(traces).size).toBe(1)
  })

  it('holds for the hidden-candidate world too: order never changes the observable trace', () => {
    const { worldA } = buildAttentionQuestCandidateHiddenPairScenario()

    const first = runAttentionDirectorOnPass({
      replayPassInput: stableWorldReplayPassInput('determinism-hidden-first', worldA, NO_AUTHORITATIVE_LOG_DIGEST),
      initialAuthoritativeResources: createAttentionReplayAuthoritativeResources(A5_RNG_SEED),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      runAttentionFirst: true,
    })
    const second = runAttentionDirectorOnPass({
      replayPassInput: stableWorldReplayPassInput('determinism-hidden-second', worldA, NO_AUTHORITATIVE_LOG_DIGEST),
      initialAuthoritativeResources: createAttentionReplayAuthoritativeResources(A5_RNG_SEED),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      runAttentionFirst: false,
    })

    expect(first.attention.kind).toBe('ok')
    expect(second.attention.kind).toBe('ok')
    if (first.attention.kind !== 'ok' || second.attention.kind !== 'ok') throw new Error('unreachable')
    expect(first.attention.result.trace.playerObservable).toEqual(second.attention.result.trace.playerObservable)
  })
})
