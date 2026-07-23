import { describe, expect, it } from 'vitest'
import {
  runAttentionDirectorOffPass,
  runAttentionDirectorOnPass,
  stableWorldReplayPassInput,
} from './attentionReplay'
import {
  createAttentionReplayAuthoritativeResources,
  createAttentionReplayReducerCache,
  digestAttentionReplayAuthoritativeLog,
  leakAttentionExecutionIntoSharedIdAllocator,
  leakAttentionExecutionIntoSharedReducerCache,
  leakAttentionExecutionIntoSharedRng,
  leakAttentionExecutionIntoSharedScheduler,
  leakAttentionExecutionIntoWallClockDerivedAuthoritativeValue,
} from './attentionReplayResources'
import {
  A5_AUTHORITATIVE_COMMAND_IDS,
  A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
  A5_RNG_SEED,
  buildAttentionReplayQuestCandidateOnlyWorld,
} from './attentionReplayScenario'
import { buildAttentionQuestCandidateHiddenPairScenario } from './attentionQuestCandidateScenario'

/**
 * A5 — P2: fixed-input world noninterference.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D19 P2: byte-identical authoritative committed logs under fixed inputs,
 *    no "identical except" oracle, required resource isolation);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§9 "P2 — fixed-input world noninterference", P2-1...P2-4 and the
 *    P2-N1...P2-N3 negative controls);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§8 "3. P2 — AUTHORITATIVE NONINTERFERENCE": the five named negative
 *    controls and the three positive controls; §9 A5 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated
 * to attention and is not the source of any rule asserted here.
 *
 * **Why the negative controls use `leakAttentionExecutionIntoShared*`.**
 * Stage A's real attention pipeline structurally cannot touch any
 * authoritative RNG/ID/scheduler/cache/wall-clock value — the whole-tree
 * static evidence in `attentionLedgerStaticClosure.test.ts` already proves
 * it. A negative control that could never fire would prove nothing about
 * whether the P2 oracle actually detects contamination, so each control here
 * deliberately reproduces the forbidden coupling via
 * `attentionReplayResources.ts`'s clearly-labelled helpers and shows the
 * byte-identity oracle catches it, exactly as the sibling replay suites'
 * `F`-injection negative controls do for their own properties.
 */

function freshAuthoritativeResources() {
  return createAttentionReplayAuthoritativeResources(A5_RNG_SEED)
}

const NO_AUTHORITATIVE_LOG_DIGEST = digestAttentionReplayAuthoritativeLog({ commits: [] })

function replayPassInput(caseId: string) {
  const world = buildAttentionReplayQuestCandidateOnlyWorld()
  return stableWorldReplayPassInput(caseId, world, NO_AUTHORITATIVE_LOG_DIGEST)
}

describe('A5 / P2-1 — quest-candidate-only load: director-off vs director-on authoritative logs are byte-identical', () => {
  it('produces byte-identical authoritative logs whether or not attention runs', () => {
    const off = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const on = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-1-director-on'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    })

    expect(on.attention.kind).toBe('ok')
    expect(on.authoritativeDigest).toBe(off.digest)
    expect(on.authoritativeResources.log).toEqual(off.resources.log)
  })

  it('the director-on authoritative log never contains an event the director-off log lacks (no "identical except" oracle)', () => {
    const off = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const on = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-1-full-comparison'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    })

    expect(on.authoritativeResources.log.commits.length).toBe(off.resources.log.commits.length)
    expect(on.authoritativeResources.log.commits).toEqual(off.resources.log.commits)
  })
})

describe('A5 / P2-2 — a hidden/open paired quest-candidate load also yields byte-identical authoritative logs', () => {
  it('director-off vs director-on over the hidden-candidate world matches', () => {
    const { worldA } = buildAttentionQuestCandidateHiddenPairScenario()

    const off = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const on = runAttentionDirectorOnPass({
      replayPassInput: stableWorldReplayPassInput('p2-2-hidden-world', worldA, NO_AUTHORITATIVE_LOG_DIGEST),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    })

    expect(on.attention.kind).toBe('ok')
    expect(on.authoritativeDigest).toBe(off.digest)
  })
})

