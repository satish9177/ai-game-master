import { describe, expect, it } from 'vitest'
import {
  ATTENTION_CANDIDATE_ORDERING_VERSION,
} from './attentionCandidatePolicy'
import {
  attentionCandidateDerivationDependencyBundle,
  attentionCandidateRankingEligibilityResourceState,
  deriveAttentionCandidateDerivationCacheKey,
  deriveAttentionCandidateRankingCacheKey,
  deriveAttentionTraceCacheKey,
} from './attentionCandidateCacheKey'
import type { AttentionCandidateRankingDependencyBundle } from './attentionCandidateCacheKey'
import { A1_RANKING_SNAPSHOT_LSN, A5_REVALIDATION_SNAPSHOT_LSN, buildAttentionQuestCandidateRevalidationScenarios } from './attentionQuestCandidateScenario'
import { runAttentionMixedFamilyEvaluation, runAttentionQuestCandidateReplayPass } from './attentionReplay'
import { ATTENTION_LEDGER_POLICY_VERSION } from './attentionCandidatePolicy'
import { createAttentionLedger } from './attentionLedger'
import {
  buildB6MixedEvaluationFixture,
  buildB6PatternOnlyEvaluationInput,
  buildB6StageASingleQuestCandidate,
} from './attentionReplayScenario'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import { aidRecord, mintPatternEvidenceViews } from './attentionNarrativePatternScenario'
import { reconstructNarrativePatternInstances } from './attentionNarrativePatternMonitor'
import { digestAttentionReplayAuthoritativeLog } from './attentionReplayResources'
import {
  ATTENTION_COMMUNICATION_LEGALITY_POLICY_HASH,
  ATTENTION_COMMUNICATION_LEGALITY_POLICY_VERSION,
} from './attentionRevealerLegality'

/**
 * A5 — cache-key invalidation and two-clock revalidation evidence.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D15 "derivation and ranking caches are separately keyed", two-clock
 *    revalidation; D12 step 11 the sole typed-exception invalidation stage);
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§22 "Cache and policy-mismatch fixtures" K1-K3; §23 "Two-clock
 *    revalidation" V1-V8);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§8 "5. CACHE, REVALIDATION AND LIMIT EVIDENCE"; §9 A5 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated
 * to attention and is not the source of any rule asserted here.
 *
 * A3 (`attentionCandidateCacheKey.test.ts`) already proves the derivation
 * and ranking key derivations in isolation; what is new here is (a) the A5
 * trace key that folds the ranking key whole plus the two-clock coordinate,
 * and (b) the end-to-end revalidation outcome recorded in a complete replay
 * trace, not merely a key comparison.
 */

const NO_AUTHORITATIVE_LOG_DIGEST = digestAttentionReplayAuthoritativeLog({ commits: [] })

/**
 * B4 — both bundles are explicit typed values (RN019 §9.3). The ranking bundle
 * carries exactly the derivation key, the ordering version, the ranking-policy
 * hash, and the B4-owned eligibility/resource state; no B5 ledger, exposure,
 * cooldown, retirement, or template dependency is present at this slice.
 */
const BASE_DERIVATION_INPUT = attentionCandidateDerivationDependencyBundle({
  snapshotLsn: A1_RANKING_SNAPSHOT_LSN,
  aggregateLegitimacyPolicyRef: 'aggregate-legitimacy-disabled-v0',
})

const BASE_RANKING_INPUT: AttentionCandidateRankingDependencyBundle = {
  derivation: BASE_DERIVATION_INPUT,
  orderingVersion: ATTENTION_CANDIDATE_ORDERING_VERSION,
  rankingPolicyHash: 'ranking-policy-hash-v1',
  eligibilityResourceState: attentionCandidateRankingEligibilityResourceState(),
}

function rankingCacheKeyOrThrow(input: AttentionCandidateRankingDependencyBundle): string {
  const result = deriveAttentionCandidateRankingCacheKey(input)
  if (result.kind !== 'ok') throw new Error('expected a ranking cache key, got refusal: ' + result.reason)
  return result.rankingCacheKey
}

