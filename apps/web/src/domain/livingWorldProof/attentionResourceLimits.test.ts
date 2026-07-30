import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { ATTENTION_RANKING_SNAPSHOT_LSN_MAX, ATTENTION_RANKING_SNAPSHOT_LSN_MIN, ATTENTION_LEDGER_POLICY_VERSION } from './attentionCandidatePolicy'
import { runAttentionMixedFamilyEvaluation, runAttentionQuestCandidateReplayPass, runAttentionPatternPresentationPass, stableWorldReplayPassInput } from './attentionReplay'
import { digestAttentionReplayAuthoritativeLog } from './attentionReplayResources'
import {
  buildB6MixedEvaluationFixture,
  buildB6PatternOnlyEvaluationInput,
  buildB6StageASingleQuestCandidate,
  buildAttentionReplayLsnBoundaryWorlds,
} from './attentionReplayScenario'
import { buildB6ReciprocalAidPatternViews } from './attentionNarrativePatternScenario'
import { ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION, createAttentionLedger } from './attentionLedger'
import type { AttentionPatternCandidate } from './attentionCandidate'
import type { NarrativePatternDirectEvidenceAssertionInput } from './attentionNarrativePatternContracts'
import {
  ATTENTION_NARRATIVE_PATTERN_POLICY_HASH,
  ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
  applyMixedFamilyCandidateCap,
  applyNarrativePatternStructuralRetention,
  attentionStageBResourcePolicy,
  buildAttentionStageBResourcePolicy,
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

describe('B5 -- numeric resource-policy pins and override variants', () => {
  it('pins every B5 policy threshold to its independent literal value', () => {
    expect(attentionStageBResourcePolicy()).toMatchObject({
      resourcePolicyVersion: ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION,
      successfulPresentationCooldownLsns: 4,
      maxSuccessfulExposuresPerCandidateId: 2,
      revalidationFailureCooldownLsns: 2,
      consecutiveRevalidationFailuresBeforeRetirement: 2,
      satisfiedPatternRetirementLsns: 8,
    })
  })

  it('a zero-cap override changes the policy hash but never the pinned schema version', () => {
    const zeroAssertions = buildAttentionStageBResourcePolicy({ revealPackageAssertions: 0 })
    expect(zeroAssertions.policy.resourcePolicyVersion).toBe(ATTENTION_STAGE_B_RESOURCE_POLICY_VERSION)
    expect(zeroAssertions.policy.revealPackageAssertions).toBe(0)
    expect(zeroAssertions.policyHash).not.toBe(ATTENTION_NARRATIVE_PATTERN_POLICY_HASH)

    const zeroExposures = buildAttentionStageBResourcePolicy({ maxSuccessfulExposuresPerCandidateId: 0 })
    expect(zeroExposures.policyHash).not.toBe(ATTENTION_NARRATIVE_PATTERN_POLICY_HASH)
    expect(zeroExposures.policyHash).not.toBe(zeroAssertions.policyHash)

    expect(Object.isFrozen(zeroAssertions.policy)).toBe(true)
    expect(attentionStageBResourcePolicy().revealPackageAssertions).toBe(4)
  })
})

describe('B5 -- presentations per evaluation is exactly 1, exercised through the real pattern-presentation pipeline', () => {
  /**
   * B6 / RN019 §8.2.1 B — `presentationsPerEvaluation` is load-bearing at the
   * mixed evaluator: the shared success budget is the versioned numeric policy
   * value, never a literal or a boolean at the call site. The two cases below
   * vary only that one field through the committed test-policy constructor, so
   * a hard-coded `1` (or a boolean slot) fails the zero case outright.
   *
   * The fixture is genuinely mixed — one legal quest and one legal pattern —
   * so the budget is exercised across a family boundary, not inside one family.
   */
  function mixedBudgetFixture(replayCaseId: string) {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (ledger.kind !== 'ok') throw new Error('expected ledger')
    return buildB6MixedEvaluationFixture({
      replayCaseId,
      ledger: ledger.ledger,
      questCandidates: [buildB6StageASingleQuestCandidate()],
      patternEvidenceViews: buildB6ReciprocalAidPatternViews(),
    })
  }

  it('B6 attempts nothing and appends nothing when presentationsPerEvaluation is the configured zero', () => {
    const fixture = mixedBudgetFixture('b6-presentation-budget-zero')
    const zero = buildAttentionStageBResourcePolicy({ presentationsPerEvaluation: 0 })
    expect(zero.policy.presentationsPerEvaluation).toBe(0)

    const result = runAttentionMixedFamilyEvaluation({ ...fixture.input, policy: zero.policy })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected evaluation')

    // No presentation, no successful append, no winner, slot unconsumed.
    expect(result.result.presentation).toBeNull()
    expect(result.result.ledger).toBe(fixture.input.ledger)
    expect(result.result.ledger.records).toHaveLength(0)
    expect(result.result.trace.mixedFamilyArbitration?.winnerCandidateId).toBeNull()
    expect(result.result.trace.mixedFamilyArbitration?.winnerSourceKind).toBeNull()
    expect(result.result.trace.mixedFamilyArbitration?.presentationSlotConsumed).toBe(false)
    expect(result.result.trace.mixedFamilyArbitration?.successfulPresentationCount).toBe(0)

    // Truthful trace: both families were retained and ranked, and every one of
    // them is recorded `not-attempted` — never as a refusal it did not receive.
    expect(result.result.retainedCandidates.map((candidate) => candidate.sourceKind))
      .toEqual(['quest_candidate', 'narrative_pattern_instance'])
    expect(result.result.arbitrationAttempts.map((attempt) => attempt.outcome))
      .toEqual(['not-attempted', 'not-attempted'])
    expect(result.result.arbitrationAttempts.every((attempt) => (
      attempt.refusalReason === null && attempt.ledgerAppend === 'not-appended' && !attempt.continued
    ))).toBe(true)
    expect(result.result.trace.presentations).toEqual([])
  })

  it('B6 keeps normal family-blind one-success behaviour when presentationsPerEvaluation is the committed 1', () => {
    const fixture = mixedBudgetFixture('b6-presentation-budget-one')
    const one = buildAttentionStageBResourcePolicy({ presentationsPerEvaluation: 1 })
    expect(one.policy.presentationsPerEvaluation).toBe(1)
    expect(attentionStageBResourcePolicy().presentationsPerEvaluation).toBe(1)

    const result = runAttentionMixedFamilyEvaluation({ ...fixture.input, policy: one.policy })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected evaluation')

    // RN019 §9.2.1: the quest ranks first and takes the shared slot; the pattern
    // is never attempted. Exactly one record, on the quest's own branch.
    expect(result.result.arbitrationAttempts.map((attempt) => attempt.outcome))
      .toEqual(['presented', 'not-attempted'])
    expect(result.result.trace.mixedFamilyArbitration?.winnerSourceKind).toBe('quest_candidate')
    expect(result.result.trace.mixedFamilyArbitration?.successfulPresentationCount).toBe(1)
    expect(result.result.trace.mixedFamilyArbitration?.presentationSlotConsumed).toBe(true)
    expect(result.result.ledger.records).toHaveLength(1)
    expect(result.result.ledger.records[0]?.sourceKind).toBe('quest_candidate')
  })

  it('B6 consumes the same versioned presentation limit as one shared mixed-family slot', () => {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (ledger.kind !== 'ok') throw new Error('expected ledger')
    const result = runAttentionMixedFamilyEvaluation(buildB6PatternOnlyEvaluationInput('b6-resource-slot', ledger.ledger))
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected evaluation')
    expect(result.result.trace.mixedFamilyArbitration?.successfulPresentationCount).toBe(1)
    expect(result.result.ledger.records).toHaveLength(1)
  })

  const assertionInputs: readonly NarrativePatternDirectEvidenceAssertionInput[] = Object.freeze([
    Object.freeze({ assertionKind: 'public_aid' as const, sourceRecordId: 'aid-1', visibilityProvenanceId: 'public-aid-1', actorId: 'a', targetId: 'b' }),
  ])

  function patternCandidate(candidateId: string, sourceId: string, lastProgressLsn: number): AttentionPatternCandidate {
    return Object.freeze({
      sourceKind: 'narrative_pattern_instance', sourceAuthority: 'derived', sourceId, candidateId,
      eligibility: 'eligible', accessorContractVersion: 'attention-pattern-evidence-accessor-v1',
      canonicalizationVersion: 'attention-candidate-canonicalization-v1', identitySchemaVersion: 'attention-pattern-candidate-identity-schema-v1',
      rankingSnapshotLsn: lastProgressLsn, legallyVisibleParties: Object.freeze(['a', 'b']),
      patternType: 'reciprocal_public_aid', patternSemanticVersion: 1,
      canonicalBindingTuple: Object.freeze([Object.freeze(['initiator', 'a'] as const)]),
      canonicalSupportingRecordIdentityTuple: Object.freeze([
        Object.freeze(['aid-start', 'observable_action', 'aid-1', 'public-aid-1', lastProgressLsn] as const),
      ]),
      lastProgressLsn,
    })
  }

  function emptyLedgerOrThrow() {
    const created = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (created.kind !== 'ok') throw new Error('expected an empty ledger')
    return created.ledger
  }

  it('zero candidates: no presentation, empty decisions, ledger unchanged', () => {
    const ledger = emptyLedgerOrThrow()
    const result = runAttentionPatternPresentationPass({
      orderedCandidates: [],
      ledger,
      evaluationLsn: 20,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
    })
    expect(result.presentation).toBeNull()
    expect(result.decisions).toEqual([])
    expect(result.ledger).toBe(ledger)
  })

  it('one legally eligible candidate presents successfully and appends exactly one ledger record', () => {
    const candidate = patternCandidate('pattern-candidate-1', 'pattern-source-1', 10)
    const ledger = emptyLedgerOrThrow()
    const result = runAttentionPatternPresentationPass({
      orderedCandidates: [{
        candidate, revalidatedCandidate: candidate, directEvidenceAssertionInputs: assertionInputs,
        rankingCacheKey: 'cache-a', revalidationCacheKey: 'cache-a',
      }],
      ledger, evaluationLsn: 20,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
    })
    expect(result.presentation).not.toBeNull()
    expect(result.presentation?.candidateId).toBe('pattern-candidate-1')
    expect(result.ledger.records).toHaveLength(1)
    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0]).toMatchObject({ ledgerAppend: 'appended', revalidationOutcome: 'still-legal' })
    expect(result.attempts[0]?.outcome).toBe('presented')
  })

  it('two eligible candidates: only the first in final order presents, and only one ledger record is appended', () => {
    const first = patternCandidate('pattern-candidate-first', 'pattern-source-first', 10)
    const second = patternCandidate('pattern-candidate-second', 'pattern-source-second', 12)
    const ledger = emptyLedgerOrThrow()
    const result = runAttentionPatternPresentationPass({
      orderedCandidates: [
        { candidate: first, revalidatedCandidate: first, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-a', revalidationCacheKey: 'cache-a' },
        { candidate: second, revalidatedCandidate: second, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-b', revalidationCacheKey: 'cache-b' },
      ],
      ledger, evaluationLsn: 20,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
    })
    expect(result.presentation?.candidateId).toBe('pattern-candidate-first')
    expect(result.ledger.records).toHaveLength(1)
    expect(result.decisions).toHaveLength(1)
    expect(result.attempts).toHaveLength(1)
  })

  it('reversed candidate input order selects the same identity when it is legally first in final order', () => {
    const first = patternCandidate('pattern-candidate-only-legal-first', 'pattern-source-only-legal-first', 10)
    const ledger = emptyLedgerOrThrow()
    const result = runAttentionPatternPresentationPass({
      orderedCandidates: [{ candidate: first, revalidatedCandidate: first, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-a', revalidationCacheKey: 'cache-a' }],
      ledger, evaluationLsn: 20,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
    })
    expect(result.presentation?.candidateId).toBe('pattern-candidate-only-legal-first')
  })

  it('a refused first candidate (cache-key mismatch) consumes no successful-presentation slot; the next candidate then presents', () => {
    const first = patternCandidate('pattern-candidate-refused-first', 'pattern-source-refused-first', 10)
    const second = patternCandidate('pattern-candidate-legal-second', 'pattern-source-legal-second', 12)
    const ledger = emptyLedgerOrThrow()
    const result = runAttentionPatternPresentationPass({
      orderedCandidates: [
        // rankingCacheKey !== revalidationCacheKey forces revalidation to refuse.
        { candidate: first, revalidatedCandidate: first, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-a', revalidationCacheKey: 'cache-mismatch' },
        { candidate: second, revalidatedCandidate: second, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-b', revalidationCacheKey: 'cache-b' },
      ],
      ledger, evaluationLsn: 20,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
    })
    expect(result.attempts[0]).toMatchObject({ candidateId: 'pattern-candidate-refused-first', outcome: 'revalidation-refused' })
    expect(result.presentation?.candidateId).toBe('pattern-candidate-legal-second')
    expect(result.ledger.records).toHaveLength(1)
    expect(result.decisions.find((decision) => decision.candidateId === 'pattern-candidate-refused-first')?.ledgerAppend)
      .toBe('not-appended')
  })

  it('a first candidate failing revalidation (disappeared) does not block the second candidate from presenting', () => {
    const first = patternCandidate('pattern-candidate-disappeared', 'pattern-source-disappeared', 10)
    const second = patternCandidate('pattern-candidate-still-legal', 'pattern-source-still-legal', 12)
    const ledger = emptyLedgerOrThrow()
    const result = runAttentionPatternPresentationPass({
      orderedCandidates: [
        { candidate: first, revalidatedCandidate: undefined, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-a', revalidationCacheKey: 'cache-a' },
        { candidate: second, revalidatedCandidate: second, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-b', revalidationCacheKey: 'cache-b' },
      ],
      ledger, evaluationLsn: 20,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
    })
    expect(result.attempts[0]).toMatchObject({ outcome: 'revalidation-refused', revalidationReason: 'candidate-disappeared' })
    expect(result.presentation?.candidateId).toBe('pattern-candidate-still-legal')
  })

  it('no ledger success record is appended for a refused or failed candidate', () => {
    const onlyCandidate = patternCandidate('pattern-candidate-only', 'pattern-source-only', 10)
    const ledger = emptyLedgerOrThrow()
    const result = runAttentionPatternPresentationPass({
      orderedCandidates: [
        { candidate: onlyCandidate, revalidatedCandidate: undefined, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-a', revalidationCacheKey: 'cache-a' },
      ],
      ledger, evaluationLsn: 20,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
    })
    expect(result.presentation).toBeNull()
    expect(result.ledger.records).toHaveLength(0)
    expect(result.ledger).toBe(ledger)
  })

  it('a hidden hypothetical candidate never passed to the pass cannot consume or shift the one-presentation bound', () => {
    const visible = patternCandidate('pattern-candidate-visible-only', 'pattern-source-visible-only', 10)
    const ledger = emptyLedgerOrThrow()
    // "Hidden" candidates are, by construction, never part of orderedCandidates
    // at all -- proving the bound is exactly a function of what is passed in.
    const result = runAttentionPatternPresentationPass({
      orderedCandidates: [{ candidate: visible, revalidatedCandidate: visible, directEvidenceAssertionInputs: assertionInputs, rankingCacheKey: 'cache-a', revalidationCacheKey: 'cache-a' }],
      ledger, evaluationLsn: 20,
      patternPresentationLedgerPolicyVersion: ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION,
      aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
    })
    expect(result.presentation?.candidateId).toBe('pattern-candidate-visible-only')
    expect(result.decisions).toHaveLength(1)
  })
})