describe('A5 / P2-3 — attention may observe an already-committed ordinary input but originates no authoritative event of its own', () => {
  it('one prior authoritative commit, then attention runs: the authoritative log matches a director-off run over the same one commit', () => {
    const off = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      [A5_AUTHORITATIVE_COMMAND_IDS[0]!],
      [A5_AUTHORITATIVE_WALL_CLOCK_INPUTS[0]!],
    )
    const on = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-3-observed-commit'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: [A5_AUTHORITATIVE_COMMAND_IDS[0]!],
      wallClockInputs: [A5_AUTHORITATIVE_WALL_CLOCK_INPUTS[0]!],
      runAttentionFirst: false,
    })

    expect(on.attention.kind).toBe('ok')
    expect(on.authoritativeDigest).toBe(off.digest)
  })
})

describe('A5 / P2-4 — attention-execution-timing perturbation leaves the authoritative log byte-identical', () => {
  it('running attention before vs after the authoritative commits produces the same authoritative log', () => {
    const attentionFirst = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-4-attention-first'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      runAttentionFirst: true,
    })
    const authoritativeFirst = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-4-authoritative-first'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      runAttentionFirst: false,
    })

    expect(attentionFirst.attention.kind).toBe('ok')
    expect(authoritativeFirst.attention.kind).toBe('ok')
    expect(attentionFirst.authoritativeDigest).toBe(authoritativeFirst.authoritativeDigest)
  })
})

describe('A5 / P2 positive controls', () => {
  it('(a) an isolated (pre-warmed) authoritative reducer cache cannot be affected by whether attention ran', () => {
    const warmCache = createAttentionReplayReducerCache({ 'pre-existing-key': 'pre-existing-value' })

    const off = runAttentionDirectorOffPass(
      { ...freshAuthoritativeResources(), cache: warmCache },
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const on = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-positive-isolated-cache'),
      initialAuthoritativeResources: { ...freshAuthoritativeResources(), cache: warmCache },
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    })

    expect(on.authoritativeDigest).toBe(off.digest)
  })

  it('(b) perturbing the injected wall-clock input changes the authoritative log the same way with or without attention (never a real clock)', () => {
    const perturbedWallClockInputs = A5_AUTHORITATIVE_WALL_CLOCK_INPUTS.map((value) => value + 500)

    const offBaseline = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const offPerturbed = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      perturbedWallClockInputs,
    )
    const onPerturbed = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-positive-wall-clock'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: perturbedWallClockInputs,
    })

    // The perturbation is a legitimate authoritative input, so it changes the
    // log versus the baseline -- but identically whether or not attention ran.
    expect(offPerturbed.digest).not.toBe(offBaseline.digest)
    expect(onPerturbed.authoritativeDigest).toBe(offPerturbed.digest)
  })

  it('(c) cold and warm attention runs yield equivalent authoritative logs and canonical traces', () => {
    const off = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const cold = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-positive-cold-warm'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    })
    const warm = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-positive-cold-warm'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    })

    expect(cold.authoritativeDigest).toBe(off.digest)
    expect(warm.authoritativeDigest).toBe(off.digest)
    expect(cold.attention.kind).toBe('ok')
    expect(warm.attention.kind).toBe('ok')
    if (cold.attention.kind === 'ok' && warm.attention.kind === 'ok') {
      expect(cold.attention.result.trace).toEqual(warm.attention.result.trace)
    }
  })
})