describe('A5 — the trace cache key folds the ranking key whole plus the two-clock coordinate', () => {
  it('two runs with identical ranking key and revalidation LSN produce the same trace key', () => {
    const rankingCacheKey = rankingCacheKeyOrThrow(BASE_RANKING_INPUT)

    const first = deriveAttentionTraceCacheKey({
      rankingCacheKey,
      revalidationSnapshotLsn: A5_REVALIDATION_SNAPSHOT_LSN,
      replayCaseId: 'case-1',
    })
    const second = deriveAttentionTraceCacheKey({
      rankingCacheKey,
      revalidationSnapshotLsn: A5_REVALIDATION_SNAPSHOT_LSN,
      replayCaseId: 'case-1',
    })

    expect(first).toEqual(second)
    expect(first.kind).toBe('ok')
  })

  it('a different revalidation LSN changes the trace key but not the ranking key it embeds', () => {
    const rankingCacheKey = rankingCacheKeyOrThrow(BASE_RANKING_INPUT)

    const atRanking = deriveAttentionTraceCacheKey({
      rankingCacheKey,
      revalidationSnapshotLsn: A1_RANKING_SNAPSHOT_LSN,
      replayCaseId: 'case-2',
    })
    const atRevalidation = deriveAttentionTraceCacheKey({
      rankingCacheKey,
      revalidationSnapshotLsn: A5_REVALIDATION_SNAPSHOT_LSN,
      replayCaseId: 'case-2',
    })

    expect(atRanking.kind).toBe('ok')
    expect(atRevalidation.kind).toBe('ok')
    if (atRanking.kind !== 'ok' || atRevalidation.kind !== 'ok') throw new Error('unreachable')
    expect(atRanking.traceCacheKey).not.toBe(atRevalidation.traceCacheKey)
  })

  it('any change that invalidates the ranking (or derivation) key also invalidates the trace key -- structurally, by embedding', () => {
    const rankingCacheKeyBefore = rankingCacheKeyOrThrow(BASE_RANKING_INPUT)
    const rankingCacheKeyAfter = rankingCacheKeyOrThrow({ ...BASE_RANKING_INPUT, rankingPolicyHash: 'ranking-policy-hash-v2' })

    const before = deriveAttentionTraceCacheKey({
      rankingCacheKey: rankingCacheKeyBefore,
      revalidationSnapshotLsn: A5_REVALIDATION_SNAPSHOT_LSN,
      replayCaseId: 'case-3',
    })
    const after = deriveAttentionTraceCacheKey({
      rankingCacheKey: rankingCacheKeyAfter,
      revalidationSnapshotLsn: A5_REVALIDATION_SNAPSHOT_LSN,
      replayCaseId: 'case-3',
    })

    expect(rankingCacheKeyBefore).not.toBe(rankingCacheKeyAfter)
    expect(before.kind).toBe('ok')
    expect(after.kind).toBe('ok')
    if (before.kind !== 'ok' || after.kind !== 'ok') throw new Error('unreachable')
    expect(before.traceCacheKey).not.toBe(after.traceCacheKey)
  })

  it('refuses rather than approximates a missing ranking cache key, revalidation LSN, or replay case id', () => {
    expect(deriveAttentionTraceCacheKey({
      rankingCacheKey: '',
      revalidationSnapshotLsn: A5_REVALIDATION_SNAPSHOT_LSN,
      replayCaseId: 'case-4',
    })).toEqual({ kind: 'refused', reason: 'missing-ranking-cache-key' })

    expect(deriveAttentionTraceCacheKey({
      rankingCacheKey: rankingCacheKeyOrThrow(BASE_RANKING_INPUT),
      revalidationSnapshotLsn: -1,
      replayCaseId: 'case-4',
    })).toEqual({ kind: 'refused', reason: 'revalidation-snapshot-lsn-out-of-range' })

    expect(deriveAttentionTraceCacheKey({
      rankingCacheKey: rankingCacheKeyOrThrow(BASE_RANKING_INPUT),
      revalidationSnapshotLsn: A5_REVALIDATION_SNAPSHOT_LSN,
      replayCaseId: '  ',
    })).toEqual({ kind: 'refused', reason: 'missing-replay-case-id' })
  })

  it('a ranking-only policy change (e.g. rankingPolicyHash) does not change the underlying derivation key', () => {
    const before = deriveAttentionCandidateDerivationCacheKey(BASE_DERIVATION_INPUT)
    const rankingBefore = deriveAttentionCandidateRankingCacheKey(BASE_RANKING_INPUT)
    const rankingAfter = deriveAttentionCandidateRankingCacheKey({ ...BASE_RANKING_INPUT, rankingPolicyHash: 'ranking-policy-hash-v3' })

    expect(before.kind).toBe('ok')
    expect(rankingBefore.kind).toBe('ok')
    expect(rankingAfter.kind).toBe('ok')
    if (before.kind !== 'ok' || rankingBefore.kind !== 'ok' || rankingAfter.kind !== 'ok') throw new Error('unreachable')
    expect(rankingBefore.derivationCacheKey).toBe(before.derivationCacheKey)
    expect(rankingAfter.derivationCacheKey).toBe(before.derivationCacheKey)
    expect(rankingBefore.rankingCacheKey).not.toBe(rankingAfter.rankingCacheKey)
  })
})

