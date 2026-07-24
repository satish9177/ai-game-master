import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { ATTENTION_RANKING_SNAPSHOT_LSN_MAX, ATTENTION_RANKING_SNAPSHOT_LSN_MIN } from './attentionCandidatePolicy'
import { runAttentionQuestCandidateReplayPass, stableWorldReplayPassInput } from './attentionReplay'
import { digestAttentionReplayAuthoritativeLog } from './attentionReplayResources'
import { buildAttentionReplayLsnBoundaryWorlds } from './attentionReplayScenario'
import {
  applyMixedFamilyCandidateCap,
  applyNarrativePatternStructuralRetention,
} from './attentionNarrativePatternResourcePolicy'
import { attentionTraceResourceLimitEntry } from './attentionTrace'
import type { NarrativePatternInstance } from './attentionNarrativePatternContracts'

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

/**
 * B4 / RN019 §8.3 + §9.6 — the resource decisions the B4 policy module already
 * produces now actually reach the trusted trace.
 *
 * These decisions are trusted-only, deterministic, non-authoritative, and not
 * identity-affecting; they are also not B5 presentation history — they describe
 * this evaluation's structural retention, never exposure, cooldown, or
 * retirement.
 */
describe('B4 — every resource decision reaches trusted trace v2, and none reaches the player', () => {
  /** A minimal satisfied instance, sufficient to force a structural cap. */
  function instance(id: string): NarrativePatternInstance {
    return Object.freeze({
      sourceKind: 'narrative_pattern_instance' as const,
      sourceAuthority: 'derived' as const,
      patternInstanceId: id,
      patternType: 'reciprocal_public_aid' as const,
      patternSemanticVersion: 1,
      patternContentHash: 'content-reciprocal_public_aid',
      monitorRuleVersion: 'attention-narrative-pattern-monitor-v1',
      evidenceViewContractVersion: 'attention-pattern-evidence-accessor-v1',
      canonicalizationVersion: 'attention-candidate-canonicalization-v1',
      identitySchemaVersion: 'attention-narrative-pattern-identity-schema-v1',
      evaluationSnapshotLsn: 100,
      bindingMap: Object.freeze([
        Object.freeze({ role: 'initiator', entityId: `${id}-a` }),
        Object.freeze({ role: 'counterparty', entityId: `${id}-b` }),
      ]),
      evidenceSequence: Object.freeze([]),
      supportingRecordIdentityTuple: Object.freeze([
        Object.freeze({
          semanticRole: 'aid-start',
          recordKind: 'observable_action',
          recordId: `${id}-rec`,
          visibilityProvenanceId: `${id}-prov`,
          commitLsn: 10,
        }),
      ]),
      creationProvenance: Object.freeze({
        startRecordId: `${id}-rec`,
        startCommitLsn: 10,
        patternSemanticVersion: 1,
        monitorRuleVersion: 'attention-narrative-pattern-monitor-v1',
      }),
      firstRelevantWorldTime: 1000,
      lastProgressWorldTime: 1010,
      lastProgressLsn: 10,
      progressStep: 1,
      totalSteps: 2,
      directEvidenceAssertionInputs: Object.freeze([]),
      monitorVerdict: 'satisfied' as const,
    }) as unknown as NarrativePatternInstance
  }

  it('carries per-type, live-partial, and global cap decisions into trusted trace entries', () => {
    // Seven satisfied instances of one type force the per-type cap of 6.
    const instances = Array.from({ length: 7 }, (_value, index) => instance(`pattern-per-type-${index}`))
    const retention = applyNarrativePatternStructuralRetention(instances)

    expect(retention.resourceTrace.map((entry) => entry.boundId)).toContain('per-type-reconstructed')

    const traceEntries = retention.resourceTrace.map((decision) => attentionTraceResourceLimitEntry({
      boundId: decision.boundId,
      patternType: decision.patternType,
      configuredValue: decision.configuredValue,
      observedValue: decision.observedValue,
      retainedIds: decision.retainedIdentities,
      droppedIds: decision.droppedIdentities,
    }))

    // Every field the trusted trace must record is present and preserved.
    for (const entry of traceEntries) {
      expect(entry.boundId.length).toBeGreaterThan(0)
      expect(Number.isSafeInteger(entry.configuredValue)).toBe(true)
      expect(Number.isSafeInteger(entry.observedValue)).toBe(true)
      expect(Array.isArray(entry.retainedIds)).toBe(true)
      expect(Array.isArray(entry.droppedIds)).toBe(true)
      expect(Object.isFrozen(entry.retainedIds)).toBe(true)
      expect(Object.isFrozen(entry.droppedIds)).toBe(true)
    }

    const perType = traceEntries.find((entry) => entry.boundId === 'per-type-reconstructed')!
    expect(perType.configuredValue).toBe(6)
    expect(perType.observedValue).toBe(7)
    expect(perType.retainedIds).toHaveLength(6)
    expect(perType.droppedIds).toHaveLength(1)
  })

  it('carries the mixed-family candidate-cap decision into a trusted trace entry', () => {
    const ordered = Array.from({ length: 5 }, (_value, index) => ({ candidateId: `candidate-${index}` }))
    const capped = applyMixedFamilyCandidateCap(ordered)
    if (capped.resourceTrace === null) throw new Error('expected the mixed-family cap to bind')

    const entry = attentionTraceResourceLimitEntry({
      boundId: capped.resourceTrace.boundId,
      patternType: capped.resourceTrace.patternType,
      configuredValue: capped.resourceTrace.configuredValue,
      observedValue: capped.resourceTrace.observedValue,
      retainedIds: capped.resourceTrace.retainedIdentities,
      droppedIds: capped.resourceTrace.droppedIdentities,
    })

    expect(entry).toEqual({
      boundId: 'mixed-family-candidate',
      patternType: null,
      configuredValue: 4,
      observedValue: 5,
      retainedIds: ['candidate-0', 'candidate-1', 'candidate-2', 'candidate-3'],
      droppedIds: ['candidate-4'],
    })
  })

  it('produces byte-stable retained/dropped identity sets under reversed input order', () => {
    const instances = Array.from({ length: 7 }, (_value, index) => instance(`pattern-reversed-${index}`))

    const authored = applyNarrativePatternStructuralRetention(instances)
    const reversed = applyNarrativePatternStructuralRetention([...instances].reverse())

    expect(canonicalSerialize(reversed.resourceTrace)).toBe(canonicalSerialize(authored.resourceTrace))
    expect(canonicalSerialize(reversed.droppedInstanceIds)).toBe(canonicalSerialize(authored.droppedInstanceIds))
  })

  it('keeps every resource decision out of the player-observable projection', () => {
    const { worldAtMin } = buildAttentionReplayLsnBoundaryWorlds()
    const pass = runAttentionQuestCandidateReplayPass(
      stableWorldReplayPassInput('resource-limit-observable', worldAtMin, NO_AUTHORITATIVE_LOG_DIGEST),
    )
    if (pass.kind !== 'ok') throw new Error('expected the pass to succeed')

    // The trusted trace carries the structural-retention record; the observable
    // projection carries none of it (D11: `resource_limit_exceeded` is engine-only).
    expect(pass.result.trace.structuralRetention).toBeDefined()
    const observable = canonicalSerialize(pass.result.trace.playerObservable)
    for (const forbidden of ['structuralRetention', 'resourceLimits', 'boundId', 'droppedIds', 'retainedIds']) {
      expect({ forbidden, present: observable.includes(forbidden) }).toEqual({ forbidden, present: false })
    }
  })
})