describe('A5 / P2 negative controls — each intentionally violates one isolation rule and must fail for exactly that reason', () => {
  it('P2-N1 — a shared authoritative RNG stream causes the authoritative log to diverge', () => {
    const baseline = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const coupled = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-n1-shared-rng'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      coupling: (resources) => ({ ...resources, rng: leakAttentionExecutionIntoSharedRng(resources.rng) }),
    })

    expect(coupled.authoritativeDigest).not.toBe(baseline.digest)

    // Restoration: a fresh, uncoupled resource set from the same seed reproduces the baseline exactly.
    const restored = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    expect(restored.digest).toBe(baseline.digest)
  })

  it('P2-N2 — a shared authoritative ID/sequence allocator causes the authoritative log to diverge', () => {
    const baseline = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const coupled = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-n2-shared-id-allocator'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      coupling: (resources) => ({
        ...resources,
        idAllocator: leakAttentionExecutionIntoSharedIdAllocator(resources.idAllocator),
      }),
    })

    expect(coupled.authoritativeDigest).not.toBe(baseline.digest)
    expect(coupled.authoritativeResources.log.commits[0]?.allocatedId)
      .not.toBe(baseline.resources.log.commits[0]?.allocatedId)
  })

  it('P2-N3 — a shared authoritative scheduler resource causes the authoritative log to diverge', () => {
    const baseline = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const coupled = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-n3-shared-scheduler'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      coupling: (resources) => ({
        ...resources,
        scheduler: leakAttentionExecutionIntoSharedScheduler(resources.scheduler),
      }),
    })

    expect(coupled.authoritativeDigest).not.toBe(baseline.digest)
    expect(coupled.authoritativeResources.log.commits[0]?.schedulerToken)
      .not.toBe(baseline.resources.log.commits[0]?.schedulerToken)
  })

  it('P2-N4 — a shared mutable authoritative reducer cache causes the authoritative log to diverge', () => {
    const baseline = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const coupled = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-n4-shared-cache'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      coupling: (resources) => ({
        ...resources,
        cache: leakAttentionExecutionIntoSharedReducerCache(resources.cache),
      }),
    })

    expect(coupled.authoritativeDigest).not.toBe(baseline.digest)
    expect(coupled.authoritativeResources.log.commits[0]?.reducerCacheDigestAtCommit)
      .not.toBe(baseline.resources.log.commits[0]?.reducerCacheDigestAtCommit)
  })

  it('P2-N5 — attention execution contaminating a shared authoritative wall-clock-derived value causes the authoritative log to diverge', () => {
    // Both runs begin with byte-identical authoritative configuration,
    // including the identical injected wall-clock array -- the fault under
    // test is exclusively that attention's presence has already written a
    // value into a *shared* authoritative wall-clock-derived slot before the
    // authoritative commit reads it, never a difference in what was
    // configured for the two runs.
    const baseline = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    const coupled = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-n5-wall-clock-contamination'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      // Director-off never receives this coupling -- it cannot trigger the
      // contamination, exactly as attention's real (isolated) path
      // structurally cannot.
      coupling: (resources) => ({
        ...resources,
        wallClockAuthorityOverride: leakAttentionExecutionIntoWallClockDerivedAuthoritativeValue(
          A5_AUTHORITATIVE_WALL_CLOCK_INPUTS[0]!,
        ),
      }),
    })

    expect(coupled.authoritativeDigest).not.toBe(baseline.digest)
    // Names the intended failure explicitly: the wall-clock-derived field
    // recorded at commit time is what diverged, not some other resource.
    expect(coupled.authoritativeResources.log.commits[0]?.wallClockInputAtCommit)
      .not.toBe(baseline.resources.log.commits[0]?.wallClockInputAtCommit)
    expect(coupled.authoritativeResources.log.commits[0]?.rngValue)
      .toBe(baseline.resources.log.commits[0]?.rngValue)
    expect(coupled.authoritativeResources.log.commits[0]?.allocatedId)
      .toBe(baseline.resources.log.commits[0]?.allocatedId)
    expect(coupled.authoritativeResources.log.commits[0]?.schedulerToken)
      .toBe(baseline.resources.log.commits[0]?.schedulerToken)

    // Restoration: a fresh, uncoupled resource set reproduces the baseline
    // exactly -- the contamination does not survive into a fresh run.
    const restored = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    )
    expect(restored.digest).toBe(baseline.digest)

    // A fresh director-on run with no coupling at all proves no contamination
    // survives across resource instances: uncoupled director-on always
    // matches director-off regardless of whether a coupled run happened first.
    const uncoupledAfter = runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-n5-fresh-after-contamination'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    })
    expect(uncoupledAfter.authoritativeDigest).toBe(baseline.digest)
  })

  it('leaves no cross-test contamination: a fresh resource set after every negative control reproduces the exact same baseline digest', () => {
    const baseline = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    ).digest

    runAttentionDirectorOnPass({
      replayPassInput: replayPassInput('p2-contamination-check'),
      initialAuthoritativeResources: freshAuthoritativeResources(),
      commandIds: A5_AUTHORITATIVE_COMMAND_IDS,
      wallClockInputs: A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
      coupling: (resources) => ({ ...resources, rng: leakAttentionExecutionIntoSharedRng(resources.rng) }),
    })

    const after = runAttentionDirectorOffPass(
      freshAuthoritativeResources(),
      A5_AUTHORITATIVE_COMMAND_IDS,
      A5_AUTHORITATIVE_WALL_CLOCK_INPUTS,
    ).digest

    expect(after).toBe(baseline)
  })
})