describe('C4 — communication scope policy remains ranking-only cache material', () => {
  it('moves the ranking key for the C4 legality-policy value while leaving candidate derivation unchanged', () => {
    const disabled = rankingCacheKeyOrThrow(BASE_RANKING_INPUT)
    const enabledBundle: AttentionCandidateRankingDependencyBundle = {
      ...BASE_RANKING_INPUT,
      eligibilityResourceState: attentionCandidateRankingEligibilityResourceState({
        communicationLegalityPolicyRef: 'communication-legality-c3-v1',
        communicationLegalityPolicyVersion: ATTENTION_COMMUNICATION_LEGALITY_POLICY_VERSION,
        communicationLegalityPolicyHash: ATTENTION_COMMUNICATION_LEGALITY_POLICY_HASH,
      }),
    }
    const enabled = deriveAttentionCandidateRankingCacheKey(enabledBundle)
    const disabledDerivation = deriveAttentionCandidateDerivationCacheKey(BASE_RANKING_INPUT.derivation)
    const enabledDerivation = deriveAttentionCandidateDerivationCacheKey(enabledBundle.derivation)
    expect(enabled.kind).toBe('ok')
    expect(disabledDerivation).toEqual(enabledDerivation)
    if (enabled.kind !== 'ok') throw new Error('expected C4 policy resource state to be keyable')
    expect(enabled.rankingCacheKey).not.toBe(disabled)
  })
})

