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
import { runAttentionQuestCandidateReplayPass } from './attentionReplay'
import { digestAttentionReplayAuthoritativeLog } from './attentionReplayResources'

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