describe('A5 — end-to-end two-clock revalidation through a complete replay pass', () => {
  it('V1 -- a candidate still legal at revalidation is presented, and both LSNs appear in the trace', () => {
    const { stillLegal } = buildAttentionQuestCandidateRevalidationScenarios()

    const outcome = runAttentionQuestCandidateReplayPass({
      replayCaseId: 'v1-still-legal',
      snapshot: stillLegal.atRanking.snapshot,
      request: stillLegal.atRanking.request,
      revalidationSnapshot: stillLegal.atRevalidation.snapshot,
      revalidationSnapshotLsn: stillLegal.atRevalidation.request.rankingSnapshotLsn,
      authoritativeLogDigestBefore: NO_AUTHORITATIVE_LOG_DIGEST,
      authoritativeLogDigestAfter: NO_AUTHORITATIVE_LOG_DIGEST,
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') throw new Error('unreachable')
    expect(outcome.result.trace.rankingSnapshotLsn).toBe(A1_RANKING_SNAPSHOT_LSN)
    expect(outcome.result.trace.revalidationSnapshotLsn).toBe(A5_REVALIDATION_SNAPSHOT_LSN)
    expect(outcome.result.trace.revalidations).toEqual([
      { candidateId: outcome.result.orderedCandidates[0]?.candidateId, outcome: 'still-legal' },
    ])
    expect(outcome.result.trace.presentations).toHaveLength(1)
  })

  it('V2 -- a candidate that disappears between the two coordinates is not presented, and revalidation records it explicitly', () => {
    const { disappears } = buildAttentionQuestCandidateRevalidationScenarios()

    const outcome = runAttentionQuestCandidateReplayPass({
      replayCaseId: 'v2-disappears',
      snapshot: disappears.atRanking.snapshot,
      request: disappears.atRanking.request,
      revalidationSnapshot: disappears.atRevalidation.snapshot,
      revalidationSnapshotLsn: disappears.atRevalidation.request.rankingSnapshotLsn,
      authoritativeLogDigestBefore: NO_AUTHORITATIVE_LOG_DIGEST,
      authoritativeLogDigestAfter: NO_AUTHORITATIVE_LOG_DIGEST,
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') throw new Error('unreachable')
    expect(outcome.result.trace.revalidations[0]?.outcome).toBe('candidate-disappeared')
    expect(outcome.result.trace.presentations).toHaveLength(0)
  })

  it('V3 -- a candidate that resolves between the two coordinates is not presented, and the attention layer never writes the lifecycle', () => {
    const { resolvesBetween } = buildAttentionQuestCandidateRevalidationScenarios()
    const beforeBytes = resolvesBetween.atRevalidation.snapshot.candidates[0]?.status

    const outcome = runAttentionQuestCandidateReplayPass({
      replayCaseId: 'v3-resolves-between',
      snapshot: resolvesBetween.atRanking.snapshot,
      request: resolvesBetween.atRanking.request,
      revalidationSnapshot: resolvesBetween.atRevalidation.snapshot,
      revalidationSnapshotLsn: resolvesBetween.atRevalidation.request.rankingSnapshotLsn,
      authoritativeLogDigestBefore: NO_AUTHORITATIVE_LOG_DIGEST,
      authoritativeLogDigestAfter: NO_AUTHORITATIVE_LOG_DIGEST,
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') throw new Error('unreachable')
    expect(outcome.result.trace.revalidations[0]?.outcome).toBe('candidate-disappeared')
    expect(outcome.result.trace.presentations).toHaveLength(0)
    expect(beforeBytes).toBe('resolved')
    expect(resolvesBetween.atRevalidation.snapshot.candidates[0]?.status).toBe('resolved')
  })

  it('V4 -- opening provenance becoming private between the two coordinates revokes presentation', () => {
    const { provenanceLostBetween } = buildAttentionQuestCandidateRevalidationScenarios()

    const outcome = runAttentionQuestCandidateReplayPass({
      replayCaseId: 'v4-provenance-lost',
      snapshot: provenanceLostBetween.atRanking.snapshot,
      request: provenanceLostBetween.atRanking.request,
      revalidationSnapshot: provenanceLostBetween.atRevalidation.snapshot,
      revalidationSnapshotLsn: provenanceLostBetween.atRevalidation.request.rankingSnapshotLsn,
      authoritativeLogDigestBefore: NO_AUTHORITATIVE_LOG_DIGEST,
      authoritativeLogDigestAfter: NO_AUTHORITATIVE_LOG_DIGEST,
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') throw new Error('unreachable')
    expect(outcome.result.trace.revalidations[0]?.outcome).toBe('candidate-disappeared')
    expect(outcome.result.trace.presentations).toHaveLength(0)
  })

  it('a stale/mismatched revalidation accessor-contract version refuses (stale-snapshot) rather than reusing the original view', () => {
    const { stillLegal } = buildAttentionQuestCandidateRevalidationScenarios()

    const outcome = runAttentionQuestCandidateReplayPass({
      replayCaseId: 'v-stale-version',
      snapshot: stillLegal.atRanking.snapshot,
      request: stillLegal.atRanking.request,
      revalidationSnapshot: stillLegal.atRevalidation.snapshot,
      // A mismatched revalidation coordinate: the snapshot is pinned at
      // A5_REVALIDATION_SNAPSHOT_LSN but the request below claims a
      // different LSN, so the A1 accessor itself refuses the revalidation read.
      revalidationSnapshotLsn: A5_REVALIDATION_SNAPSHOT_LSN + 1,
      authoritativeLogDigestBefore: NO_AUTHORITATIVE_LOG_DIGEST,
      authoritativeLogDigestAfter: NO_AUTHORITATIVE_LOG_DIGEST,
    })

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') throw new Error('unreachable')
    expect(outcome.result.trace.revalidations[0]?.outcome).toBe('stale-snapshot')
    expect(outcome.result.trace.presentations).toHaveLength(0)
  })

  it('deterministic cold and warm replay equivalence: repeated revalidation runs are byte-identical', () => {
    const { stillLegal } = buildAttentionQuestCandidateRevalidationScenarios()

    const runs = [0, 1].map(() => {
      const outcome = runAttentionQuestCandidateReplayPass({
        replayCaseId: 'v-repeat',
        snapshot: stillLegal.atRanking.snapshot,
        request: stillLegal.atRanking.request,
        revalidationSnapshot: stillLegal.atRevalidation.snapshot,
        revalidationSnapshotLsn: stillLegal.atRevalidation.request.rankingSnapshotLsn,
        authoritativeLogDigestBefore: NO_AUTHORITATIVE_LOG_DIGEST,
        authoritativeLogDigestAfter: NO_AUTHORITATIVE_LOG_DIGEST,
      })
      if (outcome.kind !== 'ok') throw new Error('expected a complete replay pass')
      return JSON.stringify(outcome.result.trace.playerObservable)
    })

    expect(runs[0]).toBe(runs[1])
  })
})

/**
 * B6 / RN019 §9.4, §9.4.1, §9.4.2 — the two revalidation clocks are genuinely
 * independent. Each case below supplies **different** derivation-coordinate and
 * revalidation-coordinate material, so a fixture that passed identical views to
 * both would fail it. This is what makes the two-clock check non-vacuous.
 */
describe('B6 -- the derivation and revalidation coordinates are independently supplied', () => {
  const FIRST_PAIR = [aidRecord('reval-aid-a-b', 10, 'a', 'b'), aidRecord('reval-aid-b-a', 11, 'b', 'a')]
  const SECOND_PAIR = [aidRecord('reval-aid-c-d', 12, 'c', 'd'), aidRecord('reval-aid-d-c', 13, 'd', 'c')]
  const BOTH_PAIRS = mintPatternEvidenceViews([...FIRST_PAIR, ...SECOND_PAIR])
  const SECOND_PAIR_ONLY = mintPatternEvidenceViews(SECOND_PAIR)

  function freshLedger() {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (ledger.kind !== 'ok') throw new Error('expected ledger')
    return ledger.ledger
  }

  it('A -- a pattern present at derivation but absent at revalidation refuses candidate-disappeared, substitutes no sibling, and the evaluator continues', () => {
    const fixture = buildB6MixedEvaluationFixture({
      replayCaseId: 'b6-reval-disappeared', ledger: freshLedger(),
      patternEvidenceViews: BOTH_PAIRS,
      // The revalidation coordinate no longer admits the first pair's records.
      revalidationPatternEvidenceViews: SECOND_PAIR_ONLY,
    })
    expect(fixture.patternCandidateIds).toHaveLength(2)

    const result = runAttentionMixedFamilyEvaluation(fixture.input)
    if (result.kind !== 'ok') throw new Error('expected the disappearance case to evaluate')

    const [firstRanked, secondRanked] = result.result.retainedCandidates
    expect(result.result.arbitrationAttempts[0]).toMatchObject({
      candidateId: firstRanked?.candidateId, outcome: 'revalidation-refused',
      refusalReason: 'candidate-disappeared', continued: true, ledgerAppend: 'not-appended',
    })
    // No sibling substitution: the refused attempt names the *disappeared*
    // candidate, and the winner is the other candidate under its own identity.
    expect(result.result.arbitrationAttempts[0]?.candidateId).not.toBe(secondRanked?.candidateId)
    expect(result.result.arbitrationAttempts[1]).toMatchObject({
      candidateId: secondRanked?.candidateId, outcome: 'presented', ledgerAppend: 'appended',
    })
    expect(result.result.presentation?.candidateId).toBe(secondRanked?.candidateId)
    // Exactly one append, made by the surviving candidate only.
    expect(result.result.ledger.records).toHaveLength(1)
    expect(result.result.ledger.records[0]?.candidateId).toBe(secondRanked?.candidateId)
  })

  it('B -- different coordinates that reconstruct the same exact candidate keep the presentation legal', () => {
    const derivationLsn = A1_RANKING_SNAPSHOT_LSN
    const laterRevalidationLsn = A1_RANKING_SNAPSHOT_LSN + 4
    const fixture = buildB6MixedEvaluationFixture({
      replayCaseId: 'b6-reval-same-candidate', ledger: freshLedger(),
      patternEvidenceViews: SECOND_PAIR_ONLY,
      revalidationPatternEvidenceViews: SECOND_PAIR_ONLY,
      revalidationSnapshotLsn: laterRevalidationLsn,
    })
    // The two clocks really differ.
    expect(fixture.input.request.rankingSnapshotLsn).toBe(derivationLsn)
    expect(fixture.input.revalidationSnapshotLsn).toBe(laterRevalidationLsn)
    expect(fixture.input.revalidationSnapshotLsn).not.toBe(fixture.input.request.rankingSnapshotLsn)

    // Independent reconstruction at each coordinate yields the same instance
    // identity -- the monitor-equivalence proof this case rests on.
    const atDerivation = reconstructNarrativePatternInstances({
      patternEvidenceViews: SECOND_PAIR_ONLY, evaluationSnapshotLsn: derivationLsn,
    })
    const atRevalidation = reconstructNarrativePatternInstances({
      patternEvidenceViews: SECOND_PAIR_ONLY, evaluationSnapshotLsn: laterRevalidationLsn,
    })
    if (atDerivation.kind !== 'ok' || atRevalidation.kind !== 'ok') throw new Error('expected two reconstructions')
    expect(atRevalidation.instances.map((instance) => instance.patternInstanceId))
      .toEqual(atDerivation.instances.map((instance) => instance.patternInstanceId))

    const result = runAttentionMixedFamilyEvaluation(fixture.input)
    if (result.kind !== 'ok') throw new Error('expected the same-candidate case to evaluate')

    // Exact candidateId match through revalidation, and the presentation stays legal.
    expect(result.result.arbitrationAttempts[0]).toMatchObject({
      candidateId: fixture.patternCandidateIds[0], outcome: 'presented', ledgerAppend: 'appended',
    })
    expect(result.result.presentation?.candidateId).toBe(fixture.patternCandidateIds[0])
    expect(result.result.ledger.records).toHaveLength(1)
    expect(result.result.trace.revalidationSnapshotLsn).toBe(laterRevalidationLsn)
  })

  it('C -- a quest accessor refusal marks only quest candidates stale and never suppresses the legal pattern', () => {
    const fixture = buildB6MixedEvaluationFixture({
      replayCaseId: 'b6-reval-quest-accessor-refusal', ledger: freshLedger(),
      questCandidates: [buildB6StageASingleQuestCandidate()],
      patternEvidenceViews: SECOND_PAIR_ONLY,
      // A revalidation snapshot minted at a different coordinate than the one
      // requested: the committed accessor refuses `ranking-snapshot-lsn-mismatch`,
      // so `admittedQuestIds` is null for the whole quest family.
      revalidationSnapshotMintedAtLsn: A1_RANKING_SNAPSHOT_LSN + 1,
    })
    expect(readAttentionReadableQuestCandidateViews(fixture.input.revalidationSnapshot, {
      accessorContractVersion: fixture.input.request.accessorContractVersion,
      rankingSnapshotLsn: fixture.input.revalidationSnapshotLsn,
    })).toEqual({ kind: 'refused', reason: 'ranking-snapshot-lsn-mismatch' })

    const result = runAttentionMixedFamilyEvaluation(fixture.input)
    if (result.kind !== 'ok') throw new Error('expected the accessor-refusal case to evaluate')

    // The quest candidate is stale-snapshot -- and specifically *not*
    // candidate-disappeared, which case A keeps as its own separate lever.
    const questAttempt = result.result.arbitrationAttempts[0]
    expect(questAttempt).toMatchObject({
      sourceKind: 'quest_candidate', outcome: 'revalidation-refused',
      refusalReason: 'stale-snapshot', continued: true, ledgerAppend: 'not-appended',
    })
    expect(result.result.trace.revalidations).toEqual([
      { candidateId: questAttempt?.candidateId, outcome: 'stale-snapshot' },
    ])

    // The pattern family is untouched: not marked stale, still revalidated
    // against its own material, and it wins.
    expect(result.result.trace.revalidations.some((entry) => (
      fixture.patternCandidateIds.includes(entry.candidateId)
    ))).toBe(false)
    expect(result.result.arbitrationAttempts[1]).toMatchObject({
      sourceKind: 'narrative_pattern_instance', candidateId: fixture.patternCandidateIds[0],
      outcome: 'presented', ledgerAppend: 'appended',
    })
    expect(result.result.ledger.records).toHaveLength(1)
    expect(result.result.ledger.records[0]?.sourceKind).toBe('narrative_pattern_instance')
  })
})

describe('B5 -- ledger/exposure/assertion/package/template dependencies propagate end-to-end through the trace key', () => {
  it('B6 forwards independently declared matching ranking/revalidation cache keys to the pattern revalidation seam', () => {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (ledger.kind !== 'ok') throw new Error('expected ledger')
    const result = runAttentionMixedFamilyEvaluation(buildB6PatternOnlyEvaluationInput('b6-cache', ledger.ledger))
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected evaluation')
    expect(result.result.arbitrationAttempts[0]?.outcome).toBe('presented')
  })

  /**
   * B6 / plan §11.2C row 2, §11.7 — input 7's two cache-key fields are opaque,
   * per-candidate, scenario-supplied strings whose committed production semantic
   * is a single equality comparison inside the real
   * `revalidateAttentionPatternPresentation`. A deliberately **unequal** pair is
   * therefore the existing `cache-key-mismatch` refusal lever, driven here
   * through the real evaluator rather than by calling the seam directly. Nothing
   * in this case derives a cache key or mints a cache identity.
   */
  it('B6 drives the committed cache-key-mismatch refusal from a deliberately unequal scenario-supplied pair', () => {
    const ledger = createAttentionLedger({ ledgerPolicyVersion: ATTENTION_LEDGER_POLICY_VERSION })
    if (ledger.kind !== 'ok') throw new Error('expected ledger')
    const mismatchViews = mintPatternEvidenceViews([
      aidRecord('cache-mismatch-a-b', 10, 'a', 'b'),
      aidRecord('cache-mismatch-b-a', 11, 'b', 'a'),
    ])
    const fixture = buildB6MixedEvaluationFixture({
      replayCaseId: 'b6-cache-key-mismatch',
      ledger: ledger.ledger,
      patternEvidenceViews: mismatchViews,
      patternCacheKeyPairing: 'mismatched',
    })
    // The pair really is unequal, and the ids are still the derivation's own.
    for (const entry of fixture.input.patternPresentationInputs) {
      expect(entry.rankingCacheKey).not.toBe(entry.revalidationCacheKey)
    }
    expect(fixture.input.patternPresentationInputs.map((entry) => entry.candidateId))
      .toEqual(fixture.patternCandidateIds)

    const result = runAttentionMixedFamilyEvaluation(fixture.input)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected the mismatch case to evaluate')

    // Every pattern candidate refuses at revalidation for exactly that reason,
    // the evaluation continues, and nothing is appended or presented.
    expect(result.result.arbitrationAttempts.length).toBeGreaterThan(0)
    for (const attempt of result.result.arbitrationAttempts) {
      expect(attempt).toMatchObject({
        sourceKind: 'narrative_pattern_instance',
        outcome: 'revalidation-refused',
        refusalReason: 'cache-key-mismatch',
        continued: true,
        ledgerAppend: 'not-appended',
      })
    }
    expect(result.result.presentation).toBeNull()
    expect(result.result.ledger.records).toHaveLength(0)

    // The matched pairing over the same views still presents, so the lever is
    // the inequality itself and not the fixture's views.
    const matched = runAttentionMixedFamilyEvaluation(buildB6MixedEvaluationFixture({
      replayCaseId: 'b6-cache-key-matched',
      ledger: ledger.ledger,
      patternEvidenceViews: mismatchViews,
    }).input)
    if (matched.kind !== 'ok') throw new Error('expected the matched case to evaluate')
    expect(matched.result.arbitrationAttempts[0]?.outcome).toBe('presented')
  })

  const rankingCacheKey = rankingCacheKeyOrThrow(BASE_RANKING_INPUT)
  const baseTraceKey = deriveAttentionTraceCacheKey({
    rankingCacheKey,
    revalidationSnapshotLsn: A5_REVALIDATION_SNAPSHOT_LSN,
    replayCaseId: 'b5-cache-propagation',
  })
  if (baseTraceKey.kind !== 'ok') throw new Error('expected a trace cache key')

  it.each([
    ['patternPresentationLedgerPolicyVersion', 'fixture-pattern-presentation-ledger-policy-v9'],
    ['exposurePolicyVersion', 'fixture-exposure-policy-v9'],
    ['relevantLedgerDigest', 'fixture-relevant-ledger-digest'],
    ['directEvidenceAssertionIdentityVersion', 'fixture-assertion-identity-v9'],
    ['patternRevealPackageSchemaVersion', 'fixture-pattern-package-v9'],
    ['patternDirectEvidenceTemplateVersion', 'fixture-pattern-template-v9'],
  ] as const)('varying %s changes the ranking key, and therefore the trace key, without moving the derivation key', (field, value) => {
    const variedRankingInput: AttentionCandidateRankingDependencyBundle = {
      ...BASE_RANKING_INPUT,
      eligibilityResourceState: attentionCandidateRankingEligibilityResourceState({ [field]: value }),
    }
    const variedRankingKey = rankingCacheKeyOrThrow(variedRankingInput)
    expect(variedRankingKey).not.toBe(rankingCacheKey)

    const variedTraceKey = deriveAttentionTraceCacheKey({
      rankingCacheKey: variedRankingKey,
      revalidationSnapshotLsn: A5_REVALIDATION_SNAPSHOT_LSN,
      replayCaseId: 'b5-cache-propagation',
    })
    if (variedTraceKey.kind !== 'ok') throw new Error('expected a varied trace cache key')
    expect(variedTraceKey.traceCacheKey).not.toBe(baseTraceKey.traceCacheKey)

    const derivationResult = deriveAttentionCandidateDerivationCacheKey(BASE_DERIVATION_INPUT)
    if (derivationResult.kind !== 'ok') throw new Error('expected a derivation cache key')
    const variedDerivation = deriveAttentionCandidateRankingCacheKey(variedRankingInput)
    if (variedDerivation.kind !== 'ok') throw new Error('expected a varied ranking result')
    expect(variedDerivation.derivationCacheKey).toBe(derivationResult.derivationCacheKey)
  })
})
